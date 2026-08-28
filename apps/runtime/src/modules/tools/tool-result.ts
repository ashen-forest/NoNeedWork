export interface ToolResult {
  ok: boolean;
  content: string;
  details?: unknown;
}

export function limitCommandOutput(
  stdout: string,
  stderr: string,
  maxBytes: number,
): { stdout: string; stderr: string; truncated: boolean } {
  const stdoutBytes = Buffer.from(stdout);
  const stderrBytes = Buffer.from(stderr);
  if (stdoutBytes.length + stderrBytes.length <= maxBytes) {
    return { stdout, stderr, truncated: false };
  }
  const stdoutBudget = Math.min(stdoutBytes.length, Math.floor(maxBytes * 0.75));
  const stderrBudget = Math.max(0, maxBytes - stdoutBudget);
  return {
    stdout: stdoutBytes.subarray(0, stdoutBudget).toString("utf8"),
    stderr: stderrBytes.subarray(0, stderrBudget).toString("utf8"),
    truncated: true,
  };
}

export function commandFailure(command: string, exitCode: number, stderr: string): ToolResult {
  return {
    ok: false,
    content: `${command} failed with exit code ${exitCode}`,
    details: { exitCode, stderr },
  };
}
