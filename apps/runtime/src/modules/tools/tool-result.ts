export interface ToolResult {
  ok: boolean;
  content: string;
  details?: unknown;
}

export function commandFailure(command: string, exitCode: number, stderr: string): ToolResult {
  return {
    ok: false,
    content: `${command} failed with exit code ${exitCode}`,
    details: { exitCode, stderr },
  };
}
