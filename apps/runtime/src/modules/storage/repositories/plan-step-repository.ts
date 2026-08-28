import {
  type PlanStep,
  type PlanStepStatus,
  planStepSchema,
  type TaskRunId,
} from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";
import { StateConflictError } from "./task-run-repository.js";

const stringArraySchema = z.array(z.string());
const commandArraySchema = z.array(z.array(z.string().min(1)).min(1));
const planStepRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  position: z.number().int().nonnegative(),
  objective: z.string(),
  dependencies_json: z.string(),
  acceptance_json: z.string(),
  allowed_paths_json: z.string(),
  verification_commands_json: z.string(),
  requires_write: z.number().int(),
  status: z.string(),
  state_version: z.number().int().nonnegative(),
  result_artifact_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export interface NewPlanStep {
  id: string;
  taskRunId: TaskRunId;
  position: number;
  objective: string;
  dependencies: readonly string[];
  acceptanceCriteria: readonly string[];
  allowedPaths: readonly string[];
  verificationCommands: readonly (readonly string[])[];
  requiresWrite: boolean;
  status: PlanStepStatus;
}

export class PlanStepRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  replaceForRun(runId: TaskRunId, steps: readonly NewPlanStep[]): PlanStep[] {
    return this.database.transaction(() => {
      this.database.connection.prepare("DELETE FROM plan_steps WHERE run_id = ?").run(runId);
      const insert = this.database.connection.prepare(`
        INSERT INTO plan_steps(
          id, run_id, position, objective, dependencies_json, acceptance_json,
          allowed_paths_json, verification_commands_json, requires_write,
          status, state_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      const now = new Date().toISOString();
      for (const step of steps) {
        insert.run(
          step.id,
          step.taskRunId,
          step.position,
          step.objective,
          encodePersistedJson(step.dependencies),
          encodePersistedJson(step.acceptanceCriteria),
          encodePersistedJson(step.allowedPaths),
          encodePersistedJson(step.verificationCommands),
          step.requiresWrite ? 1 : 0,
          step.status,
          now,
          now,
        );
      }
      return this.list(runId);
    });
  }

  get(id: string): PlanStep | undefined {
    const row = this.database.connection.prepare("SELECT * FROM plan_steps WHERE id = ?").get(id);
    return row ? parsePlanStep(row) : undefined;
  }

  list(runId: string): PlanStep[] {
    return this.database.connection
      .prepare("SELECT * FROM plan_steps WHERE run_id = ? ORDER BY position ASC")
      .all(runId)
      .map(parsePlanStep);
  }

  transition(step: PlanStep, nextStatus: PlanStepStatus, resultArtifactId?: string): PlanStep {
    const now = new Date().toISOString();
    const result = this.database.connection
      .prepare(`
        UPDATE plan_steps
        SET status = ?, state_version = state_version + 1,
            result_artifact_id = COALESCE(?, result_artifact_id), updated_at = ?
        WHERE id = ? AND state_version = ? AND status = ?
      `)
      .run(nextStatus, resultArtifactId ?? null, now, step.id, step.stateVersion, step.status);
    if (Number(result.changes) !== 1) {
      throw new StateConflictError(`PlanStep ${step.id} changed concurrently`);
    }
    const updated = this.get(step.id);
    if (!updated) throw new Error(`PlanStep ${step.id} disappeared after transition`);
    return updated;
  }
}

export function parsePlanStep(raw: unknown): PlanStep {
  const row = planStepRowSchema.parse(raw);
  return planStepSchema.parse({
    id: row.id,
    taskRunId: row.run_id,
    position: row.position,
    objective: row.objective,
    dependencies: decodePersistedJson(row.dependencies_json, stringArraySchema),
    acceptanceCriteria: decodePersistedJson(row.acceptance_json, stringArraySchema),
    allowedPaths: decodePersistedJson(row.allowed_paths_json, stringArraySchema),
    verificationCommands: decodePersistedJson(row.verification_commands_json, commandArraySchema),
    requiresWrite: row.requires_write === 1,
    status: row.status,
    stateVersion: row.state_version,
    resultArtifactId: row.result_artifact_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
