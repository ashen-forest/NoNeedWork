import { type Artifact, artifactSchema, createArtifactId } from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";

const artifactRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  sha256: z.string(),
  media_type: z.string(),
  size: z.number().int().nonnegative(),
  name: z.string(),
  producer: z.string(),
  retention: z.string(),
  filesystem_path: z.string(),
  created_at: z.string(),
});

export interface StoredArtifact extends Artifact {
  producer: string;
  filesystemPath: string;
}

export interface NewArtifactRecord {
  taskRunId: string;
  sha256: string;
  mediaType: string;
  size: number;
  name: string;
  producer: string;
  retention?: "task" | "release" | "permanent";
  filesystemPath: string;
}

export class ArtifactRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  create(input: NewArtifactRecord): StoredArtifact {
    const record = parseStoredArtifact({
      id: createArtifactId(),
      run_id: input.taskRunId,
      sha256: input.sha256,
      media_type: input.mediaType,
      size: input.size,
      name: input.name,
      producer: input.producer,
      retention: input.retention ?? "task",
      filesystem_path: input.filesystemPath,
      created_at: new Date().toISOString(),
    });
    this.database.connection
      .prepare(`
        INSERT INTO artifacts(
          id, run_id, sha256, media_type, size, name, producer,
          retention, filesystem_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.taskRunId,
        record.sha256,
        record.mediaType,
        record.size,
        record.name,
        record.producer,
        record.retention,
        record.filesystemPath,
        record.createdAt,
      );
    return record;
  }

  get(id: string): StoredArtifact | undefined {
    const row = this.database.connection.prepare("SELECT * FROM artifacts WHERE id = ?").get(id);
    return row ? parseStoredArtifact(row) : undefined;
  }

  listByRun(runId: string): StoredArtifact[] {
    return this.database.connection
      .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId)
      .map(parseStoredArtifact);
  }

  countReferences(sha256: string): number {
    const row = this.database.connection
      .prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sha256 = ?")
      .get(sha256) as { count: number };
    return row.count;
  }
}

function parseStoredArtifact(raw: unknown): StoredArtifact {
  const row = artifactRowSchema.parse(raw);
  const artifact = artifactSchema.parse({
    id: row.id,
    taskRunId: row.run_id,
    sha256: row.sha256,
    mediaType: row.media_type,
    size: row.size,
    name: row.name,
    retention: row.retention,
    createdAt: row.created_at,
  });
  return { ...artifact, producer: row.producer, filesystemPath: row.filesystem_path };
}
