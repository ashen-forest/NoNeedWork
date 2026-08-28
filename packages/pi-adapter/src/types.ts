import type {
  CreateAgentSessionOptions,
  ModelRuntime,
  SessionManager,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export const FORBIDDEN_PI_TOOLS = ["bash", "powershell", "edit", "write"] as const;
export const PI_SDK_VERSION = "0.84.3" as const;

export type NoNeedWorkModel = NonNullable<CreateAgentSessionOptions["model"]>;
export type NoNeedWorkModelRuntime = ModelRuntime;
export type NoNeedWorkTool = ToolDefinition;

export interface NoNeedWorkSessionOptions {
  cwd: string;
  agentDir: string;
  systemPrompt: string;
  customTools: NoNeedWorkTool[];
  model?: NoNeedWorkModel;
  modelRuntime?: NoNeedWorkModelRuntime;
  thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"];
  resumeSessionFile?: string;
  inMemory?: boolean;
  /** Test seam. Product code should use inMemory or resumeSessionFile instead. */
  sessionManager?: SessionManager;
}

export type NoNeedWorkPiEvent =
  | { type: "agent.started" }
  | { type: "agent.finished"; willRetry: boolean }
  | { type: "agent.settled" }
  | { type: "turn.started" }
  | { type: "turn.finished" }
  | { type: "output.delta"; delta: string }
  | { type: "message.started"; role: string }
  | { type: "message.finished"; role: string }
  | { type: "tool.started"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool.updated"; toolCallId: string; toolName: string; partialResult: unknown }
  | {
      type: "tool.finished";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "queue.changed"; steering: number; followUp: number }
  | { type: "compaction.started"; reason: "manual" | "threshold" | "overflow" }
  | {
      type: "compaction.finished";
      reason: "manual" | "threshold" | "overflow";
      aborted: boolean;
      willRetry: boolean;
    }
  | { type: "retry.started"; attempt: number; maxAttempts: number; delayMs: number }
  | { type: "retry.finished"; success: boolean; attempt: number }
  | { type: "pi.event"; name: string };

export interface NoNeedWorkSession {
  readonly id: string;
  readonly activeToolNames: readonly string[];
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  cancel(): Promise<void>;
  waitForIdle(): Promise<void>;
  subscribe(listener: (event: NoNeedWorkPiEvent) => void): () => void;
  dispose(): void;
}
