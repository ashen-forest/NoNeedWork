import type { TaskRun } from "@noneedwork/protocol";
import { createModelBlock } from "../models/model-errors.js";
import type { ModelBindingReader } from "../models/model-service.js";
import type { TaskRunRepository } from "../storage/repositories/task-run-repository.js";
import type { ToolOperationRepository } from "../storage/repositories/tool-operation-repository.js";
import { assertTaskTransition } from "./task-state-machine.js";

export interface RecoveryDecision {
  runId: string;
  action:
    | "RESUME_FROM_CHECKPOINT"
    | "WAIT_FOR_APPROVAL"
    | "WAIT_FOR_MODEL"
    | "WAIT_FOR_LEASE"
    | "VERIFY_UNKNOWN_OUTCOME";
  checkpoint: Record<string, unknown> | null;
  resumeAfter?: string;
}

export class RecoveryService {
  constructor(
    private readonly runs: TaskRunRepository,
    private readonly operations: ToolOperationRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly modelBindings?: ModelBindingReader,
  ) {}

  scan(): RecoveryDecision[] {
    return this.runs.listRecoverable().map((run) => this.recover(run));
  }

  private recover(run: TaskRun): RecoveryDecision {
    const now = this.now().toISOString();
    if (run.leaseOwner) {
      if (run.leaseExpiresAt && run.leaseExpiresAt > now) {
        return {
          runId: run.id,
          action: "WAIT_FOR_LEASE",
          checkpoint: run.checkpoint,
          resumeAfter: run.leaseExpiresAt,
        };
      }
      this.runs.releaseLease(run.id, run.leaseOwner);
    }

    if (this.modelBindings && !this.modelBindings.get(run.id)) {
      const modelBlock = createModelBlock({
        reason: "MODEL_BINDING_MISSING",
        profileId: "qwen-cn",
        modelId: "qwen3.7-plus",
      });
      const checkpointed = this.runs.checkpoint(run.id, {
        boundary: "MODEL_BLOCKED",
        modelBlock,
        recordedAt: now,
      });
      let latest = checkpointed;
      if (latest.status !== "PAUSED") {
        assertTaskTransition(latest.status, "PAUSED");
        latest = this.runs.transition(latest, "PAUSED", "DIAGNOSTIC", { modelBlock });
      }
      return { runId: latest.id, action: "WAIT_FOR_MODEL", checkpoint: latest.checkpoint };
    }

    const unknown = this.operations.listUnknown(run.id);
    if (unknown.length > 0) {
      for (const operation of unknown) this.operations.markUnknown(operation.id);
      let latest = this.runs.get(run.id) ?? run;
      if (latest.status !== "PAUSED") {
        assertTaskTransition(latest.status, "PAUSED");
        latest = this.runs.transition(latest, "PAUSED", "DIAGNOSTIC", {
          reason: "unknown_tool_outcome",
          operationIds: unknown.map((operation) => operation.id),
        });
      }
      return {
        runId: latest.id,
        action: "VERIFY_UNKNOWN_OUTCOME",
        checkpoint: latest.checkpoint,
      };
    }

    if (run.status === "AWAITING_APPROVAL") {
      return { runId: run.id, action: "WAIT_FOR_APPROVAL", checkpoint: run.checkpoint };
    }
    return { runId: run.id, action: "RESUME_FROM_CHECKPOINT", checkpoint: run.checkpoint };
  }
}
