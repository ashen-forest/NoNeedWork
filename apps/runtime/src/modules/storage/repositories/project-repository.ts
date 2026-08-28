import { createProjectId, type Project, projectSchema } from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";

const projectRowSchema = z.object({
  id: z.string(),
  root_path: z.string(),
  fingerprint: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export class ProjectRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  open(rootPath: string, fingerprint: string): Project {
    const existing = this.findByRoot(rootPath);
    const now = new Date().toISOString();
    if (existing) {
      this.database.connection
        .prepare("UPDATE projects SET fingerprint = ?, updated_at = ? WHERE id = ?")
        .run(fingerprint, now, existing.id);
      return projectSchema.parse({ ...existing, fingerprint, updatedAt: now });
    }

    const project = projectSchema.parse({
      id: createProjectId(),
      rootPath,
      fingerprint,
      createdAt: now,
      updatedAt: now,
    });
    this.database.connection
      .prepare(`
        INSERT INTO projects(id, root_path, fingerprint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(project.id, project.rootPath, project.fingerprint, project.createdAt, project.updatedAt);
    return project;
  }

  get(id: string): Project | undefined {
    const row = this.database.connection.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? parseProject(row) : undefined;
  }

  findByRoot(rootPath: string): Project | undefined {
    const row = this.database.connection
      .prepare("SELECT * FROM projects WHERE root_path = ?")
      .get(rootPath);
    return row ? parseProject(row) : undefined;
  }

  list(): Project[] {
    return this.database.connection
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all()
      .map(parseProject);
  }
}

function parseProject(raw: unknown): Project {
  const row = projectRowSchema.parse(raw);
  return projectSchema.parse({
    id: row.id,
    rootPath: row.root_path,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
