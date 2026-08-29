import {
  type CreateTaskRequest,
  createTaskRequestSchema,
  createTaskRunId,
  type TaskControlAction,
  type TaskDetails,
  type TaskStatus,
  taskControlActionSchema,
  taskModelBindingSchema,
} from "@noneedwork/protocol";

import type { ModelService } from "../models/model-service.js";
import type { ProjectRepository } from "../storage/repositories/project-repository.js";
import type { TaskRepository } from "../storage/repositories/task-repository.js";
import { assertTaskTransition, isTerminalTaskStatus } from "./task-state-machine.js";

const RESUMABLE = new Set<TaskStatus>([
  "PREPARING",
  "PLANNING",
  "AWAITING_APPROVAL",
  "EXECUTING",
  "VERIFYING",
  "REPLANNING",
]);

export class TaskService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
    private readonly models: ModelService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(rawRequest: CreateTaskRequest): TaskDetails {
    const request = createTaskRequestSchema.parse(rawRequest);
    if (!this.projects.get(request.projectId))
      throw new Error(`Unknown project ${request.projectId}`);
    const resolved = this.models.resolveTaskSelection(request.model);
    const binding = taskModelBindingSchema.parse({
      runId: createTaskRunId(),
      ...resolved,
      createdAt: this.now().toISOString(),
    });
    const created = this.tasks.create(request, { schemaVersion: 1, source: "local-api" }, binding);
    const details = this.tasks.details(created.task.id);
    if (!details) throw new Error(`Task ${created.task.id} disappeared after creation`);
    return details;
  }

  get(taskId: string): TaskDetails | undefined {
    return this.tasks.details(taskId);
  }

  control(taskId: string, rawAction: TaskControlAction): TaskDetails {
    const action = taskControlActionSchema.parse(rawAction);
    const details = this.tasks.details(taskId);
    if (!details?.run) throw new Error(`Unknown task ${taskId}`);
    let run = details.run;

    if (action === "cancel") {
      if (!isTerminalTaskStatus(run.status)) {
        assertTaskTransition(run.status, "CANCELLED");
        run = this.tasks.runs.transition(run, "CANCELLED", "TASK_STATE_CHANGED", {
          reason: "user_cancelled",
        });
      }
    } else if (action === "pause") {
      if (run.status !== "PAUSED") {
        if (isTerminalTaskStatus(run.status))
          throw new Error(`Cannot pause terminal task ${taskId}`);
        if (!RESUMABLE.has(run.status))
          throw new Error(`Task ${taskId} cannot pause from ${run.status}`);
        const resumeStatus = run.status;
        run = this.tasks.runs.checkpoint(run.id, {
          boundary: "USER_PAUSE",
          resumeStatus,
          recordedAt: new Date().toISOString(),
        });
        assertTaskTransition(run.status, "PAUSED");
        run = this.tasks.runs.transition(run, "PAUSED");
      }
    } else {
      if (run.status !== "PAUSED") throw new Error(`Task ${taskId} is not paused`);
      const resumeStatus = run.checkpoint?.resumeStatus;
      if (typeof resumeStatus !== "string" || !RESUMABLE.has(resumeStatus as TaskStatus)) {
        throw new Error(`Task ${taskId} has no safe resume checkpoint`);
      }
      assertTaskTransition("PAUSED", resumeStatus as TaskStatus);
      run = this.tasks.runs.transition(run, resumeStatus as TaskStatus);
    }

    const updated = this.tasks.details(taskId);
    if (!updated) throw new Error(`Task ${taskId} disappeared after ${action}`);
    return updated;
  }
}
