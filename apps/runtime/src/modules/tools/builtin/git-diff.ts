import { z } from "zod";

import type { SandboxExecutor } from "../../sandbox/docker-provider.js";
import type { ToolContext } from "../tool-context.js";
import { commandFailure, limitCommandOutput, type ToolResult } from "../tool-result.js";

export const gitDiffInputSchema = z.object({
  maxBytes: z
    .number()
    .int()
    .min(1024)
    .max(4 * 1024 * 1024)
    .default(1024 * 1024),
});
export type GitDiffInput = z.infer<typeof gitDiffInputSchema>;

export async function gitDiffTool(
  executor: SandboxExecutor,
  context: ToolContext,
  input: GitDiffInput,
): Promise<ToolResult> {
  const intentToAdd = await executor.execute(
    context.sandboxId,
    ["git", "add", "--intent-to-add", "--", "."],
    30_000,
  );
  if (intentToAdd.exitCode !== 0) {
    return commandFailure("git_diff", intentToAdd.exitCode, intentToAdd.stderr);
  }
  const result = await executor.execute(
    context.sandboxId,
    ["git", "diff", "--binary", "--no-ext-diff", "--"],
    30_000,
  );
  if (result.exitCode !== 0) return commandFailure("git_diff", result.exitCode, result.stderr);
  const output = limitCommandOutput(result.stdout, result.stderr, input.maxBytes);
  return {
    ok: true,
    content: output.stdout,
    details: { truncated: output.truncated, stderr: output.stderr },
  };
}
