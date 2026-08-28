import type { Command } from "commander";

import { ensureRuntime } from "../client/runtime-discovery.js";

export function registerProjectCommand(program: Command): void {
  const project = program.command("project").description("Manage local projects");
  project
    .command("open")
    .argument("<path>", "Repository directory")
    .option("--json", "Print machine-readable JSON")
    .action(async (path: string, options: { json?: boolean }) => {
      const { client } = await ensureRuntime();
      const opened = await client.openProject({ path });
      if (options.json) process.stdout.write(`${JSON.stringify(opened, null, 2)}\n`);
      else process.stdout.write(`${opened.id}\t${opened.rootPath}\n`);
    });

  project
    .command("list")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const { client } = await ensureRuntime();
      const result = await client.listProjects();
      if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        for (const item of result.projects) process.stdout.write(`${item.id}\t${item.rootPath}\n`);
      }
    });
}
