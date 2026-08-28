import { createTaskRequestSchema } from "@noneedwork/protocol";
import { describe, expect, it } from "vitest";

import { RuntimeDatabase } from "../storage/database.js";
import { ProjectRepository } from "../storage/repositories/project-repository.js";
import { TaskRepository } from "../storage/repositories/task-repository.js";
import { ToolOperationRepository } from "../storage/repositories/tool-operation-repository.js";
import { RecoveryService } from "./recovery-service.js";
import { RunLease } from "./run-lease.js";
import { TaskService } from "./task-service.js";

function createFixture() {
  const database = new RuntimeDatabase(":memory:");
  const projects = new ProjectRepository(database);
  const project = projects.open("C:/task-lifecycle", "8".repeat(64));
  const tasks = new TaskRepository(database);
  const service = new TaskService(projects, tasks);
  const details = service.create(
    createTaskRequestSchema.parse({ projectId: project.id, objective: "Exercise lifecycle" }),
  );
  if (!details.run) throw new Error("Expected created TaskRun");
  return { database, tasks, service, details, runId: details.run.id };
}

function transitionToExecuting(tasks: TaskRepository, runId: string): void {
  const created = tasks.runs.get(runId);
  if (!created) throw new Error(`Expected TaskRun ${runId}`);
  const preparing = tasks.runs.transition(created, "PREPARING");
  const planning = tasks.runs.transition(preparing, "PLANNING");
  tasks.runs.transition(planning, "EXECUTING");
}

describe("durable task lifecycle", () => {
  it("cancels idempotently without appending duplicate state transitions", () => {
    const fixture = createFixture();
    try {
      const first = fixture.service.control(fixture.details.task.id, "cancel");
      const second = fixture.service.control(fixture.details.task.id, "cancel");

      expect(first.task.status).toBe("CANCELLED");
      expect(second.task.status).toBe("CANCELLED");
      expect(fixture.tasks.runs.events.list(fixture.runId).events).toHaveLength(2);
    } finally {
      fixture.database.close();
    }
  });

  it("records and restores a safe pause checkpoint", () => {
    const fixture = createFixture();
    try {
      transitionToExecuting(fixture.tasks, fixture.runId);
      const paused = fixture.service.control(fixture.details.task.id, "pause");
      const resumed = fixture.service.control(fixture.details.task.id, "resume");

      expect(paused.run?.status).toBe("PAUSED");
      expect(paused.run?.checkpoint).toMatchObject({
        boundary: "USER_PAUSE",
        resumeStatus: "EXECUTING",
      });
      expect(resumed.run?.status).toBe("EXECUTING");
    } finally {
      fixture.database.close();
    }
  });

  it("acquires, renews, and recovers an expired run lease", () => {
    const fixture = createFixture();
    try {
      const { runId } = fixture;
      let now = new Date("2026-08-28T00:00:00.000Z");
      const first = new RunLease(fixture.tasks.runs, "runtime-a", 30_000, () => now);
      const second = new RunLease(fixture.tasks.runs, "runtime-b", 30_000, () => now);

      expect(first.acquire(runId)).toBe(true);
      expect(second.acquire(runId)).toBe(false);
      now = new Date("2026-08-28T00:00:10.000Z");
      expect(first.renew(runId)).toBe(true);
      now = new Date("2026-08-28T00:00:41.000Z");
      const decisions = new RecoveryService(
        fixture.tasks.runs,
        new ToolOperationRepository(fixture.database),
        () => now,
      ).scan();

      expect(decisions).toEqual([
        expect.objectContaining({ runId, action: "RESUME_FROM_CHECKPOINT" }),
      ]);
      expect(fixture.tasks.runs.get(runId)?.leaseOwner).toBeNull();
    } finally {
      fixture.database.close();
    }
  });

  it("waits for a live run lease instead of failing the recovered task", () => {
    // GIVEN: A previous Runtime lease that has not expired yet
    const fixture = createFixture();
    try {
      const { runId } = fixture;
      const acquiredAt = new Date("2026-08-28T00:00:00.000Z");
      const lease = new RunLease(fixture.tasks.runs, "runtime-a", 30_000, () => acquiredAt);
      expect(lease.acquire(runId)).toBe(true);

      // WHEN: Another Runtime scans the ledger before lease expiry
      const decisions = new RecoveryService(
        fixture.tasks.runs,
        new ToolOperationRepository(fixture.database),
        () => new Date("2026-08-28T00:00:10.000Z"),
      ).scan();

      // THEN: Recovery defers resume and leaves the lease and TaskRun intact
      expect(decisions).toEqual([
        expect.objectContaining({
          runId,
          action: "WAIT_FOR_LEASE",
          resumeAfter: "2026-08-28T00:00:30.000Z",
        }),
      ]);
      expect(fixture.tasks.runs.get(runId)).toMatchObject({
        status: "CREATED",
        leaseOwner: "runtime-a",
      });
    } finally {
      fixture.database.close();
    }
  });

  it("fails closed when recovery finds an operation with unknown outcome", () => {
    const fixture = createFixture();
    try {
      const { runId } = fixture;
      transitionToExecuting(fixture.tasks, runId);
      const operations = new ToolOperationRepository(fixture.database);
      const operation = operations.createIntent({
        runId,
        toolCallId: "unknown-operation",
        capability: "write_file",
        argsHash: "7".repeat(64),
        args: { path: "README.md" },
      });
      operations.markStarted(operation.id);

      const decisions = new RecoveryService(fixture.tasks.runs, operations).scan();

      expect(decisions).toEqual([
        expect.objectContaining({ runId, action: "VERIFY_UNKNOWN_OUTCOME" }),
      ]);
      expect(fixture.tasks.runs.get(runId)?.status).toBe("PAUSED");
      expect(
        fixture.database.connection
          .prepare("SELECT state FROM tool_operations WHERE id = ?")
          .get(operation.id),
      ).toEqual({ state: "UNKNOWN_OUTCOME" });
    } finally {
      fixture.database.close();
    }
  });
});
