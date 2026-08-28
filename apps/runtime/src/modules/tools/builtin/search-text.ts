import { z } from "zod";

import type { SandboxExecutor } from "../../sandbox/docker-provider.js";
import { toContainerWorkspacePath } from "../../sandbox/path-mapper.js";
import type { ToolContext } from "../tool-context.js";
import { commandFailure, type ToolResult } from "../tool-result.js";

export const searchTextInputSchema = z.object({
  query: z.string().min(1).max(1000),
  path: z.string().min(1).max(4096).default("."),
  maxMatches: z.number().int().min(1).max(500).default(100),
});

export type SearchTextInput = z.infer<typeof searchTextInputSchema>;

export async function searchTextTool(
  executor: SandboxExecutor,
  context: ToolContext,
  input: SearchTextInput,
): Promise<ToolResult> {
  const path = input.path === "." ? "/workspace" : toContainerWorkspacePath(input.path);
  const result = await executor.execute(
    context.sandboxId,
    ["grep", "-R", "-n", "-I", "-F", "-m", String(input.maxMatches), "--", input.query, path],
    10_000,
  );
  if (result.exitCode === 1) {
    return { ok: true, content: "", details: { query: input.query, path: input.path } };
  }
  if (result.exitCode !== 0) return commandFailure("search_text", result.exitCode, result.stderr);
  return {
    ok: true,
    content: result.stdout,
    details: { query: input.query, path: input.path },
  };
}
