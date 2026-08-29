import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

import { type AssistantMessage, type Context, type Model, Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { createNoNeedWorkModelHandle, type NoNeedWorkModelHandle } from "./model-runtime.js";
import { classifyNoNeedWorkProviderFailure } from "./provider-errors.js";

const credential = "noneedwork-offline-contract-credential";
const forbiddenTools = ["bash", "powershell", "edit", "write"];
const servers: FakeProviderServer[] = [];

type ProviderFixture = "qwen" | "minimax";
type ResponseMode =
  | { type: "success" }
  | { type: "status"; status: number; code?: string; retryAfter?: string }
  | { type: "malformed" }
  | { type: "hang" }
  | { type: "disconnect-after-output" };

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

interface FakeProviderServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Qwen PI provider runtime contract", () => {
  it("normalizes OpenAI-compatible thinking, text, fragmented tools, and usage", async () => {
    const server = await startFakeProvider("qwen", { type: "success" });
    const handle = await createTestHandle("qwen", server.baseUrl);
    try {
      const message = await complete(handle, protocolContext());

      expect(message.stopReason).toBe("toolUse");
      expect(message.content).toEqual([
        expect.objectContaining({ type: "thinking", thinking: "think" }),
        expect.objectContaining({ type: "text", text: "OK" }),
        expect.objectContaining({
          type: "toolCall",
          id: "call-noneedwork",
          name: "noneedwork_probe",
          arguments: { value: "OK" },
        }),
      ]);
      expect(message.usage).toMatchObject({ input: 5, output: 3, totalTokens: 8 });
      expect(server.requests).toHaveLength(1);
      const request = server.requests[0];
      expect(request?.headers.authorization).toBe(`Bearer ${credential}`);
      expect(request?.body).toMatchObject({ model: "qwen3.7-plus", stream: true });
      assertSafeToolRequest(request?.body);
    } finally {
      await handle.dispose();
    }
  });
});

describe("MiniMax PI provider runtime contract", () => {
  it("normalizes Anthropic thinking, text, fragmented tool_use, usage, and cache shape", async () => {
    const server = await startFakeProvider("minimax", { type: "success" });
    const handle = await createTestHandle("minimax", server.baseUrl);
    try {
      const message = await complete(handle, protocolContext());

      expect(message.stopReason).toBe("toolUse");
      expect(message.content).toEqual([
        expect.objectContaining({ type: "thinking", thinking: "think" }),
        expect.objectContaining({ type: "text", text: "OK" }),
        expect.objectContaining({
          type: "toolCall",
          id: "tool-noneedwork",
          name: "noneedwork_probe",
          arguments: { value: "OK" },
        }),
      ]);
      expect(message.usage).toMatchObject({ input: 7, output: 4, totalTokens: 11 });
      expect(server.requests).toHaveLength(1);
      const request = server.requests[0];
      expect(request?.headers["x-api-key"]).toBe(credential);
      expect(request?.body).toMatchObject({ model: "MiniMax-M3", stream: true });
      expect(JSON.stringify(request?.body)).toContain("cache_control");
      assertSafeToolRequest(request?.body);
    } finally {
      await handle.dispose();
    }
  });
});

describe("PI provider failure contract", () => {
  const statusCases = [
    [401, "MODEL_AUTH_REJECTED"],
    [403, "MODEL_AUTH_REJECTED"],
    [402, "MODEL_QUOTA_EXHAUSTED"],
    [404, "MODEL_UNAVAILABLE"],
    [408, "MODEL_TEMPORARILY_UNAVAILABLE"],
    [429, "MODEL_RATE_LIMITED"],
    [500, "MODEL_TEMPORARILY_UNAVAILABLE"],
    [503, "MODEL_TEMPORARILY_UNAVAILABLE"],
  ] as const;

  for (const [status, reason] of statusCases) {
    it(`classifies HTTP ${status} after exactly one provider request`, async () => {
      const server = await startFakeProvider("qwen", {
        type: "status",
        status,
        ...(status === 402 ? { code: "insufficient_quota" } : {}),
        ...(status === 429 ? { retryAfter: "2" } : {}),
      });
      const handle = await createTestHandle("qwen", server.baseUrl);
      try {
        const message = await complete(handle, textContext());
        expect(message.stopReason).toBe("error");
        expect(
          classifyNoNeedWorkProviderFailure(message.errorMessage ?? "", hasOutput(message)).reason,
        ).toBe(reason);
        expect(server.requests).toHaveLength(1);
      } finally {
        await handle.dispose();
      }
    });
  }

  it("treats malformed SSE before output as a protocol error", async () => {
    const server = await startFakeProvider("qwen", { type: "malformed" });
    const handle = await createTestHandle("qwen", server.baseUrl);
    try {
      const message = await complete(handle, textContext());
      expect(classifyMessage(message).reason).toBe("MODEL_PROTOCOL_ERROR");
      expect(server.requests).toHaveLength(1);
    } finally {
      await handle.dispose();
    }
  });

  it("aborts a request before output without PI retry", async () => {
    const server = await startFakeProvider("minimax", { type: "hang" });
    const handle = await createTestHandle("minimax", server.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25);
    try {
      const message = await complete(handle, textContext(), controller.signal);
      expect(message.stopReason).toMatch(/aborted|error/u);
      expect(server.requests).toHaveLength(1);
    } finally {
      clearTimeout(timer);
      await handle.dispose();
    }
  });

  it("classifies a disconnect after output as an unknown model outcome", async () => {
    const server = await startFakeProvider("qwen", { type: "disconnect-after-output" });
    const handle = await createTestHandle("qwen", server.baseUrl);
    try {
      const message = await complete(handle, textContext());
      expect(hasOutput(message)).toBe(true);
      expect(classifyMessage(message).reason).toBe("UNKNOWN_MODEL_OUTCOME");
      expect(server.requests).toHaveLength(1);
    } finally {
      await handle.dispose();
    }
  });
});

