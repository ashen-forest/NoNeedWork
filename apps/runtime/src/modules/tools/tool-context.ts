export interface ToolContext {
  sandboxId: string;
  taskId?: string;
  runId?: string;
  stepId?: string;
  toolCallId?: string;
  allowedPaths?: readonly string[];
}
