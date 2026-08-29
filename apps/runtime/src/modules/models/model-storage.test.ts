import { createProjectId, createTaskId, createTaskRunId } from "@noneedwork/protocol";
import { describe, expect, it } from "vitest";

import { RuntimeDatabase } from "../storage/database.js";
import { ModelBindingRepository } from "./model-binding-repository.js";
import { ModelPreferenceRepository } from "./model-preference-repository.js";

const now = "2026-08-29T00:00:00.000Z";

function insertTaskRun(database: RuntimeDatabase, status = "CREATED") {
  const projectId = createProjectId();
  const taskId = createTaskId();
  const runId = createTaskRunId();
  database.connection
    .prepare(
      "INSERT INTO projects(id, root_path, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(projectId, `C:/fixture/${projectId}`, "a".repeat(64), now, now);
  database.connection
    .prepare(
      "INSERT INTO tasks(id, project_id, objective, status, current_run_id, budget_json, state_version, created_at, updated_at) VALUES (?, ?, 'test', ?, ?, ?, 0, ?, ?)",
    )
    .run(taskId, projectId, status, runId, JSON.stringify({ schemaVersion: 1 }), now, now);
  database.connection
    .prepare(
      "INSERT INTO task_runs(id, task_id, status, state_version, config_json, replan_count, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 0, ?, ?)",
    )
    .run(runId, taskId, status, JSON.stringify({ schemaVersion: 1 }), now, now);
  return { taskId, runId };
}

describe("model storage", () => {
  it("round-trips the local default selection", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const preferences = new ModelPreferenceRepository(database, () => new Date(now));
      expect(preferences.get()).toBeUndefined();
      expect(preferences.set({ profileId: "minimax-cn", modelId: "MiniMax-M3" })).toEqual({
        profileId: "minimax-cn",
        modelId: "MiniMax-M3",
      });
      expect(preferences.get()).toEqual({ profileId: "minimax-cn", modelId: "MiniMax-M3" });
    } finally {
      database.close();
    }
  });

  it("persists one immutable binding while the TaskRun is CREATED", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const { runId } = insertTaskRun(database);
      const bindings = new ModelBindingRepository(database);
      const binding = {
        runId,
        profileId: "qwen-cn" as const,
        piProviderId: "qwen-token-plan-cn" as const,
        modelId: "qwen3.7-plus",
        piSdkVersion: "0.84.3" as const,
        selectionSource: "default" as const,
        createdAt: now,
      };

      expect(bindings.insert(binding)).toEqual(binding);
      expect(bindings.get(runId)).toEqual(binding);
      expect(() => bindings.insert(binding)).toThrow(/already has a model binding/);
    } finally {
      database.close();
    }
  });

  it("refuses to bind a TaskRun after it leaves CREATED", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const { runId } = insertTaskRun(database, "PREPARING");
      const bindings = new ModelBindingRepository(database);
      expect(() =>
        bindings.insert({
          runId,
          profileId: "qwen-cn",
          piProviderId: "qwen-token-plan-cn",
          modelId: "qwen3.7-plus",
          piSdkVersion: "0.84.3",
          selectionSource: "default",
          createdAt: now,
        }),
      ).toThrow(/must be CREATED/);
    } finally {
      database.close();
    }
  });

  it("cascades a binding when its TaskRun is deleted", () => {
    const database = new RuntimeDatabase(":memory:");
    try {
      const { runId } = insertTaskRun(database);
      const bindings = new ModelBindingRepository(database);
      bindings.insert({
        runId,
        profileId: "qwen-cn",
        piProviderId: "qwen-token-plan-cn",
        modelId: "qwen3.7-plus",
        piSdkVersion: "0.84.3",
        selectionSource: "default",
        createdAt: now,
      });
      database.connection.prepare("DELETE FROM task_runs WHERE id = ?").run(runId);
      expect(bindings.get(runId)).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
