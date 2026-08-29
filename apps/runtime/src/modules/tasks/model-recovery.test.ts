import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTaskRequestSchema } from "@noneedwork/protocol";
import { describe, expect, it } from "vitest";

import { createRuntimeConfig } from "../../config.js";
import { createRuntimeServices } from "../../services.js";
import { FakeCredentialVault } from "../credentials/fake-credential-vault.js";
import { createModelBlock, ModelBlockedError } from "../models/model-errors.js";
import { createTestModelBinding } from "../models/testing.js";
import { RuntimeDatabase } from "../storage/database.js";
import { ProjectRepository } from "../storage/repositories/project-repository.js";
import { TaskRepository } from "../storage/repositories/task-repository.js";
import { ToolOperationRepository } from "../storage/repositories/tool-operation-repository.js";
import { RecoveryService } from "./recovery-service.js";

function createTask(database: RuntimeDatabase) {
  const project = new ProjectRepository(database).open("C:/model-recovery", "3".repeat(64));
  const tasks = new TaskRepository(database);
  const created = tasks.create(
    createTaskRequestSchema.parse({ projectId: project.id, objective: "Recover model" }),
    {},
    createTestModelBinding(),
  );
  return { created, tasks };
}

describe("model recovery", () => {
  it("persists PREPARING and a model block before creating any sandbox", async () => {
    const directory = await mkdtemp(join(tmpdir(), "noneedwork-model-preflight-"));
    const operations: string[] = [];
    const sandbox = {
      createWorkspace: async () => {
        operations.push("sandbox");
        return "sandbox-id";
      },
      removeSandbox: async () => {},
      execute: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const services = createRuntimeServices(createRuntimeConfig({ appDataDirectory: directory }), {
      databasePath: ":memory:",
      artifactRoot: join(directory, "artifacts"),
      dockerProvider: sandbox,
      credentialVault: new FakeCredentialVault(),
      autoStartTasks: false,
    });
    try {
      const project = services.projects.open("C:/model-preflight", "4".repeat(64));
      const details = services.taskService.create(
        createTaskRequestSchema.parse({ projectId: project.id, objective: "Blocked model" }),
      );
      const result = await services.orchestrator.run(details.task.id, project.rootPath, {
        preflight: async () => {
          operations.push("preflight");
          throw new ModelBlockedError(
            createModelBlock({
              reason: "MODEL_CREDENTIAL_MISSING",
              profileId: "qwen-cn",
              modelId: "qwen3.7-plus",
            }),
          );
        },
        createPlan: async () => {
          throw new Error("plan must not run");
        },
        executeStep: async () => {
          throw new Error("step must not run");
        },
      });

      expect(operations).toEqual(["preflight"]);
      expect(result.run).toMatchObject({
        status: "PAUSED",
        checkpoint: {
          boundary: "MODEL_BLOCKED",
          resumeStatus: "PREPARING",
          modelBlock: { reason: "MODEL_CREDENTIAL_MISSING" },
        },
      });
      expect(services.sandboxes.getByRun(details.run?.id ?? "missing")).toBeUndefined();
    } finally {
      services.database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("pauses a non-terminal legacy run without inventing a binding", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const { created, tasks } = createTask(database);
      database.connection
        .prepare("DELETE FROM task_run_models WHERE run_id = ?")
        .run(created.runId);

      const decisions = new RecoveryService(
        tasks.runs,
        new ToolOperationRepository(database),
        () => new Date("2026-08-29T00:00:00.000Z"),
        tasks.models,
      ).scan();

      expect(decisions).toEqual([
        expect.objectContaining({ runId: created.runId, action: "WAIT_FOR_MODEL" }),
      ]);
      expect(tasks.runs.get(created.runId)).toMatchObject({
        status: "PAUSED",
        checkpoint: {
          boundary: "MODEL_BLOCKED",
          modelBlock: { reason: "MODEL_BINDING_MISSING" },
        },
      });
      expect(tasks.details(created.task.id)?.model).toBeNull();
    } finally {
      database.close();
    }
  });

  it("keeps a terminal legacy run readable and unchanged", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const { created, tasks } = createTask(database);
      const run = tasks.runs.get(created.runId);
      if (!run) throw new Error("Expected TaskRun");
      tasks.runs.transition(run, "CANCELLED");
      database.connection
        .prepare("DELETE FROM task_run_models WHERE run_id = ?")
        .run(created.runId);

      expect(
        new RecoveryService(
          tasks.runs,
          new ToolOperationRepository(database),
          () => new Date("2026-08-29T00:00:00.000Z"),
          tasks.models,
        ).scan(),
      ).toEqual([]);
      expect(tasks.details(created.task.id)).toMatchObject({
        run: { status: "CANCELLED" },
        model: null,
      });
    } finally {
      database.close();
    }
  });
});