async function createTestHandle(
  provider: ProviderFixture,
  baseUrl: string,
): Promise<NoNeedWorkModelHandle> {
  const inner = await createNoNeedWorkModelHandle({
    selection:
      provider === "qwen"
        ? { profileId: "qwen-cn", modelId: "qwen3.7-plus" }
        : { profileId: "minimax-cn", modelId: "MiniMax-M3" },
    credential,
  });
  const raw = inner.createSessionModelOptions() as {
    model: Model<string>;
    modelRuntime: unknown;
  };
  const model = { ...raw.model, baseUrl };
  return {
    identity: inner.identity,
    createSessionModelOptions: () => ({ model, modelRuntime: raw.modelRuntime }),
    dispose: () => inner.dispose(),
  };
}

async function complete(
  handle: NoNeedWorkModelHandle,
  context: Context,
  signal?: AbortSignal,
): Promise<AssistantMessage> {
  const raw = handle.createSessionModelOptions() as {
    model: Model<string>;
    modelRuntime: {
      streamSimple(
        model: Model<string>,
        context: Context,
        options: Record<string, unknown>,
      ): { result(): Promise<AssistantMessage> };
    };
  };
  return raw.modelRuntime
    .streamSimple(raw.model, context, {
      maxTokens: 32,
      maxRetries: 0,
      timeoutMs: 1_000,
      ...(signal ? { signal } : {}),
    })
    .result();
}

function protocolContext(): Context {
  return {
    systemPrompt: "Keep this provider contract prompt cacheable.",
    messages: [{ role: "user", content: "Use the probe tool.", timestamp: Date.now() }],
    tools: [
      {
        name: "noneedwork_probe",
        description: "Offline protocol fixture",
        parameters: Type.Object({ value: Type.Literal("OK") }),
      },
    ],
  };
}

function textContext(): Context {
  return {
    messages: [{ role: "user", content: "Respond with OK.", timestamp: Date.now() }],
  };
}

function classifyMessage(message: AssistantMessage) {
  return classifyNoNeedWorkProviderFailure(
    message.errorMessage ?? message.stopReason,
    hasOutput(message),
  );
}

function hasOutput(message: AssistantMessage): boolean {
  return message.content.some((content) => {
    if (content.type === "text") return content.text.length > 0;
    if (content.type === "thinking") return content.thinking.length > 0;
    return content.type === "toolCall";
  });
}

function assertSafeToolRequest(body: unknown): void {
  const serialized = JSON.stringify(body);
  expect(serialized).toContain("noneedwork_probe");
  for (const tool of forbiddenTools) expect(serialized).not.toContain(`"name":"${tool}"`);
}

async function startFakeProvider(
  provider: ProviderFixture,
  mode: ResponseMode,
): Promise<FakeProviderServer> {
  const requests: CapturedRequest[] = [];
  const fixture =
    mode.type === "success"
      ? await readFile(
          join(import.meta.dirname, "..", "test", "fixtures", provider, "success.sse"),
          "utf8",
        )
      : undefined;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
      body: body.length > 0 ? JSON.parse(body) : undefined,
    });
    writeProviderResponse(provider, mode, fixture, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake provider did not bind TCP");
  const basePath = provider === "qwen" ? "/qwen/v1" : "/minimax";
  const result: FakeProviderServer = {
    baseUrl: `http://127.0.0.1:${address.port}${basePath}`,
    requests,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
  servers.push(result);
  return result;
}

function writeProviderResponse(
  provider: ProviderFixture,
  mode: ResponseMode,
  fixture: string | undefined,
  response: ServerResponse,
): void {
  if (mode.type === "status") {
    response.writeHead(mode.status, {
      "content-type": "application/json",
      ...(mode.retryAfter ? { "retry-after": mode.retryAfter } : {}),
    });
    response.end(
      JSON.stringify({
        error: { message: mode.code ?? `fixture HTTP ${mode.status}`, code: mode.code },
      }),
    );
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  if (mode.type === "success") {
    response.end(fixture);
    return;
  }
  if (mode.type === "malformed") {
    response.end("data: {not-json}\n\n");
    return;
  }
  if (mode.type === "disconnect-after-output") {
    response.write(
      provider === "qwen"
        ? 'data: {"id":"partial","model":"qwen3.7-plus","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n'
        : 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n',
    );
    setTimeout(() => response.destroy(), 10).unref();
    return;
  }
  // hang intentionally keeps the response open until the request signal aborts.
}
