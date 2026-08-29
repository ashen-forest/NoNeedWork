import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTaskRequestSchema } from "@noneedwork/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../artifacts/artifact-store.js";
import { createTestModelBinding } from "../models/testing.js";
import { RuntimeDatabase } from "../storage/database.js";
import { ProjectRepository } from "../storage/repositories/project-repository.js";
import { TaskRepository } from "../storage/repositories/task-repository.js";
import { ToolOperationRepository } from "../storage/repositories/tool-operation-repository.js";
import { CheckpointService } from "../tasks/checkpoint-service.js";
import { ToolAudit } from "./tool-audit.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ToolAudit", () => {
  it("persists and marks an unknown side-effect outcome before returning the error", async () => {
    // GIVEN: An executing durable TaskRun and an audited side-effect operation
    const directory = await mkdtemp(join(tmpdir(), "noneedwork-tool-audit-"));
    directories.push(directory);
    const database = new RuntimeDatabase(":memory:");
    try {
      const projects = new ProjectRepository(database);
      const project = projects.open("C:/tool-audit", "9".repeat(64));
      const tasks = new TaskRepository(database);
      const created = tasks.create(
        createTaskRequestSchema.parse({ projectId: project.id, objective: "Audit failure" }),
        {},
        createTestModelBinding(),
      );
      const createdRun = tasks.runs.get(created.runId);
      if (!createdRun) throw new Error("Expected created TaskRun");
      const preparing = tasks.runs.transition(createdRun, "PREPARING");
      const planning = tasks.runs.transition(preparing, "PLANNING");
      tasks.runs.transition(planning, "EXECUTING");
      const operations = new ToolOperationRepository(database);
      const artifacts = new ArtifactStore(join(directory, "artifacts"), tasks.artifacts);
      const audit = new ToolAudit(operations, artifacts, new CheckpointService(tasks.runs));

      // WHEN: The sandbox executor fails after the operation has started
      await expect(
        audit.dispatch(
          "write_file",
          { path: "README.md", content: "change" },
          {
            sandboxId: "sandbox-1",
            taskId: created.task.id,
            runId: created.runId,
            toolCallId: "uncertain-write",
          },
          async () => {
            throw new Error("sandbox connection closed");
          },
        ),
      ).rejects.toThrow("sandbox connection closed");

      // THEN: The unknown state and its error artifact are durable before PI sees the error
      const operation = operations.listUnknown(created.runId)[0];
      expect(operation).toMatchObject({
        capability: "write_file",
        state: "UNKNOWN_OUTCOME",
      });
      if (!operation?.resultArtifactId) throw new Error("Expected an error result artifact");
      const artifact = tasks.artifacts.get(operation.resultArtifactId);
      if (!artifact) throw new Error("Expected persisted error result artifact");
      const persisted = await readFile(artifact.filesystemPath, "utf8");
      expect(JSON.parse(persisted)).toMatchObject({
        result: { ok: false, details: { unknownOutcome: true } },
      });
    } finally {
      database.close();
    }
  });
});
