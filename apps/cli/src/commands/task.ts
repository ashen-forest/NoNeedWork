import type { TaskControlAction, TaskStatus } from "@noneedwork/protocol";
import type { Command } from "commander";

import { ensureRuntime } from "../client/runtime-discovery.js";
import { parseTaskModelOption } from "./model.js";

const TERMINAL = new Set<TaskStatus>(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function registerTaskCommand(program: Command): void {
  const task = program.command("task").description("Manage durable tasks");
  task
    .command("start")
    .requiredOption("--repo <path>", "Repository directory")
    .argument("<objective...>", "Task objective")
    .option("--model <profile-id/model-id>", "Override the configured model for this TaskRun")
    .option("--json", "Print machine-readable JSON")
    .action(
      async (
        objectiveParts: string[],
        options: { repo: string; model?: string; json?: boolean },
      ) => {
        const { client } = await ensureRuntime();
        const project = await client.openProject({ path: options.repo });
        const details = await client.createTask({
          projectId: project.id,
          objective: objectiveParts.join(" "),
          ...(options.model ? { model: parseTaskModelOption(options.model) } : {}),
        });
        if (options.json) process.stdout.write(`${JSON.stringify(details, null, 2)}\n`);
        else process.stdout.write(`${details.task.id}\t${details.task.status}\n`);
      },
    );

  task
    .command("watch")
    .argument("<task-id>")
    .option("--once", "Return after the current event page")
    .option("--interval <ms>", "Polling interval", "500")
    .action(async (taskId: string, options: { once?: boolean; interval: string }) => {
      const { client } = await ensureRuntime();
      let cursor = 0;
      const interval = Math.max(100, Number.parseInt(options.interval, 10));
      for (;;) {
        const page = await client.listEvents(taskId, cursor);
        for (const event of page.events) process.stdout.write(`${JSON.stringify(event)}\n`);
        cursor = page.nextCursor;
        const details = await client.getTask(taskId);
        if (options.once || TERMINAL.has(details.task.status)) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, interval));
      }
    });

  for (const action of ["pause", "resume", "cancel"] as const) {
    registerControl(task, action);
  }
}

function registerControl(command: Command, action: TaskControlAction): void {
  command
    .command(action)
    .argument("<task-id>")
    .option("--json", "Print machine-readable JSON")
    .action(async (taskId: string, options: { json?: boolean }) => {
      const { client } = await ensureRuntime();
      const details = await client.controlTask(taskId, action);
      if (options.json) process.stdout.write(`${JSON.stringify(details, null, 2)}\n`);
      else process.stdout.write(`${details.task.id}\t${details.task.status}\n`);
    });
}
