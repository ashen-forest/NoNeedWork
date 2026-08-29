import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { NoNeedWorkModelHandle } from "./model-runtime.js";
import { probeNoNeedWorkModel } from "./provider-probe.js";
import { resolveNoNeedWorkModelIdentity } from "./provider-profiles.js";

const sentinel = "noneedwork-sentinel-secret";

function message(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "qwen-token-plan-cn",
    model: "qwen3.7-plus",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function handleFor(responses: Array<AssistantMessage | Error | "timeout">) {
  const contexts: unknown[] = [];
  let call = 0;
  const runtime = {
    streamSimple(_model: unknown, context: unknown, options: { signal?: AbortSignal }) {
      contexts.push(context);
      const response = responses[call++];
      return {
        result: async () => {
          if (response === "timeout") {
            await new Promise<void>((_resolve, reject) => {
              options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
                once: true,
              });
            });
            throw new Error("unreachable");
          }
          if (response instanceof Error) throw response;
          if (!response) throw new Error("missing fake response");
          return response;
        },
      };
    },
  };
  const handle: NoNeedWorkModelHandle = {
    identity: resolveNoNeedWorkModelIdentity({
      profileId: "qwen-cn",
      modelId: "qwen3.7-plus",
    }),
    createSessionModelOptions: () => ({
      model: { id: "qwen3.7-plus", provider: "qwen-token-plan-cn" },
      modelRuntime: runtime,
    }),
    dispose: async () => {},
  };
  return { contexts, handle };
}

describe("provider probe", () => {
  it("validates exact text and a synthetic tool-call structure without execution", async () => {
    const fixture = handleFor([
      message([{ type: "text", text: "OK" }]),
      message([
        { type: "toolCall", id: "probe-1", name: "noneedwork_probe", arguments: { value: "OK" } },
      ]),
    ]);

    const result = await probeNoNeedWorkModel({ handle: fixture.handle, timeoutMs: 1_000 });

    expect(result).toMatchObject({
      success: true,
      checks: { text: true, toolCall: true },
      profileId: "qwen-cn",
      modelId: "qwen3.7-plus",
    });
    expect(fixture.contexts).toHaveLength(2);
    expect(JSON.stringify(fixture.contexts[1])).toContain("noneedwork_probe");
    expect(JSON.stringify(fixture.contexts[1])).not.toContain("execute");
  });

  it("returns a protocol error for a malformed tool call", async () => {
    const fixture = handleFor([
      message([{ type: "text", text: "OK" }]),
      message([
        { type: "toolCall", id: "probe-1", name: "wrong_tool", arguments: { value: "OK" } },
      ]),
    ]);
    expect(await probeNoNeedWorkModel({ handle: fixture.handle })).toMatchObject({
      success: false,
      checks: { text: true, toolCall: false },
      errorCode: "MODEL_PROTOCOL_ERROR",
    });
  });

  it("aborts on timeout and returns a temporary-unavailable result", async () => {
    const fixture = handleFor(["timeout"]);
    expect(await probeNoNeedWorkModel({ handle: fixture.handle, timeoutMs: 5 })).toMatchObject({
      success: false,
      checks: { text: false, toolCall: false },
      errorCode: "MODEL_TEMPORARILY_UNAVAILABLE",
    });
  });

  it("never includes provider error or secret text in its result", async () => {
    const fixture = handleFor([new Error(`provider failure ${sentinel}`)]);
    const result = await probeNoNeedWorkModel({ handle: fixture.handle });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result).toMatchObject({ success: false, errorCode: "MODEL_PROTOCOL_ERROR" });
  });

  it("classifies provider failures and treats failures after output as unknown", async () => {
    const authFailure = message([]);
    authFailure.stopReason = "error";
    authFailure.errorMessage = "HTTP 401";
    const auth = handleFor([authFailure]);
    expect(await probeNoNeedWorkModel({ handle: auth.handle })).toMatchObject({
      success: false,
      errorCode: "MODEL_AUTH_REJECTED",
    });

    const partialFailure = message([{ type: "thinking", thinking: "partial" }]);
    partialFailure.stopReason = "error";
    partialFailure.errorMessage = "HTTP 500";
    const partial = handleFor([partialFailure]);
    expect(await probeNoNeedWorkModel({ handle: partial.handle })).toMatchObject({
      success: false,
      errorCode: "UNKNOWN_MODEL_OUTCOME",
    });
  });
});
