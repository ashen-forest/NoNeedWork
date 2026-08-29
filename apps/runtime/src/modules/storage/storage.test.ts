import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTaskRequestSchema, type TaskModelBinding } from "@noneedwork/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactIntegrityError, ArtifactStore } from "../artifacts/artifact-store.js";
import { createTestModelBinding } from "../models/testing.js";
import { backupDatabase } from "./backup.js";
import { RuntimeDatabase } from "./database.js";
import { INITIAL_SCHEMA_SQL } from "./migrations/001-initial.js";
import { applyMigrations, getSchemaVersion } from "./migrator.js";
import { ApprovalRepository } from "./repositories/approval-repository.js";
import { EvalRepository } from "./repositories/eval-repository.js";
import { ProjectRepository } from "./repositories/project-repository.js";
import { TaskRepository } from "./repositories/task-repository.js";
import { StateConflictError } from "./repositories/task-run-repository.js";
import { WorkerRunRepository } from "./repositories/worker-run-repository.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFileDatabase(): Promise<{ database: RuntimeDatabase; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "noneedwork-storage-"));
  directories.push(directory);
  return { database: new RuntimeDatabase(join(directory, "noneedwork.db")), directory };
}

describe("runtime storage", () => {
  it("applies the forward schema with hardened SQLite pragmas", async () => {
    const { database } = await createFileDatabase();
    try {
      const version = database.connection.prepare("SELECT version FROM schema_meta").get();
      const journal = database.connection.prepare("PRAGMA journal_mode").get();
      const foreignKeys = database.connection.prepare("PRAGMA foreign_keys").get();
      const trustedSchema = database.connection.prepare("PRAGMA trusted_schema").get();

      expect(version).toEqual({ version: 2 });
      expect(journal).toEqual({ journal_mode: "wal" });
      expect(foreignKeys).toEqual({ foreign_keys: 1 });
      expect(trustedSchema).toEqual({ trusted_schema: 0 });
    } finally {
      database.close();
    }
  });

  it("refuses to open a schema created by a newer runtime", () => {
    const database = new RuntimeDatabase(":memory:", { migrate: false });
    try {
      database.connection.exec(`
        CREATE TABLE schema_meta (
          singleton INTEGER PRIMARY KEY,
          version INTEGER NOT NULL,
          migration_name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO schema_meta VALUES (1, 999, 'future', '2026-08-28T00:00:00.000Z');
      `);

      expect(() => applyMigrations(database.connection)).toThrow(/rollback is refused/);
    } finally {
      database.close();
    }
  });

  it("migrates an existing version-1 database to model schema version 2", () => {
    const database = new RuntimeDatabase(":memory:", { migrate: false });
    try {
      database.connection.exec(INITIAL_SCHEMA_SQL);
      database.connection.exec(`
        CREATE TABLE schema_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          version INTEGER NOT NULL,
          migration_name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO schema_meta VALUES (1, 1, 'initial', '2026-08-28T00:00:00.000Z');
      `);

      expect(applyMigrations(database.connection)).toBe(2);
      expect(getSchemaVersion(database.connection)).toBe(2);
      expect(
        database.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_run_models'",
          )
          .get(),
      ).toEqual({ name: "task_run_models" });
    } finally {
      database.close();
    }
  });

  it("rolls back task and TaskRun rows when model binding insertion fails", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const project = new ProjectRepository(database).open("C:/rollback", "1".repeat(64));
      const tasks = new TaskRepository(database);
      const invalidBinding = {
        ...createTestModelBinding(),
        selectionSource: "invalid",
      } as unknown as TaskModelBinding;

      expect(() =>
        tasks.create(
          createTaskRequestSchema.parse({ projectId: project.id, objective: "Rollback" }),
          {},
          invalidBinding,
        ),
      ).toThrow();
      expect(database.connection.prepare("SELECT COUNT(*) AS count FROM tasks").get()).toEqual({
        count: 0,
      });
      expect(database.connection.prepare("SELECT COUNT(*) AS count FROM task_runs").get()).toEqual({
        count: 0,
      });
    } finally {
      database.close();
    }
  });

  it("creates a consistent SQLite backup", async () => {
    const { database, directory } = await createFileDatabase();
    const backupPath = join(directory, "backups", "noneedwork.db");
    try {
      const projects = new ProjectRepository(database);
      const project = projects.open(directory, "a".repeat(64));

      await backupDatabase(database, backupPath);

      const backup = new RuntimeDatabase(backupPath);
      try {
        expect(new ProjectRepository(backup).get(project.id)).toEqual(project);
      } finally {
        backup.close();
      }
    } finally {
      database.close();
    }
  });

  it("uses compare-and-swap transitions and monotonic event cursors", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const projects = new ProjectRepository(database);
      const project = projects.open("C:/fixture", "b".repeat(64));
      const tasks = new TaskRepository(database);
      const created = tasks.create(
        createTaskRequestSchema.parse({ projectId: project.id, objective: "Change fixture" }),
        {},
        createTestModelBinding(),
      );
      const original = tasks.runs.get(created.runId);
      if (!original) throw new Error("Expected TaskRun");

      const preparing = tasks.runs.transition(original, "PREPARING");

      expect(preparing.stateVersion).toBe(1);
      expect(() => tasks.runs.transition(original, "PREPARING")).toThrow(StateConflictError);
      expect(tasks.runs.events.list(original.id).events.map((event) => event.cursor)).toEqual([
        1, 2,
      ]);
    } finally {
      database.close();
    }
  });

  it("round-trips versioned JSON through the approval, worker, and eval repositories", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const project = new ProjectRepository(database).open("C:/core-tables", "f".repeat(64));
      const tasks = new TaskRepository(database);
      const created = tasks.create(
        createTaskRequestSchema.parse({ projectId: project.id, objective: "Persist core rows" }),
        {},
        createTestModelBinding(),
      );

      const approval = new ApprovalRepository(database).create({
        runId: created.runId,
        capability: "write_file",
        resource: { schemaVersion: 1, path: "README.md" },
        bindingHash: "1".repeat(64),
        nonce: "approval-nonce",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const task = tasks.get(created.task.id);
      if (!task) throw new Error("Expected persisted task");
      const worker = new WorkerRunRepository(database).create({
        runId: created.runId,
        role: "researcher",
        budget: task.budget,
      });
      const evals = new EvalRepository(database);
      const evalRun = evals.createRun({ suite: "smoke", config: { schemaVersion: 1 } });
      const evalResult = evals.createResult({
        evalRunId: evalRun.id,
        caseId: "golden-001",
        verdict: "PASS",
        metrics: { score: 1 },
        evidence: { artifactIds: [] },
      });

      expect(approval.resource).toEqual({ schemaVersion: 1, path: "README.md" });
      expect(worker.budget.maxReplans).toBe(2);
      expect(evals.listResults(evalRun.id)).toEqual([evalResult]);
    } finally {
      database.close();
    }
  });
});

