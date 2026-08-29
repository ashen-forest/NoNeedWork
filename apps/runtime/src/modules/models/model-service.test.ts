import type { ModelSelection, TaskModelBinding } from "@noneedwork/protocol";
import { describe, expect, it } from "vitest";

import { FakeCredentialVault } from "../credentials/fake-credential-vault.js";
import { RuntimeDatabase } from "../storage/database.js";
import { ModelBlockedError } from "./model-errors.js";
import { ModelPreferenceRepository } from "./model-preference-repository.js";
import { ModelService, type RuntimeModelAdapter } from "./model-service.js";
import { createTestModelBinding } from "./testing.js";

function fixture() {
  const database = new RuntimeDatabase(":memory:");
  const credentials = new FakeCredentialVault({
    now: () => new Date("2026-08-29T00:00:00.000Z"),
  });
  const handleCredentials: string[] = [];
  let disposals = 0;
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
    createHandle: async ({ selection, credential }) => {
      handleCredentials.push(credential);
      return {
        identity: adapter.resolveIdentity(selection),
        createSessionModelOptions: () => ({ model: {}, modelRuntime: {} }),
        dispose: async () => {
          disposals += 1;
        },
      };
    },
    probe: async ({ handle }) => ({
      profileId: handle.identity.profileId,
      modelId: handle.identity.modelId,
      success: true,
      latencyMs: 1,
      checks: { text: true, toolCall: true },
    }),
  };
  const service = new ModelService({
    preferences: new ModelPreferenceRepository(database),
    bindings: { get: () => undefined },
    credentials,
    adapter,
  });
  return {
    adapter,
    credentials,
    database,
    disposals: () => disposals,
    handleCredentials,
    service,
  };
}

describe("ModelService", () => {
  it("resolves the Qwen fallback and an explicit MiniMax override", () => {
    const harness = fixture();
    try {
      expect(harness.service.getDefaultSelection()).toEqual({
        profileId: "qwen-cn",
        modelId: "qwen3.7-plus",
      });
      expect(harness.service.resolveTaskSelection()).toMatchObject({
        profileId: "qwen-cn",
        piProviderId: "qwen-token-plan-cn",
        modelId: "qwen3.7-plus",
        selectionSource: "default",
      });
      expect(
        harness.service.resolveTaskSelection({ profileId: "minimax-cn", modelId: "MiniMax-M3" }),
      ).toMatchObject({
        profileId: "minimax-cn",
        piProviderId: "minimax-cn",
        modelId: "MiniMax-M3",
        selectionSource: "task_override",
      });
    } finally {
      harness.database.close();
    }
  });

  it("validates model membership before persisting a default", () => {
    const harness = fixture();
    try {
      expect(() =>
        harness.service.setDefaultSelection({ profileId: "qwen-cn", modelId: "MiniMax-M3" }),
      ).toThrow(/not available/);
      expect(harness.service.getDefaultSelection()).toEqual({
        profileId: "qwen-cn",
        modelId: "qwen3.7-plus",
      });
    } finally {
      harness.database.close();
    }
  });

  it("blocks missing credentials and PI-version mismatches without network calls", async () => {
    const harness = fixture();
    try {
      await expect(harness.service.createHandle(createTestModelBinding())).rejects.toMatchObject({
        modelBlock: { reason: "MODEL_CREDENTIAL_MISSING" },
      });
      expect(() =>
        harness.service.preflight({
          ...createTestModelBinding(),
          piSdkVersion: "0.84.2" as TaskModelBinding["piSdkVersion"],
        }),
      ).toThrow(ModelBlockedError);
      expect(harness.handleCredentials).toEqual([]);
    } finally {
      harness.database.close();
    }
  });

  it("uses the current credential only for each subsequent handle", async () => {
    const harness = fixture();
    try {
      harness.credentials.set("qwen-cn", "first-credential-value");
      await harness.service.createHandle(createTestModelBinding());
      harness.credentials.set("qwen-cn", "second-credential-value");
      await harness.service.createHandle(createTestModelBinding());
      expect(harness.handleCredentials).toEqual([
        "first-credential-value",
        "second-credential-value",
      ]);
    } finally {
      harness.database.close();
    }
  });

  it("disposes a probe handle even after a successful probe", async () => {
    const harness = fixture();
    try {
      harness.credentials.set("minimax-cn", "minimax-credential-value");
      expect(await harness.service.probe("minimax-cn")).toMatchObject({ success: true });
      expect(harness.disposals()).toBe(1);
    } finally {
      harness.database.close();
    }
  });
});
