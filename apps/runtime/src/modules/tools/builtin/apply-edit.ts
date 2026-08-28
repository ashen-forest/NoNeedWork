import { z } from "zod";

import type { SandboxExecutor } from "../../sandbox/docker-provider.js";
import { toContainerWorkspacePath } from "../../sandbox/path-mapper.js";
import { assertAllowedPath } from "../allowed-path.js";
import type { ToolContext } from "../tool-context.js";
import { commandFailure, type ToolResult } from "../tool-result.js";

export const applyEditInputSchema = z.object({
  path: z.string().min(1).max(4096),
  oldText: z
    .string()
    .min(1)
    .max(256 * 1024),
  newText: z.string().max(256 * 1024),
  expectedReplacements: z.number().int().min(1).max(100).default(1),
});
export type ApplyEditInput = z.infer<typeof applyEditInputSchema>;

const EDIT_SCRIPT = `
const fs = require('node:fs');
const target = process.argv[1];
const oldText = Buffer.from(process.argv[2], 'base64').toString('utf8');
const newText = Buffer.from(process.argv[3], 'base64').toString('utf8');
const expected = Number(process.argv[4]);
const source = fs.readFileSync(target, 'utf8');
const count = source.split(oldText).length - 1;
if (count !== expected) {
  process.stderr.write('Expected ' + expected + ' replacements but found ' + count);
  process.exit(65);
}
fs.writeFileSync(target, source.split(oldText).join(newText), { mode: 0o600 });
`;

export async function applyEditTool(
  executor: SandboxExecutor,
  context: ToolContext,
  input: ApplyEditInput,
): Promise<ToolResult> {
  const relativePath = assertAllowedPath(input.path, context.allowedPaths);
  const result = await executor.execute(
    context.sandboxId,
    [
      "node",
      "-e",
      EDIT_SCRIPT,
      toContainerWorkspacePath(relativePath),
      Buffer.from(input.oldText).toString("base64"),
      Buffer.from(input.newText).toString("base64"),
      String(input.expectedReplacements),
    ],
    30_000,
  );
  if (result.exitCode !== 0) return commandFailure("apply_edit", result.exitCode, result.stderr);
  return {
    ok: true,
    content: `Applied ${input.expectedReplacements} replacement(s) to ${relativePath}`,
    details: { path: relativePath, replacements: input.expectedReplacements },
  };
}
