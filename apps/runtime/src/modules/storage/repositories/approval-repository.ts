import { createApprovalId } from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";

const resourceSchema = z.record(z.string(), z.unknown());
const approvalRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  step_id: z.string().nullable(),
  capability: z.string(),
  resource_json: z.string(),
  binding_hash: z.string(),
  nonce: z.string(),
  expires_at: z.string(),
  decision: z.string(),
  decided_at: z.string().nullable(),
  consumed_at: z.string().nullable(),
  created_at: z.string(),
});

export interface ApprovalRecord {
  id: string;
  runId: string;
  stepId: string | null;
  capability: string;
  resource: Record<string, unknown>;
  bindingHash: string;
  nonce: string;
  expiresAt: string;
  decision: string;
  decidedAt: string | null;
  consumedAt: string | null;
  createdAt: string;
}

export class ApprovalRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  create(input: {
    runId: string;
    stepId?: string;
    capability: string;
    resource: Record<string, unknown>;
    bindingHash: string;
    nonce: string;
    expiresAt: string;
    decision?: string;
  }): ApprovalRecord {
    const id = createApprovalId();
    const createdAt = new Date().toISOString();
    this.database.connection
      .prepare(`
        INSERT INTO approvals(
          id, run_id, step_id, capability, resource_json, binding_hash,
          nonce, expires_at, decision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.runId,
        input.stepId ?? null,
        input.capability,
        encodePersistedJson(input.resource),
        input.bindingHash,
        input.nonce,
        input.expiresAt,
        input.decision ?? "PENDING",
        createdAt,
      );
    return this.require(id);
  }

  get(id: string): ApprovalRecord | undefined {
    const row = this.database.connection.prepare("SELECT * FROM approvals WHERE id = ?").get(id);
    return row ? parseApproval(row) : undefined;
  }

  listByRun(runId: string): ApprovalRecord[] {
    return this.database.connection
      .prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId)
      .map(parseApproval);
  }

  private require(id: string): ApprovalRecord {
    const approval = this.get(id);
    if (!approval) throw new Error(`Approval ${id} disappeared after creation`);
    return approval;
  }
}

function parseApproval(raw: unknown): ApprovalRecord {
  const row = approvalRowSchema.parse(raw);
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    capability: row.capability,
    resource: decodePersistedJson(row.resource_json, resourceSchema),
    bindingHash: row.binding_hash,
    nonce: row.nonce,
    expiresAt: row.expires_at,
    decision: row.decision,
    decidedAt: row.decided_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}
