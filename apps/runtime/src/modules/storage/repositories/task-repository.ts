import {
  type CreateTaskRequest,
  createTaskId,
  type TaskBudget,
  type TaskDetails,
  type TaskModelBinding,
  type TaskSnapshot,
  taskBudgetSchema,
  taskDetailsSchema,
  taskSnapshotSchema,
} from "@noneedwork/protocol";
import { z } from "zod";
import { ModelBindingRepository } from "../../models/model-binding-repository.js";
import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";
import { ArtifactRepository } from "./artifact-repository.js";
import { PlanStepRepository } from "./plan-step-repository.js";
import { TaskRunRepository } from "./task-run-repository.js";

const taskRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  objective: z.string(),
  status: z.string(),
  current_run_id: z.string().nullable(),
  budget_json: z.string(),
  state_version: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});

export interface CreatedTask {
  task: TaskSnapshot;
  runId: string;
}

export class TaskRepository {
  readonly runs: TaskRunRepository;
  readonly steps: PlanStepRepository;
  readonly artifacts: ArtifactRepository;
  readonly models: ModelBindingRepository;

  constructor(private readonly database: RuntimeDatabase) {
    this.runs = new TaskRunRepository(database);
    this.steps = new PlanStepRepository(database);
    this.artifacts = new ArtifactRepository(database);
    this.models = new ModelBindingRepository(database);
  }

  create(
    request: CreateTaskRequest,
    config: Record<string, unknown>,
    binding: TaskModelBinding,
  ): CreatedTask {
    const taskId = createTaskId();
    const runId = binding.runId;
    const budget = taskBudgetSchema.parse(request.budget ?? {});
    const now = new Date().toISOString();

    return this.database.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO tasks(
            id, project_id, objective, status, current_run_id,
            budget_json, state_version, created_at, updated_at
          ) VALUES (?, ?, ?, 'CREATED', ?, ?, 0, ?, ?)
        `)
        .run(
          taskId,
          request.projectId,
          request.objective,
          runId,
          encodePersistedJson(budget),
          now,
          now,
        );
      this.database.connection
        .prepare(`
          INSERT INTO task_runs(
            id, task_id, status, state_version, config_json,
            replan_count, created_at, updated_at
          ) VALUES (?, ?, 'CREATED', 0, ?, 0, ?, ?)
        `)
        .run(runId, taskId, encodePersistedJson(config), now, now);
      this.models.insert(binding);
      this.runs.events.append(taskId, runId, "TASK_STATE_CHANGED", {
        from: null,
        to: "CREATED",
      });
      const task = this.get(taskId);
      if (!task) throw new Error(`Task ${taskId} disappeared after creation`);
      return { task, runId };
    });
  }

  get(id: string): TaskSnapshot | undefined {
    const row = this.database.connection.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? parseTask(row) : undefined;
  }

  details(id: string): TaskDetails | undefined {
    const task = this.get(id);
    if (!task) return undefined;
    const run = task.currentRunId ? (this.runs.get(task.currentRunId) ?? null) : null;
    const model = run ? (this.models.get(run.id) ?? null) : null;
    const planSteps = run ? this.steps.list(run.id) : [];
    const artifactIds = run ? this.artifacts.listByRun(run.id).map((artifact) => artifact.id) : [];
    return taskDetailsSchema.parse({ task, run, model, planSteps, artifactIds });
  }

  list(projectId?: string): TaskSnapshot[] {
    const rows = projectId
      ? this.database.connection
          .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC")
          .all(projectId)
      : this.database.connection.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all();
    return rows.map(parseTask);
  }
}

function parseTask(raw: unknown): TaskSnapshot {
  const row = taskRowSchema.parse(raw);
  return taskSnapshotSchema.parse({
    id: row.id,
    projectId: row.project_id,
    currentRunId: row.current_run_id,
    objective: row.objective,
    status: row.status,
    stateVersion: row.state_version,
    budget: decodePersistedJson<TaskBudget>(row.budget_json, taskBudgetSchema),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
