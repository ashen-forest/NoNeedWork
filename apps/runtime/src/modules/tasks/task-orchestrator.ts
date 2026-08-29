import { randomUUID } from "node:crypto";

import type { PlanStep, TaskDetails, TaskRun } from "@noneedwork/protocol";

import type { ArtifactStore } from "../artifacts/artifact-store.js";
import { ModelBlockedError } from "../models/model-errors.js";
import type { Planner, PlanService } from "../planning/plan-service.js";
import type { StepVerifier, VerificationResult } from "../planning/step-verifier.js";
import type { SandboxExecutor } from "../sandbox/docker-provider.js";
import type { SandboxRepository } from "../storage/repositories/sandbox-repository.js";
import type { TaskRepository } from "../storage/repositories/task-repository.js";
import type { ToolOperationRepository } from "../storage/repositories/tool-operation-repository.js";
import type { ToolGateway } from "../tools/tool-gateway.js";
import type { ToolResult } from "../tools/tool-result.js";
import type { CheckpointService } from "./checkpoint-service.js";
import type { RunLease } from "./run-lease.js";
import { assertStepTransition } from "./step-state-machine.js";
import { assertTaskTransition, isTerminalTaskStatus } from "./task-state-machine.js";

export interface WorkspaceSandboxProvider extends SandboxExecutor {
  createWorkspace(sourceDirectory: string): Promise<string>;
  removeSandbox(sandboxId: string): Promise<void>;
}

export interface TaskToolbox {
  call(name: string, input: unknown): Promise<ToolResult>;
}

export interface StepExecutionResult {
  summary: string;
  unresolvedItems?: readonly string[];
}

export interface TaskDriver extends Planner {
  preflight?(): Promise<void>;
  executeStep(input: { step: PlanStep; tools: TaskToolbox }): Promise<StepExecutionResult>;
  cancel?(): Promise<void>;
  dispose?(): Promise<void>;
}

export class StepExecutionError extends Error {
  constructor(
    readonly stepId: string,
    message: string,
  ) {
    super(message);
    this.name = "StepExecutionError";
  }
}

export class RunLeaseUnavailableError extends Error {
  constructor(readonly runId: string) {
    super(`TaskRun ${runId} is leased`);
    this.name = "RunLeaseUnavailableError";
  }
}

export class UnknownToolOutcomeError extends Error {
  constructor(readonly operationIds: readonly string[]) {
    super(`Tool outcome requires verification: ${operationIds.join(", ")}`);
    this.name = "UnknownToolOutcomeError";
  }
}

