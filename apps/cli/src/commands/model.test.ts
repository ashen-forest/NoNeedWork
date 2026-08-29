import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { type ModelCommandClient, registerModelCommand } from "./model.js";

const sentinel = "noneedwork-sentinel-secret";

function fixture() {
  const calls: unknown[] = [];
  const client: ModelCommandClient = {
    listModelProfiles: async () => ({
      profiles: [
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
    }),
    getModelSelection: async () => ({ profileId: "qwen-cn", modelId: "qwen3.7-plus" }),
    setModelSelection: async (selection) => {
      calls.push(["select", selection]);
      return selection;
    },
    listModelCredentials: async () => ({ credentials: [] }),
    setModelCredential: async (profileId, secret) => {
      calls.push(["set", profileId, secret]);
      return {
        profileId,
        configured: true,
        updatedAt: "2026-08-29T00:00:00.000Z",
      };
    },
    deleteModelCredential: async (profileId) => ({
      profileId,
      configured: false,
      updatedAt: null,
    }),
    probeModel: async (profileId) => {
      calls.push(["probe", profileId]);
      return {
        profileId,
        modelId: profileId === "qwen-cn" ? "qwen3.7-plus" : "MiniMax-M3",
        success: true,
        latencyMs: 1,
        checks: { text: true, toolCall: true },
      };
    },
  };
  let stdout = "";
  let stderr = "";
  const program = new Command().exitOverride();
  registerModelCommand(program, {
    connect: async () => ({ client }),
    readSecret: async () => sentinel,
    confirm: async () => true,
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { calls, program, stderr: () => stderr, stdout: () => stdout };
}

describe("nw model", () => {
  it("sets a credential only through hidden input and never prints it", async () => {
    const harness = fixture();
    await harness.program.parseAsync(["node", "nw", "model", "credential", "set", "qwen-cn"]);
    expect(harness.calls).toEqual([["set", "qwen-cn", sentinel]]);
    expect(`${harness.stdout()}${harness.stderr()}`).not.toContain(sentinel);
  });

  it("lists profiles and selects an exact profile/model pair", async () => {
    const list = fixture();
    await list.program.parseAsync(["node", "nw", "model", "list", "--json"]);
    expect(JSON.parse(list.stdout()).profiles).toHaveLength(2);

    const select = fixture();
    await select.program.parseAsync(["node", "nw", "model", "select", "minimax-cn", "MiniMax-M3"]);
    expect(select.calls).toEqual([["select", { profileId: "minimax-cn", modelId: "MiniMax-M3" }]]);
  });

  it("warns about quota and requires confirmation before a probe", async () => {
    const harness = fixture();
    await harness.program.parseAsync(["node", "nw", "model", "test", "minimax-cn", "--yes"]);
    expect(harness.calls).toEqual([["probe", "minimax-cn"]]);
    expect(harness.stderr()).toMatch(/quota/iu);
  });

  it("does not probe when interactive confirmation is declined", async () => {
    const confirm = vi.fn(async () => false);
    const command = new Command().exitOverride();
    registerModelCommand(command, {
      connect: async () => ({ client: {} as ModelCommandClient }),
      readSecret: async () => sentinel,
      confirm,
      stdout: () => {},
      stderr: () => {},
    });
    await command.parseAsync(["node", "nw", "model", "test", "qwen-cn"]);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
