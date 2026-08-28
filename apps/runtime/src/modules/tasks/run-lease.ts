import type { TaskRunRepository } from "../storage/repositories/task-run-repository.js";

export class RunLease {
  constructor(
    private readonly runs: TaskRunRepository,
    private readonly owner: string,
    private readonly durationMs = 30_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  acquire(runId: string): boolean {
    const now = this.now();
    return this.runs.acquireLease(
      runId,
      this.owner,
      new Date(now.getTime() + this.durationMs).toISOString(),
      now.toISOString(),
    );
  }

  renew(runId: string): boolean {
    const now = this.now();
    return this.runs.renewLease(
      runId,
      this.owner,
      new Date(now.getTime() + this.durationMs).toISOString(),
      now.toISOString(),
    );
  }

  release(runId: string): void {
    this.runs.releaseLease(runId, this.owner);
  }
}