export class TaskOrchestrator {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly sandboxes: SandboxRepository,
    private readonly sandboxProvider: WorkspaceSandboxProvider,
    private readonly plans: PlanService,
    private readonly verifier: StepVerifier,
    private readonly artifacts: ArtifactStore,
    private readonly tools: ToolGateway,
    private readonly operations: ToolOperationRepository,
    private readonly checkpoints: CheckpointService,
    private readonly lease: RunLease,
  ) {}

  async run(taskId: string, projectRoot: string, driver: TaskDriver): Promise<TaskDetails> {
    let details = this.requireTask(taskId);
    if (!details.run) throw new Error(`Task ${taskId} has no active run`);
    if (isTerminalTaskStatus(details.run.status)) return details;
    if (details.run.status === "PAUSED" || details.run.status === "AWAITING_APPROVAL") {
      return details;
    }
    const leasedRunId = details.run.id;
    if (!this.lease.acquire(leasedRunId)) throw new RunLeaseUnavailableError(leasedRunId);
    const leaseRenewal = setInterval(() => {
      this.lease.renew(leasedRunId);
    }, 10_000);
    leaseRenewal.unref();
    const deadline = Date.parse(details.run.createdAt) + details.task.budget.wallClockMs;

    try {
      if (details.run.status === "CREATED") {
        details = this.transition(details, "PREPARING");
      }
      if (
        details.run &&
        ["PREPARING", "PLANNING", "EXECUTING", "VERIFYING", "REPLANNING"].includes(
          details.run.status,
        )
      ) {
        await driver.preflight?.();
      }
      if (details.run?.status === "PREPARING") {
        await this.prepareRun(details, projectRoot);
        assertWithinDeadline(deadline);
        details = this.requireTask(taskId);
      }
      if (details.run?.status === "PREPARING" || details.run?.status === "PLANNING") {
        await this.planRun(details, driver);
        assertWithinDeadline(deadline);
        details = this.requireTask(taskId);
      }
      if (details.run?.status === "REPLANNING") {
        await this.replanRun(details, driver, "Resume interrupted replan");
        details = this.requireTask(taskId);
      }

      if (
        details.run?.status === "EXECUTING" &&
        this.tasks.steps.list(details.run.id).some((step) => step.status === "RUNNING")
      ) {
        if (details.run.replanCount >= details.task.budget.maxReplans) {
          throw new Error(
            "Interrupted plan step requires replan but the replan budget is exhausted",
          );
        }
        await this.replanRun(
          details,
          driver,
          "Resume interrupted plan step from stable checkpoint",
        );
        details = this.requireTask(taskId);
      }

      while (details.run?.status === "EXECUTING") {
        assertWithinDeadline(deadline);
        try {
          const executed = await this.executeReadyStep(details, driver);
          if (!executed) break;
        } catch (error) {
          if (!(error instanceof StepExecutionError)) throw error;
          const current = this.requireTask(taskId);
          if (!current.run || current.run.replanCount >= current.task.budget.maxReplans)
            throw error;
          await this.replanRun(current, driver, error.message);
        }
        details = this.requireTask(taskId);
      }

      details = this.requireTask(taskId);
      if (details.run?.status === "EXECUTING") {
        const steps = this.tasks.steps.list(details.run.id);
        if (steps.length === 0 || steps.some((step) => step.status !== "SUCCEEDED")) {
          throw new Error(`TaskRun ${details.run.id} has no executable steps but is incomplete`);
        }
        details = this.transition(details, "VERIFYING");
      }
      if (details.run?.status === "VERIFYING") {
        assertWithinDeadline(deadline);
        await this.verifyRun(details);
        details = await this.finishRun(this.requireTask(taskId));
      }
      return details;
    } catch (error) {
      const current = this.requireTask(taskId);
      if (
        error instanceof ModelBlockedError &&
        current.run &&
        !isTerminalTaskStatus(current.run.status)
      ) {
        if (error.modelBlock.recoverable) {
          const checkpointed = this.tasks.runs.checkpoint(current.run.id, {
            boundary: "MODEL_BLOCKED",
            resumeStatus: current.run.status,
            modelBlock: error.modelBlock,
            recordedAt: new Date().toISOString(),
          });
          assertTaskTransition(checkpointed.status, "PAUSED");
          this.tasks.runs.transition(checkpointed, "PAUSED", "DIAGNOSTIC", {
            modelBlock: error.modelBlock,
          });
        } else {
          assertTaskTransition(current.run.status, "FAILED");
          this.tasks.runs.transition(current.run, "FAILED", "DIAGNOSTIC", {
            modelBlock: error.modelBlock,
          });
        }
        return this.requireTask(taskId);
      }
      if (current.run?.status === "PAUSED" || current.run?.status === "CANCELLED") {
        return current;
      }
      if (current.run && !isTerminalTaskStatus(current.run.status)) {
        assertTaskTransition(current.run.status, "FAILED");
        this.tasks.runs.transition(current.run, "FAILED", "DIAGNOSTIC", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      clearInterval(leaseRenewal);
      const final = this.requireTask(taskId);
      if (final.run) {
        this.lease.release(final.run.id);
        if (isTerminalTaskStatus(final.run.status)) {
          await this.cleanupTerminalTask(taskId);
        }
      }
    }
  }

  async prepareRun(details: TaskDetails, projectRoot: string): Promise<void> {
    const run = requireRun(details);
    if (run.status !== "PREPARING") {
      throw new Error(`TaskRun ${run.id} must be PREPARING before sandbox creation`);
    }
    const existing = this.sandboxes.getByRun(run.id);
    if (!existing) {
      const externalId = await this.sandboxProvider.createWorkspace(projectRoot);
      this.sandboxes.create({
        runId: run.id,
        provider: "docker",
        externalId,
        workspace: { schemaVersion: 1, source: projectRoot },
        resourceProfile: { schemaVersion: 1, profile: "offline-readonly-root-v1" },
      });
    }
    this.checkpoints.record(run.id, "SANDBOX_READY", {
      sandboxId: this.requireSandbox(run.id),
    });
  }

  async planRun(details: TaskDetails, driver: TaskDriver): Promise<void> {
    const planning =
      requireRun(details).status === "PLANNING" ? details : this.transition(details, "PLANNING");
    const run = requireRun(planning);
    const steps = await this.plans.create(
      run.id,
      planning.task.objective,
      planning.task.budget,
      driver,
    );
    this.tasks.runs.events.append(planning.task.id, run.id, "PLAN_UPDATED", {
      stepIds: steps.map((step) => step.id),
      stepCount: steps.length,
    });
    const checkpointed = this.checkpoints.record(run.id, "PLAN_COMMITTED", {
      stepIds: steps.map((step) => step.id),
    });
    assertTaskTransition(checkpointed.status, "EXECUTING");
    this.tasks.runs.transition(checkpointed, "EXECUTING");
  }

  async executeReadyStep(details: TaskDetails, driver: TaskDriver): Promise<boolean> {
    const run = requireRun(details);
    const steps = this.verifier.promoteReady(run.id);
    const step = steps.find((candidate) => candidate.status === "READY");
    if (!step) return false;
    assertStepTransition(step.status, "RUNNING");
    const running = this.tasks.steps.transition(step, "RUNNING");
    const sandboxId = this.requireSandbox(run.id);
    const toolbox: TaskToolbox = {
      call: (name, input) => {
        if (
          (name === "write_file" || name === "apply_edit") &&
          this.operations.countCapabilities(run.id, ["write_file", "apply_edit"]) >=
            details.task.budget.maxWriteOperations
        ) {
          throw new Error(
            `Task write budget of ${details.task.budget.maxWriteOperations} operation(s) is exhausted`,
          );
        }
        return this.tools.dispatch(name, input, {
          sandboxId,
          taskId: details.task.id,
          runId: run.id,
          stepId: running.id,
          toolCallId: randomUUID(),
          allowedPaths: running.allowedPaths,
        });
      },
    };

    const execution = await driver.executeStep({ step: running, tools: toolbox });
    const unknownOperations = this.operations.listUnknown(run.id);
    if (unknownOperations.length > 0) {
      const current = this.tasks.runs.get(run.id);
      if (current?.status === "EXECUTING") {
        this.tasks.runs.transition(current, "PAUSED", "DIAGNOSTIC", {
          reason: "unknown_tool_outcome",
          operationIds: unknownOperations.map((operation) => operation.id),
        });
      }
      throw new UnknownToolOutcomeError(unknownOperations.map((operation) => operation.id));
    }
    const verification: VerificationResult[] = [];
    for (const argv of running.verificationCommands) {
      const result = await toolbox.call("run_command", { argv });
      const resultDetails = result.details as
        | { exitCode?: unknown; stderr?: unknown; timedOut?: unknown }
        | undefined;
      verification.push({
        argv,
        exitCode: typeof resultDetails?.exitCode === "number" ? resultDetails.exitCode : 1,
        stdout: result.content,
        stderr: typeof resultDetails?.stderr === "string" ? resultDetails.stderr : "",
      });
    }

    const resultArtifact = await this.artifacts.put({
      taskRunId: run.id,
      name: `step-${running.position}-result.json`,
      mediaType: "application/json",
      bytes: Buffer.from(
        JSON.stringify(
          {
            schemaVersion: 1,
            summary: execution.summary,
            unresolvedItems: execution.unresolvedItems ?? [],
            verification,
          },
          null,
          2,
        ),
      ),
      producer: "task-orchestrator",
    });
    if (running.verificationCommands.length > 0 && !this.verifier.isSuccessful(verification)) {
      assertStepTransition(running.status, "FAILED");
      this.tasks.steps.transition(running, "FAILED", resultArtifact.id);
      throw new StepExecutionError(running.id, `Verification failed for step ${running.position}`);
    }
    assertStepTransition(running.status, "SUCCEEDED");
    this.tasks.steps.transition(running, "SUCCEEDED", resultArtifact.id);
    this.checkpoints.record(run.id, "PLAN_STEP_COMMITTED", {
      stepId: running.id,
      resultArtifactId: resultArtifact.id,
    });
    return true;
  }

  async replanRun(details: TaskDetails, driver: TaskDriver, reason: string): Promise<void> {
    const run = requireRun(details);
    let replanning = run;
    if (run.status !== "REPLANNING") {
      assertTaskTransition(run.status, "REPLANNING");
      replanning = this.tasks.runs.transition(run, "REPLANNING", "PLAN_UPDATED", { reason });
      replanning = this.tasks.runs.incrementReplan(replanning.id);
    }
    const steps = await this.plans.create(
      replanning.id,
      `${details.task.objective}\n\nReplan reason: ${reason}`,
      details.task.budget,
      driver,
    );
    this.checkpoints.record(replanning.id, "REPLAN_COMMITTED", {
      replanCount: replanning.replanCount,
      stepIds: steps.map((step) => step.id),
    });
    const current = this.tasks.runs.get(replanning.id);
    if (!current) throw new Error(`Unknown TaskRun ${replanning.id}`);
    assertTaskTransition(current.status, "EXECUTING");
    this.tasks.runs.transition(current, "EXECUTING");
  }

  async verifyRun(details: TaskDetails): Promise<void> {
    const run = requireRun(details);
    const sandboxId = this.requireSandbox(run.id);
    const diff = await this.tools.dispatch(
      "git_diff",
      {},
      {
        sandboxId,
        taskId: details.task.id,
        runId: run.id,
        toolCallId: randomUUID(),
        allowedPaths: ["**"],
      },
    );
    if (!diff.ok) throw new Error(`Failed to export patch: ${diff.content}`);
    const patch = await this.artifacts.put({
      taskRunId: run.id,
      name: "changes.patch",
      mediaType: "text/x-diff",
      bytes: Buffer.from(diff.content),
      producer: "task-orchestrator",
      retention: "release",
    });
    const stepResults = this.tasks.artifacts
      .listByRun(run.id)
      .filter((artifact) => /^step-\d+-result\.json$/u.test(artifact.name))
      .map((artifact) => ({ id: artifact.id, name: artifact.name, sha256: artifact.sha256 }));
    await this.artifacts.put({
      taskRunId: run.id,
      name: "test-results.json",
      mediaType: "application/json",
      bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, stepResults }, null, 2)),
      producer: "task-orchestrator",
      retention: "release",
    });
    const events = this.tasks.runs.events.list(run.id, 0, 10_000).events;
    await this.artifacts.put({
      taskRunId: run.id,
      name: "trace-summary.json",
      mediaType: "application/json",
      bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, events }, null, 2)),
      producer: "task-orchestrator",
      retention: "release",
    });
    const unresolvedItems = await this.collectUnresolvedItems(stepResults.map(({ id }) => id));
    await this.artifacts.put({
      taskRunId: run.id,
      name: "unresolved-items.json",
      mediaType: "application/json",
      bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, items: unresolvedItems }, null, 2)),
      producer: "task-orchestrator",
      retention: "release",
    });
    this.checkpoints.record(run.id, "FINAL_ARTIFACTS_COMMITTED", {
      patchArtifactId: patch.id,
      patchSha256: patch.sha256,
    });
  }

  async finishRun(details: TaskDetails): Promise<TaskDetails> {
    const run = requireRun(details);
    const current = this.tasks.runs.get(run.id) ?? run;
    assertTaskTransition(current.status, "SUCCEEDED");
    this.tasks.runs.transition(current, "SUCCEEDED");
    await this.cleanupTerminalTask(details.task.id);
    return this.requireTask(details.task.id);
  }

  async cleanupTerminalTask(taskId: string): Promise<void> {
    const details = this.requireTask(taskId);
    if (!details.run || !isTerminalTaskStatus(details.run.status)) return;
    const sandbox = this.sandboxes.getByRun(details.run.id);
    if (!sandbox || sandbox.status === "DESTROYED") return;
    try {
      await this.sandboxProvider.removeSandbox(sandbox.externalId);
      this.sandboxes.markDestroyed(details.run.id);
    } catch (error) {
      this.tasks.runs.events.append(details.task.id, details.run.id, "DIAGNOSTIC", {
        reason: "sandbox_cleanup_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private transition(details: TaskDetails, status: TaskRun["status"]): TaskDetails {
    const run = requireRun(details);
    assertTaskTransition(run.status, status);
    this.tasks.runs.transition(run, status);
    return this.requireTask(details.task.id);
  }

  private requireTask(taskId: string): TaskDetails {
    const details = this.tasks.details(taskId);
    if (!details) throw new Error(`Unknown task ${taskId}`);
    return details;
  }

  private requireSandbox(runId: string): string {
    const sandbox = this.sandboxes.getByRun(runId);
    if (sandbox?.status !== "READY") throw new Error(`TaskRun ${runId} has no sandbox`);
    return sandbox.externalId;
  }

  private async collectUnresolvedItems(artifactIds: readonly string[]): Promise<string[]> {
    const items: string[] = [];
    for (const artifactId of artifactIds) {
      const { bytes } = await this.artifacts.read(artifactId);
      const parsed = JSON.parse(bytes.toString("utf8")) as { unresolvedItems?: unknown };
      if (Array.isArray(parsed.unresolvedItems)) {
        for (const item of parsed.unresolvedItems) {
          if (typeof item === "string" && !items.includes(item)) items.push(item);
        }
      }
    }
    return items;
  }
}

function requireRun(details: TaskDetails): TaskRun {
  if (!details.run) throw new Error(`Task ${details.task.id} has no active run`);
  return details.run;
}

function assertWithinDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new Error("Task wall-clock budget is exhausted");
}
