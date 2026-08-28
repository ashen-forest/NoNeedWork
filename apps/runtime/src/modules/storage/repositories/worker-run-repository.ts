import { createWorkerRunId, type TaskBudget, taskBudgetSchema } from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";

const resultSchema = z.record(z.string(), z.unknown());
const workerRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  parent_step_id: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  pi_session_id: z.string().nullable(),
  budget_json: z.string(),
  result_json: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export interface WorkerRunRecord {
  id: string;
  runId: string;
  parentStepId: string | null;
  role: string;
  status: string;
  piSessionId: string | null;
  budget: TaskBudget;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export class WorkerRunRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  create(input: {
    runId: string;
    parentStepId?: string;
    role: string;
    budget: TaskBudget;
  }): WorkerRunRecord {
    const id = createWorkerRunId();
    const now = new Date().toISOString();
    this.database.connection
      .prepare(`
        INSERT INTO worker_runs(
          id, run_id, parent_step_id, role, status, budget_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'CREATED', ?, ?, ?)
      `)
      .run(
        id,
        input.runId,
        input.parentStepId ?? null,
        input.role,
        encodePersistedJson(taskBudgetSchema.parse(input.budget)),
        now,
        now,
      );
    const worker = this.get(id);
    if (!worker) throw new Error(`WorkerRun ${id} disappeared after creation`);
    return worker;
  }

  get(id: string): WorkerRunRecord | undefined {
    const row = this.database.connection.prepare("SELECT * FROM worker_runs WHERE id = ?").get(id);
    return row ? parseWorkerRun(row) : undefined;
  }

  listByRun(runId: string): WorkerRunRecord[] {
    return this.database.connection
      .prepare("SELECT * FROM worker_runs WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId)
      .map(parseWorkerRun);
  }
}

function parseWorkerRun(raw: unknown): WorkerRunRecord {
  const row = workerRowSchema.parse(raw);
  return {
    id: row.id,
    runId: row.run_id,
    parentStepId: row.parent_step_id,
    role: row.role,
    status: row.status,
    piSessionId: row.pi_session_id,
    budget: decodePersistedJson(row.budget_json, taskBudgetSchema),
    result: row.result_json ? decodePersistedJson(row.result_json, resultSchema) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
