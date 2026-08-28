import type { TaskRun } from "@noneedwork/protocol";

import type { TaskRunRepository } from "../storage/repositories/task-run-repository.js";

export class CheckpointService {
  constructor(private readonly runs: TaskRunRepository) {}

  record(runId: string, boundary: string, data: Record<string, unknown> = {}): TaskRun {
    const checkpoint = {
      boundary,
      recordedAt: new Date().toISOString(),
      ...data,
    };
    const run = this.runs.checkpoint(runId, checkpoint);
    this.runs.events.append(run.taskId, run.id, "CHECKPOINT_CREATED", checkpoint);
    return run;
  }
}
