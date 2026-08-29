import { type AssistantMessage, type Context, type Model, Type } from "@earendil-works/pi-ai";
import {
  type ModelBlockReason,
  type ModelProbeResult,
  modelProbeResultSchema,
} from "@noneedwork/protocol";

import type { NoNeedWorkModelHandle } from "./model-runtime.js";
import { classifyNoNeedWorkProviderFailure } from "./provider-errors.js";

interface ProbeStream {
  result(): Promise<AssistantMessage>;
}

interface ProbeRuntime {
  streamSimple(
    model: Model<string>,
    context: Context,
    options: {
      maxTokens: number;
      maxRetries: number;
      timeoutMs: number;
      signal: AbortSignal;
    },
  ): ProbeStream;
}

export interface ProbeNoNeedWorkModelOptions {
  handle: NoNeedWorkModelHandle;
  timeoutMs?: number;
}

const MAX_TIMEOUT_MS = 30_000;

export async function probeNoNeedWorkModel(
  options: ProbeNoNeedWorkModelOptions,
): Promise<ModelProbeResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error("Provider probe timeout must be between 1 and 30000 milliseconds");
  }
  const startedAt = Date.now();
  const checks = { text: false, toolCall: false };
  const { model, runtime } = readProbeOptions(options.handle);

  try {
    const text = await runBoundedProbe(runtime, model, textContext(), timeoutMs);
    const textFailure = assistantFailure(text);
    if (textFailure) return result(options.handle, startedAt, checks, textFailure);
    checks.text = exactText(text) === "OK";
    if (!checks.text) return result(options.handle, startedAt, checks, "MODEL_PROTOCOL_ERROR");

    const tool = await runBoundedProbe(runtime, model, toolContext(), timeoutMs);
    const toolFailure = assistantFailure(tool);
    if (toolFailure) return result(options.handle, startedAt, checks, toolFailure);
    checks.toolCall = hasExactProbeToolCall(tool);
    return checks.toolCall
      ? result(options.handle, startedAt, checks)
      : result(options.handle, startedAt, checks, "MODEL_PROTOCOL_ERROR");
  } catch (error) {
    const errorCode: ModelBlockReason = isTimeoutError(error)
      ? "MODEL_TEMPORARILY_UNAVAILABLE"
      : "MODEL_PROTOCOL_ERROR";
    return result(options.handle, startedAt, checks, errorCode);
  }
}

function assistantFailure(message: AssistantMessage): ModelBlockReason | undefined {
  if (message.stopReason !== "error" && message.stopReason !== "aborted" && !message.errorMessage) {
    return undefined;
  }
  return classifyNoNeedWorkProviderFailure(
    message.errorMessage ?? message.stopReason,
    message.content.some((content) => {
      if (content.type === "text") return content.text.length > 0;
      if (content.type === "thinking") return content.thinking.length > 0;
      return content.type === "toolCall";
    }),
  ).reason;
}

async function runBoundedProbe(
  runtime: ProbeRuntime,
  model: Model<string>,
  context: Context,
  timeoutMs: number,
): Promise<AssistantMessage> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Provider probe timed out", "TimeoutError")),
    timeoutMs,
  );
  timer.unref?.();
  try {
    return await runtime
      .streamSimple(model, context, {
        maxTokens: 32,
        maxRetries: 0,
        timeoutMs,
        signal: controller.signal,
      })
      .result();
  } finally {
    clearTimeout(timer);
  }
}

function textContext(): Context {
  return {
    messages: [
      {
        role: "user",
        content: "Respond with exactly OK.",
        timestamp: Date.now(),
      },
    ],
  };
}

function toolContext(): Context {
  return {
    messages: [
      {
        role: "user",
        content: 'Call noneedwork_probe exactly once with {"value":"OK"}.',
        timestamp: Date.now(),
      },
    ],
    tools: [
      {
        name: "noneedwork_probe",
        description: "Validate provider tool-call protocol without executing a tool.",
        parameters: Type.Object({ value: Type.Literal("OK") }),
      },
    ],
  };
}

function exactText(message: AssistantMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("")
    .trim();
}

function hasExactProbeToolCall(message: AssistantMessage): boolean {
  const calls = message.content.filter((content) => content.type === "toolCall");
  return (
    calls.length === 1 &&
    calls[0]?.name === "noneedwork_probe" &&
    calls[0].arguments.value === "OK" &&
    Object.keys(calls[0].arguments).length === 1
  );
}

function result(
  handle: NoNeedWorkModelHandle,
  startedAt: number,
  checks: { text: boolean; toolCall: boolean },
  errorCode?: ModelBlockReason,
): ModelProbeResult {
  const latencyMs = Math.min(2_147_483_647, Math.max(0, Date.now() - startedAt));
  return modelProbeResultSchema.parse({
    profileId: handle.identity.profileId,
    modelId: handle.identity.modelId,
    success: errorCode === undefined && checks.text && checks.toolCall,
    latencyMs,
    checks,
    ...(errorCode ? { errorCode } : {}),
  });
}

function readProbeOptions(handle: NoNeedWorkModelHandle): {
  model: Model<string>;
  runtime: ProbeRuntime;
} {
  const raw = handle.createSessionModelOptions();
  if (typeof raw !== "object" || raw === null || !("model" in raw) || !("modelRuntime" in raw)) {
    throw new Error("Invalid NoNeedWork model handle");
  }
  const runtime = (raw as { modelRuntime: Partial<ProbeRuntime> }).modelRuntime;
  if (typeof runtime.streamSimple !== "function") throw new Error("Invalid model probe runtime");
  return {
    model: (raw as { model: Model<string> }).model,
    runtime: runtime as ProbeRuntime,
  };
}

function isTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    (error instanceof Error && error.name === "TimeoutError")
  );
}
