import { describe, expect, it } from "vitest";

import {
  createNoNeedWorkModelHandle,
  type ModelRuntimeLike,
  type ModelRuntimeLikeFactory,
} from "./model-runtime.js";

const sentinel = "noneedwork-sentinel-secret";

function createRuntimeFixture(modelExists = true) {
  const calls: string[] = [];
  const runtime: ModelRuntimeLike = {
    setRuntimeApiKey: async (providerId, credential) => {
      calls.push(`set:${providerId}:${credential === sentinel}`);
    },
    removeRuntimeApiKey: async (providerId) => {
      calls.push(`remove:${providerId}`);
    },
    getModel: (providerId, modelId) =>
      modelExists ? { provider: providerId, id: modelId, api: "openai-completions" } : undefined,
    streamSimple: () => {
      throw new Error("not used");
    },
  };
  let createOptions: unknown;
  const runtimeFactory: ModelRuntimeLikeFactory = {
    create: async (options) => {
      createOptions = options;
      return runtime;
    },
  };
  return { calls, runtimeFactory, getCreateOptions: () => createOptions };
}

describe("NoNeedWork model handle", () => {
  it("uses an in-memory store, disables model network, and injects one provider key", async () => {
    const fixture = createRuntimeFixture();
    const handle = await createNoNeedWorkModelHandle(
      {
        selection: { profileId: "qwen-cn", modelId: "qwen3.7-plus" },
        credential: sentinel,
      },
      { runtimeFactory: fixture.runtimeFactory },
    );

    expect(fixture.getCreateOptions()).toMatchObject({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
      credentials: expect.any(Object),
    });
    expect(fixture.calls).toEqual(["set:qwen-token-plan-cn:true"]);
    expect(handle.identity).toMatchObject({
      profileId: "qwen-cn",
      piProviderId: "qwen-token-plan-cn",
      modelId: "qwen3.7-plus",
    });
    expect(handle.createSessionModelOptions()).toMatchObject({
      model: { id: "qwen3.7-plus" },
      modelRuntime: expect.any(Object),
    });
  });

  it("cleans the runtime key if model resolution fails", async () => {
    const fixture = createRuntimeFixture(false);
    await expect(
      createNoNeedWorkModelHandle(
        {
          selection: { profileId: "qwen-cn", modelId: "qwen3.7-plus" },
          credential: sentinel,
        },
        { runtimeFactory: fixture.runtimeFactory },
      ),
    ).rejects.toThrow("Configured model is unavailable");
    expect(fixture.calls).toEqual(["set:qwen-token-plan-cn:true", "remove:qwen-token-plan-cn"]);
  });

  it("disposes idempotently and makes internals inaccessible", async () => {
    const fixture = createRuntimeFixture();
    const handle = await createNoNeedWorkModelHandle(
      {
        selection: { profileId: "qwen-cn", modelId: "qwen3.7-plus" },
        credential: sentinel,
      },
      { runtimeFactory: fixture.runtimeFactory },
    );
    await Promise.all([handle.dispose(), handle.dispose()]);
    await handle.dispose();

    expect(fixture.calls.filter((call) => call.startsWith("remove:"))).toHaveLength(1);
    expect(() => handle.createSessionModelOptions()).toThrow("Model handle is disposed");
  });

  it("never includes the credential in public errors", async () => {
    const fixture = createRuntimeFixture();
    fixture.runtimeFactory.create = async () => {
      throw new Error(`native runtime failure ${sentinel}`);
    };
    try {
      await createNoNeedWorkModelHandle(
        {
          selection: { profileId: "qwen-cn", modelId: "qwen3.7-plus" },
          credential: sentinel,
        },
        { runtimeFactory: fixture.runtimeFactory },
      );
      throw new Error("Expected handle creation to fail");
    } catch (error) {
      expect(String(error)).not.toContain(sentinel);
      expect(error).toMatchObject({ code: "MODEL_RUNTIME_INITIALIZATION_FAILED" });
    }
  });
});
