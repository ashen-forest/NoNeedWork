import { join } from "node:path";

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { normalizePiEvent } from "./pi-events.js";
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

  const modelRuntime =
    options.modelRuntime ??
    (await ModelRuntime.create({
      authPath: join(options.agentDir, "auth.json"),
      modelsPath: join(options.agentDir, "models.json"),
      allowModelNetwork: false,
    }));
  const allowedToolNames = options.customTools.map((tool) => tool.name);
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    ...(options.model ? { model: options.model } : {}),
    modelRuntime,
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    resourceLoader,
    sessionManager: chooseSessionManager(options),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
      defaultTools: allowedToolNames,
    }),
    noTools: "builtin",
    tools: allowedToolNames,
    excludeTools: [...FORBIDDEN_PI_TOOLS],
    customTools: options.customTools,
  });

  const activeToolNames = session.getActiveToolNames();
  try {
    assertClosedToolSet(activeToolNames, allowedToolNames);
  } catch (error) {
    session.dispose();
    throw error;
  }

  return {
    id: session.sessionId,
    activeToolNames: [...activeToolNames],
    prompt: async (text) => session.prompt(text, { expandPromptTemplates: false, source: "rpc" }),
    steer: async (text) => session.steer(text),
    cancel: async () => session.abort(),
    waitForIdle: async () => session.waitForIdle(),
    subscribe: (listener) => session.subscribe((event) => listener(normalizePiEvent(event))),
    dispose: () => session.dispose(),
  };
}
