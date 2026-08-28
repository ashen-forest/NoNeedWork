import { type EventType, type TaskRun, type TaskStatus, taskRunSchema } from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";
import { RunEventRepository } from "./run-event-repository.js";

const nullableRecordSchema = z.record(z.string(), z.unknown()).nullable();
const taskRunRowSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  status: z.string(),
  state_version: z.number().int().nonnegative(),
  replan_count: z.number().int().nonnegative(),
  lease_owner: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  checkpoint_json: z.string().nullable(),
  pi_session_id: z.string().nullable(),
  pi_session_file: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  finished_at: z.string().nullable(),
});

export class StateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateConflictError";
  }
}

export class TaskRunRepository {
  readonly events: RunEventRepository;

  constructor(private readonly database: RuntimeDatabase) {
    this.events = new RunEventRepository(database);
  }

  get(id: string): TaskRun | undefined {
    const row = this.database.connection.prepare("SELECT * FROM task_runs WHERE id = ?").get(id);
    return row ? parseTaskRun(row) : undefined;
  }

  listRecoverable(): TaskRun[] {
    return this.database.connection
      .prepare(`
        SELECT * FROM task_runs
        WHERE status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
        ORDER BY created_at ASC
      `)
      .all()
      .map(parseTaskRun);
  }

  transition(
    run: TaskRun,
    nextStatus: TaskStatus,
    eventType: EventType = "TASK_STATE_CHANGED",
    payload: Record<string, unknown> = {},
  ): TaskRun {
    return this.database.transaction(() => {
      const now = new Date().toISOString();
      const finishedAt = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(nextStatus) ? now : null;
      const result = this.database.connection
        .prepare(`
          UPDATE task_runs
          SET status = ?, state_version = state_version + 1, updated_at = ?, finished_at = ?
          WHERE id = ? AND state_version = ? AND status = ?
        `)
        .run(nextStatus, now, finishedAt, run.id, run.stateVersion, run.status);
      if (Number(result.changes) !== 1) {
        throw new StateConflictError(`TaskRun ${run.id} changed concurrently`);
      }
      this.database.connection
        .prepare(`
          UPDATE tasks
          SET status = ?, state_version = state_version + 1, updated_at = ?
          WHERE id = ?
        `)
        .run(nextStatus, now, run.taskId);
      this.events.append(run.taskId, run.id, eventType, {
        from: run.status,
        to: nextStatus,
        ...payload,
      });
      const updated = this.get(run.id);
      if (!updated) throw new Error(`TaskRun ${run.id} disappeared after transition`);
      return updated;
    });
  }

  acquireLease(runId: string, owner: string, expiresAt: string, now: string): boolean {
    const result = this.database.connection
      .prepare(`
        UPDATE task_runs
        SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ?
          AND (lease_owner IS NULL OR lease_owner = ? OR lease_expires_at <= ?)
      `)
      .run(owner, expiresAt, now, runId, owner, now);
    return Number(result.changes) === 1;
  }

  renewLease(runId: string, owner: string, expiresAt: string, now: string): boolean {
    const result = this.database.connection
      .prepare(`
        UPDATE task_runs SET lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND lease_owner = ?
      `)
      .run(expiresAt, now, runId, owner);
    return Number(result.changes) === 1;
  }

  releaseLease(runId: string, owner: string): void {
    this.database.connection
      .prepare(`
        UPDATE task_runs SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND lease_owner = ?
      `)
      .run(new Date().toISOString(), runId, owner);
  }

  checkpoint(runId: string, checkpoint: Record<string, unknown>): TaskRun {
    const now = new Date().toISOString();
    this.database.connection
      .prepare(`
        UPDATE task_runs
        SET checkpoint_json = ?, state_version = state_version + 1, updated_at = ?
        WHERE id = ?
      `)
      .run(encodePersistedJson(checkpoint), now, runId);
    const updated = this.get(runId);
    if (!updated) throw new Error(`Unknown TaskRun ${runId}`);
    return updated;
  }

  incrementReplan(runId: string): TaskRun {
    this.database.connection
      .prepare(`
        UPDATE task_runs
        SET replan_count = replan_count + 1, state_version = state_version + 1, updated_at = ?
        WHERE id = ?
      `)
      .run(new Date().toISOString(), runId);
    const updated = this.get(runId);
    if (!updated) throw new Error(`Unknown TaskRun ${runId}`);
    return updated;
  }

  bindPiSession(runId: string, sessionId: string, sessionFile?: string): TaskRun {
    const now = new Date().toISOString();
    this.database.connection
      .prepare(`
        UPDATE task_runs
        SET pi_session_id = ?, pi_session_file = ?, state_version = state_version + 1, updated_at = ?
        WHERE id = ?
      `)
      .run(sessionId, sessionFile ?? null, now, runId);
    const updated = this.get(runId);
    if (!updated) throw new Error(`Unknown TaskRun ${runId}`);
    return updated;
  }
}

export function parseTaskRun(raw: unknown): TaskRun {
  const row = taskRunRowSchema.parse(raw);
  return taskRunSchema.parse({
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    stateVersion: row.state_version,
    replanCount: row.replan_count,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    checkpoint: row.checkpoint_json
      ? decodePersistedJson(row.checkpoint_json, nullableRecordSchema)
      : null,
    piSessionId: row.pi_session_id,
    piSessionFile: row.pi_session_file,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  });
}
