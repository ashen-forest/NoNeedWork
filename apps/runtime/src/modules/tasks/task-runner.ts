import type { TaskDetails } from "@noneedwork/protocol";

import type { ProjectRepository } from "../storage/repositories/project-repository.js";
import type { TaskRepository } from "../storage/repositories/task-repository.js";
import {
  RunLeaseUnavailableError,
  type TaskDriver,
  type TaskOrchestrator,
} from "./task-orchestrator.js";
import { isTerminalTaskStatus } from "./task-state-machine.js";

export interface TaskDriverFactoryInput {
  taskId: string;
  projectRoot: string;
}

export type TaskDriverFactory = (input: TaskDriverFactoryInput) => TaskDriver;

export class TaskRunner {
  readonly #active = new Map<string, { driver: TaskDriver; promise: Promise<TaskDetails> }>();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
    private readonly orchestrator: TaskOrchestrator,
    private createDriver: TaskDriverFactory,
  ) {}

  configureDriverFactory(createDriver: TaskDriverFactory): void {
    if (this.#active.size > 0) {
      throw new Error("Cannot configure the task driver while tasks are active");
    }
    this.createDriver = createDriver;
  }

  start(taskId: string): void {
    void this.run(taskId).catch((error) => this.recordStartFailure(taskId, error));
  }

  run(taskId: string): Promise<TaskDetails> {
    const running = this.#active.get(taskId);
    if (running) return running.promise;
    const details = this.tasks.details(taskId);
    if (!details) throw new Error(`Unknown task ${taskId}`);
    const project = this.projects.get(details.task.projectId);
    if (!project) throw new Error(`Unknown project ${details.task.projectId}`);
    const driver = this.createDriver({ taskId, projectRoot: project.rootPath });
    const promise = this.orchestrator.run(taskId, project.rootPath, driver).finally(() => {
      driver.dispose?.();
      this.#active.delete(taskId);
    });
    this.#active.set(taskId, { driver, promise });
    return promise;
  }

  async cancelActive(taskId: string): Promise<void> {
    const active = this.#active.get(taskId);
    if (active) await active.driver.cancel?.();
    else await this.orchestrator.cleanupTerminalTask(taskId);
  }

  async shutdown(): Promise<void> {
    const active = [...this.#active.values()];
    await Promise.allSettled(active.map(({ driver }) => driver.cancel?.()));
    await Promise.allSettled(active.map(({ promise }) => promise));
  }

  get activeTaskIds(): readonly string[] {
    return [...this.#active.keys()];
  }

  private recordStartFailure(taskId: string, error: unknown): void {
    if (error instanceof RunLeaseUnavailableError) return;
    try {
      const details = this.tasks.details(taskId);
      if (!details?.run || isTerminalTaskStatus(details.run.status)) return;
      this.tasks.runs.transition(details.run, "FAILED", "DIAGNOSTIC", {
        message: error instanceof Error ? error.message : String(error),
        source: "task-runner",
      });
    } catch {
      // Another control or runner won the state transition race.
    }
  }
}
