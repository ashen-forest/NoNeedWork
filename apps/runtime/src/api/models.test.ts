import type { ModelSelection } from "@noneedwork/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRuntimeApp } from "../app.js";
import { createRuntimeConfig } from "../config.js";
import { FakeCredentialVault } from "../modules/credentials/fake-credential-vault.js";
import type { RuntimeModelAdapter } from "../modules/models/model-service.js";
import { createRuntimeServices } from "../services.js";

const token = "a".repeat(64);
const sentinel = "noneedwork-sentinel-secret";
const apps: ReturnType<typeof buildRuntimeApp>[] = [];

const headers = {
  authorization: `Bearer ${token}`,
  "x-noneedwork-protocol": "1",
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp() {
  const credentials = new FakeCredentialVault({
    now: () => new Date("2026-08-29T00:00:00.000Z"),
  });
  const adapter: RuntimeModelAdapter = {
    listProfiles: () => [
      {
        profileId: "qwen-cn",
        displayName: "Qwen Token Plan CN",
        defaultModelId: "qwen3.7-plus",
        modelIds: ["qwen3.7-plus"],
        capabilities: { text: true, thinking: true, toolCalls: true, images: false },
      },
      {
        profileId: "minimax-cn",
        displayName: "MiniMax Token Plan CN",
        defaultModelId: "MiniMax-M3",
        modelIds: ["MiniMax-M3"],
        capabilities: { text: true, thinking: true, toolCalls: true, images: false },
      },
    ],
    resolveIdentity: (selection: ModelSelection) => ({
      ...selection,
      piProviderId: selection.profileId === "qwen-cn" ? "qwen-token-plan-cn" : "minimax-cn",
      piSdkVersion: "0.84.3",
      api: selection.profileId === "qwen-cn" ? "openai-completions" : "anthropic-messages",
    }),
    createHandle: async ({ selection }) => ({
      identity: adapter.resolveIdentity(selection),
      createSessionModelOptions: () => ({ model: {}, modelRuntime: {} }),
      dispose: async () => {},
    }),
    probe: async ({ handle }) => ({
      profileId: handle.identity.profileId,
      modelId: handle.identity.modelId,
      success: true,
      latencyMs: 2,
      checks: { text: true, toolCall: true },
    }),
  };
  const config = createRuntimeConfig({ launchToken: token });
  const services = createRuntimeServices(config, {
    databasePath: ":memory:",
    credentialVault: credentials,
    modelAdapter: adapter,
    autoStartTasks: false,
  });
  const app = buildRuntimeApp(config, services);
  apps.push(app);
  return { app, credentials, services };
}

describe("model API", () => {
  it("requires local authentication and exposes only product profile fields", async () => {
    const { app } = createApp();
    const unauthorized = await app.inject({
      method: "GET",
      url: "/v1/models/profiles",
      headers: { "x-noneedwork-protocol": "1" },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/models/profiles",
      headers,
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profiles: [
        { profileId: "qwen-cn", defaultModelId: "qwen3.7-plus" },
        { profileId: "minimax-cn", defaultModelId: "MiniMax-M3" },
      ],
    });
    expect(response.body).not.toMatch(/baseUrl|apiKey|credential|secret/iu);
  });

  it("selects only a model in its profile", async () => {
    const { app } = createApp();
    const selected = await app.inject({
      method: "PUT",
      url: "/v1/models/selection",
      headers,
      payload: { profileId: "minimax-cn", modelId: "MiniMax-M3" },
    });
    const invalid = await app.inject({
      method: "PUT",
      url: "/v1/models/selection",
      headers,
      payload: { profileId: "qwen-cn", modelId: "MiniMax-M3" },
    });

    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toEqual({ profileId: "minimax-cn", modelId: "MiniMax-M3" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { message: "Selected model is not available for the profile" },
    });
  });

  it("sets, lists, and deletes a write-only credential without reflection", async () => {
    const { app, credentials } = createApp();
    const set = await app.inject({
      method: "PUT",
      url: "/v1/models/credentials/qwen-cn",
      headers,
      payload: { secret: sentinel },
    });
    const list = await app.inject({
      method: "GET",
      url: "/v1/models/credentials",
      headers,
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/models/credentials/qwen-cn",
      headers,
    });

    expect(credentials.get("qwen-cn")).toBeUndefined();
    expect(set.statusCode).toBe(200);
    expect(list.statusCode).toBe(200);
    expect(deleted.statusCode).toBe(200);
    expect(`${set.body}${list.body}${deleted.body}`).not.toContain(sentinel);
  });

  it("probes a configured profile and returns a schema-bounded summary", async () => {
    const { app } = createApp();
    await app.inject({
      method: "PUT",
      url: "/v1/models/credentials/minimax-cn",
      headers,
      payload: { secret: sentinel },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/models/probe/minimax-cn",
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profileId: "minimax-cn",
      modelId: "MiniMax-M3",
      success: true,
      latencyMs: 2,
      checks: { text: true, toolCall: true },
    });
  });

  it("suppresses credential input, native failures, and unrecognized server errors", async () => {
    const { app, services } = createApp();
    const invalid = await app.inject({
      method: "PUT",
      url: "/v1/models/credentials/qwen-cn",
      headers,
      payload: { secret: "short" },
    });
    vi.spyOn(services.modelService, "listProfiles").mockImplementation(() => {
      throw new Error(`unexpected ${sentinel}`);
    });
    const failed = await app.inject({
      method: "GET",
      url: "/v1/models/profiles",
      headers,
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain("short");
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({ error: { message: "Internal Runtime error" } });
    expect(failed.body).not.toContain(sentinel);
  });
});