describe("artifact store", () => {
  it("stores content by hash and validates it on read", async () => {
    const { database, directory } = await createFileDatabase();
    try {
      const projects = new ProjectRepository(database);
      const project = projects.open(directory, "c".repeat(64));
      const tasks = new TaskRepository(database);
      const created = tasks.create(
        createTaskRequestSchema.parse({ projectId: project.id, objective: "Produce patch" }),
        {},
        createTestModelBinding(),
      );
      const store = new ArtifactStore(join(directory, "artifacts"), tasks.artifacts);

      const artifact = await store.put({
        taskRunId: created.runId,
        name: "changes.patch",
        mediaType: "text/x-diff",
        bytes: Buffer.from("diff --git a/a b/a\n"),
        producer: "storage-test",
      });
      const loaded = await store.read(artifact.id);

      expect(loaded.artifact.sha256).toBe(artifact.sha256);
      expect(loaded.bytes.toString("utf8")).toBe("diff --git a/a b/a\n");
      expect(await readFile(artifact.filesystemPath, "utf8")).toBe("diff --git a/a b/a\n");
    } finally {
      database.close();
    }
  });

  it("rejects a blob changed after metadata commit", async () => {
    const { database, directory } = await createFileDatabase();
    try {
      const project = new ProjectRepository(database).open(directory, "d".repeat(64));
      const tasks = new TaskRepository(database);
      const created = tasks.create(
        createTaskRequestSchema.parse({ projectId: project.id, objective: "Tamper test" }),
        {},
        createTestModelBinding(),
      );
      const store = new ArtifactStore(join(directory, "artifacts"), tasks.artifacts);
      const artifact = await store.put({
        taskRunId: created.runId,
        name: "trace.json",
        mediaType: "application/json",
        bytes: Buffer.from("{}"),
        producer: "storage-test",
      });
      await writeFile(artifact.filesystemPath, "tampered");

      await expect(store.read(artifact.id)).rejects.toThrow(ArtifactIntegrityError);
    } finally {
      database.close();
    }
  });
});
