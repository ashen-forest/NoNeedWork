import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Command } from "commander";

import { ensureRuntime } from "../client/runtime-discovery.js";

export function registerTraceCommand(program: Command): void {
  program
    .command("trace")
    .description("Export redacted task events")
    .command("export")
    .argument("<task-id>")
    .requiredOption("--output <path>", "Destination JSON path")
    .action(async (taskId: string, options: { output: string }) => {
      const { client } = await ensureRuntime();
      const events = [];
      let cursor = 0;
      for (;;) {
        const page = await client.listEvents(taskId, cursor, 500);
        events.push(...page.events);
        if (page.nextCursor === cursor || page.events.length < 500) break;
        cursor = page.nextCursor;
      }
      const destination = resolve(options.output);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(
        destination,
        `${JSON.stringify(redact({ schemaVersion: 1, taskId, events }), null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      process.stdout.write(`${destination}\n`);
    });
}

function redact(value: unknown, key = ""): unknown {
  if (/token|secret|authorization|credential|api.?key/iu.test(key)) return "[REDACTED]";
  if (typeof value === "string")
    return value.replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer [REDACTED]");
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entry]) => [
        entryKey,
        redact(entry, entryKey),
      ]),
    );
  }
  return value;
}
