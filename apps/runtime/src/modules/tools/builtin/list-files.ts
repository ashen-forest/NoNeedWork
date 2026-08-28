import { z } from "zod";

import type { SandboxExecutor } from "../../sandbox/docker-provider.js";
import { toContainerWorkspacePath } from "../../sandbox/path-mapper.js";
import type { ToolContext } from "../tool-context.js";
import { commandFailure, type ToolResult } from "../tool-result.js";

export const listFilesInputSchema = z.object({
  path: z.string().min(1).max(4096).default("."),
  maxDepth: z.number().int().min(1).max(8).default(4),
  maxEntries: z.number().int().min(1).max(2000).default(500),
});

export type ListFilesInput = z.infer<typeof listFilesInputSchema>;

export async function listFilesTool(
  executor: SandboxExecutor,
  context: ToolContext,
  input: ListFilesInput,
): Promise<ToolResult> {
  const path = input.path === "." ? "/workspace" : toContainerWorkspacePath(input.path);
  const result = await executor.execute(
    context.sandboxId,
    ["find", path, "-mindepth", "1", "-maxdepth", String(input.maxDepth), "-printf", "%P\n"],
    10_000,
  );
  if (result.exitCode !== 0) return commandFailure("list_files", result.exitCode, result.stderr);
  const allEntries = result.stdout.split("\n").filter(Boolean).sort();
  const entries = allEntries.slice(0, input.maxEntries);
  return {
    ok: true,
    content: entries.join("\n"),
    details: {
      path: input.path,
      count: entries.length,
      truncated: allEntries.length > entries.length,
    },
  };
}
