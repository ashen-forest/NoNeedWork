import { mkdir } from "node:fs/promises";

import {
  classifyNoNeedWorkProviderFailure,
  createNoNeedWorkSession,
  createWorkspaceTools,
  type NoNeedWorkModelHandle,
  type NoNeedWorkPiEvent,
  type NoNeedWorkSession,
} from "@noneedwork/pi-adapter";
import type { PlanStep, TaskBudget, TaskModelBinding } from "@noneedwork/protocol";

import { createModelBlock, ModelBlockedError } from "../models/model-errors.js";
import type { ProposedPlan } from "../planning/plan-schema.js";
import type { SandboxRepository } from "../storage/repositories/sandbox-repository.js";
import type { TaskRepository } from "../storage/repositories/task-repository.js";
import type { ToolGateway } from "../tools/tool-gateway.js";
import type { StepExecutionResult, TaskDriver, TaskToolbox } from "./task-orchestrator.js";

const READ_ONLY_PLANNING_TOOLS = new Set(["read_file", "list_files", "search_text"]);

export interface PiTaskDriverOptions {
  taskId: string;
  projectRoot: string;
  agentDirectory: string;
  tasks: TaskRepository;
  sandboxes: SandboxRepository;
  tools: ToolGateway;
  binding: TaskModelBinding | null;
  prepareModelHandle: () => Promise<NoNeedWorkModelHandle>;
  inMemory?: boolean;
}

export class PiTaskDriver implements TaskDriver {
  readonly #taskId: string;
  readonly #projectRoot: string;
  readonly #agentDirectory: string;
  readonly #tasks: TaskRepository;
  readonly #sandboxes: SandboxRepository;
  readonly #tools: ToolGateway;
  readonly #binding: TaskModelBinding | null;
  readonly #prepareModelHandle: () => Promise<NoNeedWorkModelHandle>;
  readonly #inMemory: boolean;
  #modelHandle: NoNeedWorkModelHandle | undefined;
  #preflightPromise: Promise<void> | undefined;
  #session: NoNeedWorkSession | undefined;
  #mode: "planning" | "executing" = "planning";
  #step: PlanStep | undefined;
  #modelOutputObserved = false;

  constructor(options: PiTaskDriverOptions) {
    this.#taskId = options.taskId;
    this.#projectRoot = options.projectRoot;
    this.#agentDirectory = options.agentDirectory;
    this.#tasks = options.tasks;
    this.#sandboxes = options.sandboxes;
    this.#tools = options.tools;
    this.#binding = options.binding;
    this.#prepareModelHandle = options.prepareModelHandle;
    this.#inMemory = options.inMemory ?? false;
  }

  async createPlan(input: {
    objective: string;
    budget: TaskBudget;
  }): Promise<string | ProposedPlan> {
    this.#mode = "planning";
    this.#step = undefined;
    const session = await this.#ensureSession();
    await this.#prompt(session, buildPlanPrompt(input.objective, input.budget));
    const output = session.getLastAssistantText();
    if (!output) throw new Error("PI planner returned no assistant text");
    return output;
  }

  preflight(): Promise<void> {
    this.#preflightPromise ??= this.#performPreflight();
    return this.#preflightPromise;
  }

  async executeStep(input: { step: PlanStep; tools: TaskToolbox }): Promise<StepExecutionResult> {
    this.#mode = "executing";
    this.#step = input.step;
    const session = await this.#ensureSession();
    await this.#prompt(session, buildStepPrompt(input.step));
    return {
      summary: session.getLastAssistantText() ?? `PI completed plan step ${input.step.position}`,
    };
  }

  async cancel(): Promise<void> {
    await this.#session?.cancel();
  }

  async dispose(): Promise<void> {
    const session = this.#session;
    this.#session = undefined;
    if (session) {
      await session.dispose();
      this.#modelHandle = undefined;
      return;
    }
    const handle = this.#modelHandle;
    this.#modelHandle = undefined;
    await handle?.dispose();
  }

