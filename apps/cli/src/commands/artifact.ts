import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Command } from "commander";

import { ensureRuntime } from "../client/runtime-discovery.js";

export function registerArtifactCommand(program: Command): void {
  program
    .command("artifact")
    .description("Download a task artifact")
    .command("get")
    .argument("<artifact-id>")
    .requiredOption("--output <path>", "Destination path")
    .action(async (artifactId: string, options: { output: string }) => {
      const { client } = await ensureRuntime();
      const bytes = await client.downloadArtifact(artifactId);
      const destination = resolve(options.output);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { mode: 0o600 });
      process.stdout.write(`${destination}\n`);
    });
}
