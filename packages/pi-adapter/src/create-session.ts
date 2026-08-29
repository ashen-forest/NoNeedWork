import { join } from "node:path";

import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import {
  type CreateAgentSessionOptions,
  createAgentSession,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { normalizePiEvent } from "./pi-events.js";
import { classifyNoNeedWorkProviderFailure } from "./provider-errors.js";
import { createBundledResourceLoader } from "./resource-loader.js";
import {
  FORBIDDEN_PI_TOOLS,
  type NoNeedWorkSession,
  type NoNeedWorkSessionOptions,
} from "./types.js";

function chooseSessionManager(options: NoNeedWorkSessionOptions): SessionManager {
  if (options.sessionManager) return options.sessionManager;
  if (options.inMemory) return SessionManager.inMemory(options.cwd);
  if (options.resumeSessionFile) {
    return SessionManager.open(
      options.resumeSessionFile,
      join(options.agentDir, "sessions"),
      options.cwd,
    );
  }
  return SessionManager.create(options.cwd, join(options.agentDir, "sessions"));
}

function assertClosedToolSet(
  activeToolNames: readonly string[],
  allowedToolNames: readonly string[],
): void {
  const forbidden = activeToolNames.filter((name) =>
    FORBIDDEN_PI_TOOLS.includes(name as (typeof FORBIDDEN_PI_TOOLS)[number]),
  );
  const unexpected = activeToolNames.filter((name) => !allowedToolNames.includes(name));
  if (forbidden.length > 0 || unexpected.length > 0) {
    throw new Error(
      `PI tool isolation failed: forbidden=[${forbidden.join(", ")}], unexpected=[${unexpected.join(", ")}]`,
    );
  }
}

export async function createNoNeedWorkSession(
  options: NoNeedWorkSessionOptions,
): Promise<NoNeedWorkSession> {
  const resourceLoader = createBundledResourceLoader(options.systemPrompt);
  await resourceLoader.reload();

  const modelOptions = readModelOptions(options.modelHandle.createSessionModelOptions());
  const allowedToolNames = options.customTools.map((tool) => tool.name);
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  try {
    ({ session } = await createAgentSession({
      cwd: options.cwd,
      agentDir: options.agentDir,
      model: modelOptions.model,
      modelRuntime: modelOptions.modelRuntime,
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      resourceLoader,
      sessionManager: chooseSessionManager(options),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: true },
        retry: { enabled: false, maxRetries: 0 },
        defaultTools: allowedToolNames,
      }),
      noTools: "builtin",
      tools: allowedToolNames,
      excludeTools: [...FORBIDDEN_PI_TOOLS],
      customTools: options.customTools,
    }));
  } catch (error) {
    await options.modelHandle.dispose();
    throw error;
  }

  const activeToolNames = session.getActiveToolNames();
  try {
    assertClosedToolSet(activeToolNames, allowedToolNames);
  } catch (error) {
    session.dispose();
    await options.modelHandle.dispose();
    throw error;
  }

  let lastModelFailure: ReturnType<typeof classifyNoNeedWorkProviderFailure> | undefined;
  const captureUnsubscribe = session.subscribe((event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    const message = event.message as AssistantMessage;
    if (
      message.stopReason !== "error" &&
      message.stopReason !== "aborted" &&
      !message.errorMessage
    ) {
      lastModelFailure = undefined;
      return;
    }
    lastModelFailure = classifyNoNeedWorkProviderFailure(
      message.errorMessage ?? message.stopReason,
      assistantHasOutput(message),
    );
  });

  return {
    id: session.sessionId,
    sessionFile: session.sessionFile,
    activeToolNames: [...activeToolNames],
    prompt: async (text) => session.prompt(text, { expandPromptTemplates: false, source: "rpc" }),
    steer: async (text) => session.steer(text),
    cancel: async () => session.abort(),
    waitForIdle: async () => session.waitForIdle(),
    getLastAssistantText: () => session.getLastAssistantText(),
    getLastModelFailure: () => lastModelFailure,
    subscribe: (listener) => session.subscribe((event) => listener(normalizePiEvent(event))),
    dispose: async () => {
      captureUnsubscribe();
      session.dispose();
      await options.modelHandle.dispose();
    },
  };
}

function assistantHasOutput(message: AssistantMessage): boolean {
  return message.content.some((content) => {
    if (content.type === "text") return content.text.length > 0;
    if (content.type === "thinking") return content.thinking.length > 0;
    return content.type === "toolCall";
  });
}

function readModelOptions(raw: unknown): {
  model: NonNullable<CreateAgentSessionOptions["model"]>;
  modelRuntime: ModelRuntime;
} {
  if (typeof raw !== "object" || raw === null || !("model" in raw) || !("modelRuntime" in raw)) {
    throw new Error("Invalid NoNeedWork model handle");
  }
  return {
    model: (raw as { model: Model<string> }).model as NonNullable<
      CreateAgentSessionOptions["model"]
    >,
    modelRuntime: (raw as { modelRuntime: ModelRuntime }).modelRuntime,
  };
}
