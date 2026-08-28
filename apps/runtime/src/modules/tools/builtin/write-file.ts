import { z } from "zod";

import type { SandboxExecutor } from "../../sandbox/docker-provider.js";
import { toContainerWorkspacePath } from "../../sandbox/path-mapper.js";
import { assertAllowedPath } from "../allowed-path.js";
import type { ToolContext } from "../tool-context.js";
import { commandFailure, type ToolResult } from "../tool-result.js";

export const writeFileInputSchema = z.object({
  path: z.string().min(1).max(4096),
  content: z.string().max(512 * 1024),
});
export type WriteFileInput = z.infer<typeof writeFileInputSchema>;

const WRITE_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const target = process.argv[1];
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, Buffer.from(process.argv[2], 'base64'), { mode: 0o600 });
`;

export async function writeFileTool(
  executor: SandboxExecutor,
  context: ToolContext,
  input: WriteFileInput,
): Promise<ToolResult> {
  const relativePath = assertAllowedPath(input.path, context.allowedPaths);
  const target = toContainerWorkspacePath(relativePath);
  const result = await executor.execute(
    context.sandboxId,
    ["node", "-e", WRITE_SCRIPT, target, Buffer.from(input.content).toString("base64")],
    30_000,
  );
  if (result.exitCode !== 0) return commandFailure("write_file", result.exitCode, result.stderr);
  return {
    ok: true,
    content: `Wrote ${Buffer.byteLength(input.content)} bytes to ${relativePath}`,
    details: { path: relativePath, bytes: Buffer.byteLength(input.content) },
  };
}
