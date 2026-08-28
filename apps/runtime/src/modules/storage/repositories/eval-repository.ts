import { createEvalResultId, createEvalRunId } from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";

const recordSchema = z.record(z.string(), z.unknown());
const evalRunRowSchema = z.object({
  id: z.string(),
  suite: z.string(),
  config_json: z.string(),
  status: z.string(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
const evalResultRowSchema = z.object({
  id: z.string(),
  eval_run_id: z.string(),
  case_id: z.string(),
  verdict: z.string(),
  metrics_json: z.string(),
  evidence_json: z.string(),
  created_at: z.string(),
});

export interface EvalRunRecord {
  id: string;
  suite: string;
  config: Record<string, unknown>;
  status: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface EvalResultRecord {
  id: string;
  evalRunId: string;
  caseId: string;
  verdict: string;
  metrics: Record<string, unknown>;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export class EvalRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  createRun(input: { suite: string; config: Record<string, unknown> }): EvalRunRecord {
    const id = createEvalRunId();
    const createdAt = new Date().toISOString();
    this.database.connection
      .prepare(`
        INSERT INTO eval_runs(id, suite, config_json, status, created_at)
        VALUES (?, ?, ?, 'CREATED', ?)
      `)
      .run(id, input.suite, encodePersistedJson(input.config), createdAt);
    const run = this.getRun(id);
    if (!run) throw new Error(`EvalRun ${id} disappeared after creation`);
    return run;
  }

  getRun(id: string): EvalRunRecord | undefined {
    const row = this.database.connection.prepare("SELECT * FROM eval_runs WHERE id = ?").get(id);
    return row ? parseEvalRun(row) : undefined;
  }

  createResult(input: {
    evalRunId: string;
    caseId: string;
    verdict: string;
    metrics: Record<string, unknown>;
    evidence: Record<string, unknown>;
  }): EvalResultRecord {
    const id = createEvalResultId();
    const createdAt = new Date().toISOString();
    this.database.connection
      .prepare(`
        INSERT INTO eval_results(
          id, eval_run_id, case_id, verdict, metrics_json, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.evalRunId,
        input.caseId,
        input.verdict,
        encodePersistedJson(input.metrics),
        encodePersistedJson(input.evidence),
        createdAt,
      );
    const result = this.getResult(id);
    if (!result) throw new Error(`EvalResult ${id} disappeared after creation`);
    return result;
  }

  getResult(id: string): EvalResultRecord | undefined {
    const row = this.database.connection.prepare("SELECT * FROM eval_results WHERE id = ?").get(id);
    return row ? parseEvalResult(row) : undefined;
  }

  listResults(evalRunId: string): EvalResultRecord[] {
    return this.database.connection
      .prepare("SELECT * FROM eval_results WHERE eval_run_id = ? ORDER BY case_id ASC")
      .all(evalRunId)
      .map(parseEvalResult);
  }
}

function parseEvalRun(raw: unknown): EvalRunRecord {
  const row = evalRunRowSchema.parse(raw);
  return {
    id: row.id,
    suite: row.suite,
    config: decodePersistedJson(row.config_json, recordSchema),
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

function parseEvalResult(raw: unknown): EvalResultRecord {
  const row = evalResultRowSchema.parse(raw);
  return {
    id: row.id,
    evalRunId: row.eval_run_id,
    caseId: row.case_id,
    verdict: row.verdict,
    metrics: decodePersistedJson(row.metrics_json, recordSchema),
    evidence: decodePersistedJson(row.evidence_json, recordSchema),
    createdAt: row.created_at,
  };
}
