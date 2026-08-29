import { describe, expect, it } from "vitest";

import {
  listNoNeedWorkModelProfiles,
  resolveNoNeedWorkModelIdentity,
} from "./provider-profiles.js";

describe("NoNeedWork provider profiles", () => {
  it("exposes exactly the locked Qwen and MiniMax product profiles", () => {
    const profiles = listNoNeedWorkModelProfiles();
    expect(profiles.map((profile) => profile.profileId)).toEqual(["qwen-cn", "minimax-cn"]);
    expect(profiles).toEqual([
      expect.objectContaining({
        profileId: "qwen-cn",
        defaultModelId: "qwen3.7-plus",
      }),
      expect.objectContaining({
        profileId: "minimax-cn",
        defaultModelId: "MiniMax-M3",
      }),
    ]);
    expect(profiles[0]?.modelIds).toContain("qwen3.7-plus");
    expect(profiles[1]?.modelIds).toContain("MiniMax-M3");
    expect(JSON.stringify(profiles)).not.toMatch(/baseUrl|apiKey|credential|providerId/);
  });

  it("resolves the exact PI provider and protocol identity", () => {
    expect(
      resolveNoNeedWorkModelIdentity({ profileId: "qwen-cn", modelId: "qwen3.7-plus" }),
    ).toEqual({
      profileId: "qwen-cn",
      piProviderId: "qwen-token-plan-cn",
      modelId: "qwen3.7-plus",
      piSdkVersion: "0.84.3",
      api: "openai-completions",
    });
    expect(
      resolveNoNeedWorkModelIdentity({ profileId: "minimax-cn", modelId: "MiniMax-M3" }),
    ).toEqual({
      profileId: "minimax-cn",
      piProviderId: "minimax-cn",
      modelId: "MiniMax-M3",
      piSdkVersion: "0.84.3",
      api: "anthropic-messages",
    });
  });

  it("rejects cross-profile and unknown model selections", () => {
    expect(() =>
      resolveNoNeedWorkModelIdentity({ profileId: "qwen-cn", modelId: "MiniMax-M3" }),
    ).toThrow(/not available/);
    expect(() =>
      resolveNoNeedWorkModelIdentity({ profileId: "minimax-cn", modelId: "missing-model" }),
    ).toThrow(/not available/);
  });
});
