import { mkdir } from "node:fs/promises";

import {
  createNoNeedWorkSession,
  createWorkspaceTools,
  type NoNeedWorkModel,
  type NoNeedWorkModelRuntime,
  type NoNeedWorkPiEvent,
  type NoNeedWorkSession,
} from "@noneedwork/pi-adapter";
import type { PlanStep, TaskBudget } from "@noneedwork/protocol";

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
  model?: NoNeedWorkModel;
  modelRuntime?: NoNeedWorkModelRuntime;
  inMemory?: boolean;
}

export class PiTaskDriver implements TaskDriver {
  readonly #taskId: string;
  readonly #projectRoot: string;
  readonly #agentDirectory: string;
  readonly #tasks: TaskRepository;
  readonly #sandboxes: SandboxRepository;
  readonly #tools: ToolGateway;
  readonly #model: NoNeedWorkModel | undefined;
  readonly #modelRuntime: NoNeedWorkModelRuntime | undefined;
  readonly #inMemory: boolean;
  #session: NoNeedWorkSession | undefined;
  #mode: "planning" | "executing" = "planning";
  #step: PlanStep | undefined;

  constructor(options: PiTaskDriverOptions) {
    this.#taskId = options.taskId;
    this.#projectRoot = options.projectRoot;
    this.#agentDirectory = options.agentDirectory;
    this.#tasks = options.tasks;
    this.#sandboxes = options.sandboxes;
    this.#tools = options.tools;
    this.#model = options.model;
    this.#modelRuntime = options.modelRuntime;
    this.#inMemory = options.inMemory ?? false;
  }

  async createPlan(input: {
    objective: string;
    budget: TaskBudget;
  }): Promise<string | ProposedPlan> {
    this.#mode = "planning";
    this.#step = undefined;
    const session = await this.#ensureSession();
    await session.prompt(buildPlanPrompt(input.objective, input.budget));
    const output = session.getLastAssistantText();
    if (!output) throw new Error("PI planner returned no assistant text");
    return output;
  }

  async executeStep(input: { step: PlanStep; tools: TaskToolbox }): Promise<StepExecutionResult> {
    this.#mode = "executing";
    this.#step = input.step;
    const session = await this.#ensureSession();
    await session.prompt(buildStepPrompt(input.step));
    return {
      summary: session.getLastAssistantText() ?? `PI completed plan step ${input.step.position}`,
    };
  }

  async cancel(): Promise<void> {
    await this.#session?.cancel();
  }

  dispose(): void {
    this.#session?.dispose();
    this.#session = undefined;
  }

  async #ensureSession(): Promise<NoNeedWorkSession> {
    if (this.#session) return this.#session;
    const details = this.#tasks.details(this.#taskId);
    if (!details?.run) throw new Error(`Unknown task ${this.#taskId}`);
    await mkdir(this.#agentDirectory, { recursive: true });
    const session = await createNoNeedWorkSession({
      cwd: this.#projectRoot,
      agentDir: this.#agentDirectory,
      systemPrompt: SYSTEM_PROMPT,
      customTools: createWorkspaceTools((name, input, toolCallId) =>
        this.#dispatch(name, input, toolCallId),
      ),
      ...(this.#model ? { model: this.#model } : {}),
      ...(this.#modelRuntime ? { modelRuntime: this.#modelRuntime } : {}),
      ...(this.#inMemory ? { inMemory: true } : {}),
      ...(details.run.piSessionFile ? { resumeSessionFile: details.run.piSessionFile } : {}),
    });
    this.#tasks.runs.bindPiSession(details.run.id, session.id, session.sessionFile);
    session.subscribe((event) => this.#recordEvent(event));
    this.#session = session;
    return session;
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
