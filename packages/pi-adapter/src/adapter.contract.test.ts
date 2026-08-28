import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxProvider, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { defineTool, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createNoNeedWorkSession } from "./create-session.js";
import type { NoNeedWorkPiEvent } from "./types.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("PI adapter contract", () => {
  it("runs a custom read tool through a real PI session without dangerous built-ins", async () => {
    const directory = await mkdtemp(join(tmpdir(), "noneedwork-pi-"));
    tempDirectories.push(directory);

    const faux = fauxProvider({ provider: "noneedwork-faux", api: "noneedwork-faux" });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("workspace_read", { path: "README.md" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("The workspace was read safely."),
    ]);

    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    let executions = 0;
    const readTool = defineTool({
      name: "workspace_read",
      label: "Workspace Read",
      description: "Read one file from the isolated workspace",
      parameters: Type.Object({ path: Type.String() }),
      async execute(_toolCallId, params) {
        executions += 1;
        return {
          content: [{ type: "text" as const, text: `fixture:${params.path}` }],
          details: { path: params.path },
        };
      },
    });

    const session = await createNoNeedWorkSession({
      cwd: directory,
      agentDir: join(directory, ".agent"),
      systemPrompt: "Use only the explicitly supplied workspace tools.",
      customTools: [readTool],
      model: faux.getModel(),
      modelRuntime,
      sessionManager: SessionManager.inMemory(directory),
    });
    const events: NoNeedWorkPiEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    try {
      expect(session.activeToolNames).toEqual(["workspace_read"]);
      expect(session.activeToolNames).not.toContain("bash");
      expect(session.activeToolNames).not.toContain("powershell");
      expect(session.activeToolNames).not.toContain("edit");
      expect(session.activeToolNames).not.toContain("write");

      await session.prompt("Read README.md");

      expect(executions).toBe(1);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "tool.started", toolName: "workspace_read" }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.finished",
          toolName: "workspace_read",
          isError: false,
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: "output.delta", delta: expect.any(String) }),
      );
    } finally {
      unsubscribe();
      session.dispose();
    }
  });

  it("loads no ambient extensions, skills, prompts, themes, or context files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "noneedwork-pi-resources-"));
    tempDirectories.push(directory);
    const { createBundledResourceLoader } = await import("./resource-loader.js");
    const loader = createBundledResourceLoader("closed prompt");

    await loader.reload();

    expect(loader.getExtensions().extensions).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getPrompts().prompts).toEqual([]);
    expect(loader.getThemes().themes).toEqual([]);
    expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
    expect(loader.getSystemPrompt()).toBe("closed prompt");
  });
});
