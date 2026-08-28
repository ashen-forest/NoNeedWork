import { z } from "zod";

import type { SandboxExecutor } from "../../sandbox/docker-provider.js";
import { toContainerWorkspacePath } from "../../sandbox/path-mapper.js";
import type { ToolContext } from "../tool-context.js";
import { commandFailure, type ToolResult } from "../tool-result.js";

export const readFileInputSchema = z.object({
  path: z.string().min(1).max(4096),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024)
    .default(256 * 1024),
});

export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export async function readFileTool(
  executor: SandboxExecutor,
  context: ToolContext,
  input: ReadFileInput,
): Promise<ToolResult> {
  const path = toContainerWorkspacePath(input.path);
  const result = await executor.execute(
    context.sandboxId,
    ["head", "-c", String(input.maxBytes + 1), "--", path],
    10_000,
  );
  if (result.exitCode !== 0) return commandFailure("read_file", result.exitCode, result.stderr);
  const content = result.stdout.slice(0, input.maxBytes);
  return {
    ok: true,
    content,
    details: { path: input.path, truncated: result.stdout.length > input.maxBytes },
  };
}