  async #ensureSession(): Promise<NoNeedWorkSession> {
    if (this.#session) return this.#session;
    if (!this.#modelHandle) throw new Error("PI task driver requires model preflight");
    const details = this.#tasks.details(this.#taskId);
    if (!details?.run) throw new Error(`Unknown task ${this.#taskId}`);
    await mkdir(this.#agentDirectory, { recursive: true });
    const session = await createNoNeedWorkSession({
      cwd: this.#projectRoot,
      agentDir: this.#agentDirectory,
      systemPrompt: SYSTEM_PROMPT,
      modelHandle: this.#modelHandle,
      customTools: createWorkspaceTools((name, input, toolCallId) =>
        this.#dispatch(name, input, toolCallId),
      ),
      ...(this.#inMemory ? { inMemory: true } : {}),
      ...(details.run.piSessionFile ? { resumeSessionFile: details.run.piSessionFile } : {}),
    });
    this.#tasks.runs.bindPiSession(details.run.id, session.id, session.sessionFile);
    session.subscribe((event) => this.#recordEvent(event));
    this.#session = session;
    return session;
  }

  async #performPreflight(): Promise<void> {
    if (!this.#binding) {
      throw new ModelBlockedError(
        createModelBlock({
          reason: "MODEL_BINDING_MISSING",
          profileId: "qwen-cn",
          modelId: "qwen3.7-plus",
        }),
      );
    }
    const handle = await this.#prepareModelHandle();
    if (
      handle.identity.profileId !== this.#binding.profileId ||
      handle.identity.piProviderId !== this.#binding.piProviderId ||
      handle.identity.modelId !== this.#binding.modelId ||
      handle.identity.piSdkVersion !== this.#binding.piSdkVersion
    ) {
      await handle.dispose();
      throw new ModelBlockedError(
        createModelBlock({
          reason: "MODEL_UNAVAILABLE",
          profileId: this.#binding.profileId,
          modelId: this.#binding.modelId,
        }),
      );
    }
    this.#modelHandle = handle;
  }

  async #dispatch(name: string, input: unknown, toolCallId: string) {
    if (this.#mode === "planning" && !READ_ONLY_PLANNING_TOOLS.has(name)) {
      return {
        ok: false,
        content: `Tool ${name} is unavailable while the plan is being created`,
      };
    }
    const details = this.#tasks.details(this.#taskId);
    if (!details?.run) throw new Error(`Unknown task ${this.#taskId}`);
    const sandbox = this.#sandboxes.getByRun(details.run.id);
    if (sandbox?.status !== "READY") {
      throw new Error(`TaskRun ${details.run.id} has no ready sandbox`);
    }
    return this.#tools.dispatch(name, input, {
      sandboxId: sandbox.externalId,
      taskId: this.#taskId,
      runId: details.run.id,
      ...(this.#step ? { stepId: this.#step.id } : {}),
      toolCallId,
      allowedPaths: this.#step?.allowedPaths ?? ["**"],
    });
  }

  #recordEvent(event: NoNeedWorkPiEvent): void {
    if (
      (event.type === "output.delta" && event.delta.length > 0) ||
      event.type === "tool.started" ||
      (event.type === "pi.event" &&
        event.name.startsWith("message_update.") &&
        event.name.endsWith("_delta"))
    ) {
      this.#modelOutputObserved = true;
    }
    const details = this.#tasks.details(this.#taskId);
    if (!details?.run) return;
    if (event.type === "output.delta") {
      this.#tasks.runs.events.append(this.#taskId, details.run.id, "AGENT_MESSAGE_DELTA", {
        delta: event.delta,
      });
    } else if (event.type === "agent.finished" || event.type === "retry.started") {
      this.#tasks.runs.events.append(this.#taskId, details.run.id, "DIAGNOSTIC", { ...event });
    }
  }

  async #prompt(session: NoNeedWorkSession, prompt: string): Promise<void> {
    this.#modelOutputObserved = false;
    try {
      await session.prompt(prompt);
      const failure = session.getLastModelFailure();
      if (failure) throw this.#modelBlocked(failure);
    } catch (error) {
      if (error instanceof ModelBlockedError) throw error;
      throw this.#modelBlocked(classifyNoNeedWorkProviderFailure(error, this.#modelOutputObserved));
    }
  }

  #modelBlocked(failure: ReturnType<typeof classifyNoNeedWorkProviderFailure>): ModelBlockedError {
    const binding = this.#binding;
    if (!binding) {
      return new ModelBlockedError(
        createModelBlock({
          reason: "MODEL_BINDING_MISSING",
          profileId: "qwen-cn",
          modelId: "qwen3.7-plus",
        }),
      );
    }
    return new ModelBlockedError(
      createModelBlock({
        reason: failure.reason,
        profileId: binding.profileId,
        modelId: binding.modelId,
        ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
      }),
    );
  }
}

const SYSTEM_PROMPT = `You are the PI execution engine embedded inside NoNeedWork.
You operate only through the explicitly provided isolated-workspace tools.
Never claim a file changed or a command passed unless the corresponding tool observation proves it.
During planning, inspect the workspace with read-only tools and then return only the requested JSON plan.
During execution, stay within the current plan step, use exact edits, run the supplied verification, and report unresolved items plainly.`;

function buildPlanPrompt(objective: string, budget: TaskBudget): string {
  return `Create an execution plan for this objective:\n${objective}\n\nInspect the isolated workspace as needed. Return ONLY one JSON object with this exact shape:\n${JSON.stringify(
    {
      schemaVersion: 1,
      objective,
      steps: [
        {
          key: "short-stable-key",
          objective: "one concrete outcome",
          dependencies: [],
          acceptanceCriteria: ["observable criterion"],
          allowedPaths: ["relative/path/or/**"],
          verificationCommands: [["program", "arg"]],
          requiresWrite: true,
        },
      ],
    },
    null,
    2,
  )}\nLimits: at most ${budget.maxTurns} steps, ${budget.maxWriteOperations} write steps, and ${budget.maxReplans} replans. Dependencies must form an acyclic graph. Commands are argv arrays and must not use a shell.`;
}

function buildStepPrompt(step: PlanStep): string {
  return `Execute only plan step ${step.position}: ${step.objective}\nAllowed write paths: ${step.allowedPaths.join(", ")}\nAcceptance criteria:\n${step.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}\nVerification commands are run by the Runtime after your work. Use the isolated tools, make the smallest correct change, and finish with a concise factual summary.`;
}
