import { z } from "zod";

import type { SandboxExecutor } from "../../sandbox/docker-provider.js";
import type { ToolContext } from "../tool-context.js";
import { limitCommandOutput, type ToolResult } from "../tool-result.js";

export const runCommandInputSchema = z.object({
  argv: z.array(z.string().min(1).max(4096)).min(1).max(50),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  maxOutputBytes: z
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024)
    .default(256 * 1024),
});
export type RunCommandInput = z.infer<typeof runCommandInputSchema>;

export async function runCommandTool(
  executor: SandboxExecutor,
  context: ToolContext,
  input: RunCommandInput,
): Promise<ToolResult> {
  const result = await executor.execute(context.sandboxId, input.argv, input.timeoutMs);
  const output = limitCommandOutput(result.stdout, result.stderr, input.maxOutputBytes);
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    content: output.stdout,
    details: {
      argv: input.argv,
      exitCode: result.exitCode,
      stderr: output.stderr,
      timedOut: result.timedOut,
      truncated: output.truncated,
    },
  };
}
