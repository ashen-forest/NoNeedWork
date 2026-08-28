import { createOperationId } from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";

export const toolOperationStateSchema = z.enum([
  "INTENT",
  "OPERATION_STARTED",
  "OPERATION_FINISHED",
  "UNKNOWN_OUTCOME",
]);

export const toolOperationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string().nullable(),
  toolCallId: z.string(),
  capability: z.string(),
  argsHash: z.string(),
  args: z.unknown(),
  state: toolOperationStateSchema,
  resultArtifactId: z.string().nullable(),
  createdAt: z.string(),
});
export type ToolOperation = z.infer<typeof toolOperationSchema>;

const toolOperationRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  step_id: z.string().nullable(),
  tool_call_id: z.string(),
  capability: z.string(),
  args_hash: z.string(),
  args_json: z.string(),
  state: z.string(),
  result_artifact_id: z.string().nullable(),
  created_at: z.string(),
});

export class ToolOperationRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  createIntent(input: {
    runId: string;
    stepId?: string;
    toolCallId: string;
    capability: string;
    argsHash: string;
    args: unknown;
  }): ToolOperation {
    const operation = toolOperationSchema.parse({
      id: createOperationId(),
      runId: input.runId,
      stepId: input.stepId ?? null,
      toolCallId: input.toolCallId,
      capability: input.capability,
      argsHash: input.argsHash,
      args: input.args,
      state: "INTENT",
      resultArtifactId: null,
      createdAt: new Date().toISOString(),
    });
    this.database.connection
      .prepare(`
        INSERT INTO tool_operations(
          id, run_id, step_id, tool_call_id, capability, args_hash,
          args_json, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        operation.id,
        operation.runId,
        operation.stepId,
        operation.toolCallId,
        operation.capability,
        operation.argsHash,
        encodePersistedJson(operation.args),
        operation.state,
        operation.createdAt,
      );
    return operation;
  }

  markStarted(id: string, sandboxOperationId?: string): void {
    this.database.connection
      .prepare(`
        UPDATE tool_operations
        SET state = 'OPERATION_STARTED', sandbox_operation_id = ?, started_at = ?
        WHERE id = ? AND state = 'INTENT'
      `)
      .run(sandboxOperationId ?? null, new Date().toISOString(), id);
  }

  markFinished(id: string, resultArtifactId: string): void {
    this.database.connection
      .prepare(`
        UPDATE tool_operations
        SET state = 'OPERATION_FINISHED', result_artifact_id = ?, finished_at = ?
        WHERE id = ? AND state = 'OPERATION_STARTED'
      `)
      .run(resultArtifactId, new Date().toISOString(), id);
  }

  listUnknown(runId: string): ToolOperation[] {
    return this.database.connection
      .prepare(`
        SELECT * FROM tool_operations
        WHERE run_id = ? AND state IN ('OPERATION_STARTED', 'UNKNOWN_OUTCOME')
        ORDER BY created_at ASC
      `)
      .all(runId)
      .map(parseToolOperation);
  }

  countCapabilities(runId: string, capabilities: readonly string[]): number {
    if (capabilities.length === 0) return 0;
    const placeholders = capabilities.map(() => "?").join(", ");
    const row = this.database.connection
      .prepare(`
        SELECT COUNT(*) AS count FROM tool_operations
        WHERE run_id = ? AND capability IN (${placeholders})
      `)
      .get(runId, ...capabilities) as { count: number };
    return row.count;
  }

  markUnknown(id: string, resultArtifactId?: string): void {
    this.database.connection
      .prepare(`
        UPDATE tool_operations
        SET state = 'UNKNOWN_OUTCOME', result_artifact_id = COALESCE(?, result_artifact_id),
            finished_at = ?
        WHERE id = ? AND state = 'OPERATION_STARTED'
      `)
      .run(resultArtifactId ?? null, new Date().toISOString(), id);
  }
}

function parseToolOperation(raw: unknown): ToolOperation {
  const row = toolOperationRowSchema.parse(raw);
  return toolOperationSchema.parse({
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    toolCallId: row.tool_call_id,
    capability: row.capability,
    argsHash: row.args_hash,
    args: decodePersistedJson(row.args_json, z.unknown()),
    state: row.state,
    resultArtifactId: row.result_artifact_id,
    createdAt: row.created_at,
  });
}
