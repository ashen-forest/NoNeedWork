import { describe, expect, it, vi } from "vitest";

import type { SandboxExecutor } from "../sandbox/docker-provider.js";
import { ToolGateway } from "./tool-gateway.js";

describe("ToolGateway", () => {
  it("validates and maps reads before dispatching to the sandbox", async () => {
    const execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: "hello",
      stderr: "",
      timedOut: false,
    }));
    const gateway = new ToolGateway({ execute } satisfies SandboxExecutor);

    await expect(
      gateway.dispatch("read_file", { path: "README.md" }, { sandboxId: "sandbox-1" }),
    ).resolves.toMatchObject({ ok: true, content: "hello" });
    expect(execute).toHaveBeenCalledWith(
      "sandbox-1",
      ["head", "-c", "262145", "--", "/workspace/README.md"],
      10_000,
    );
  });

  it("rejects traversal without calling the sandbox", async () => {
    const execute = vi.fn();
    const gateway = new ToolGateway({ execute } satisfies SandboxExecutor);

    await expect(
      gateway.dispatch("read_file", { path: "../outside" }, { sandboxId: "sandbox-1" }),
    ).rejects.toThrow(/inside the sandbox workspace/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects unknown tools", async () => {
    const gateway = new ToolGateway({ execute: vi.fn() } satisfies SandboxExecutor);
    await expect(gateway.dispatch("bash", {}, { sandboxId: "sandbox-1" })).rejects.toThrow(
      /Unknown tool/u,
    );
    expect(gateway.toolNames).toEqual(["read_file", "list_files", "search_text"]);
  });
});
