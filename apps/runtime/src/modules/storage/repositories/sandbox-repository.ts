import { createSandboxId } from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";

const sandboxRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  provider: z.string(),
  external_id: z.string(),
  workspace_json: z.string(),
  resource_profile_json: z.string(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  destroyed_at: z.string().nullable(),
});
const recordSchema = z.record(z.string(), z.unknown());

export interface SandboxRecord {
  id: string;
  runId: string;
  provider: string;
  externalId: string;
  workspace: Record<string, unknown>;
  resourceProfile: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
  destroyedAt: string | null;
}

export class SandboxRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  create(input: {
    runId: string;
    provider: string;
    externalId: string;
    workspace: Record<string, unknown>;
    resourceProfile: Record<string, unknown>;
  }): SandboxRecord {
    const now = new Date().toISOString();
    const id = createSandboxId();
    this.database.connection
      .prepare(`
        INSERT INTO sandboxes(
          id, run_id, provider, external_id, workspace_json,
          resource_profile_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, ?)
      `)
      .run(
        id,
        input.runId,
        input.provider,
        input.externalId,
        encodePersistedJson(input.workspace),
        encodePersistedJson(input.resourceProfile),
        now,
        now,
      );
    const record = this.getByRun(input.runId);
    if (!record) throw new Error(`Sandbox ${id} disappeared after creation`);
    return record;
  }

  getByRun(runId: string): SandboxRecord | undefined {
    const row = this.database.connection
      .prepare("SELECT * FROM sandboxes WHERE run_id = ?")
      .get(runId);
    return row ? parseSandbox(row) : undefined;
  }

  markDestroyed(runId: string): void {
    const now = new Date().toISOString();
    this.database.connection
      .prepare(`
        UPDATE sandboxes SET status = 'DESTROYED', destroyed_at = ?, updated_at = ?
        WHERE run_id = ?
      `)
      .run(now, now, runId);
  }
}

function parseSandbox(raw: unknown): SandboxRecord {
  const row = sandboxRowSchema.parse(raw);
  return {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    externalId: row.external_id,
    workspace: decodePersistedJson(row.workspace_json, recordSchema),
    resourceProfile: decodePersistedJson(row.resource_profile_json, recordSchema),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    destroyedAt: row.destroyed_at,
  };
}
