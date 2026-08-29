import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFauxModelHarness } from "@noneedwork/pi-adapter";
import type { ModelSelection } from "@noneedwork/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { buildRuntimeApp } from "../src/app.js";
import { createRuntimeConfig } from "../src/config.js";
import { FakeCredentialVault } from "../src/modules/credentials/fake-credential-vault.js";
import type { RuntimeModelAdapter } from "../src/modules/models/model-service.js";
import { DockerProvider } from "../src/modules/sandbox/docker-provider.js";
import { createRuntimeServices } from "../src/services.js";
import { LocalWorkspaceSandbox } from "./helpers/local-workspace-sandbox.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("provider credential isolation", () => {
  it("keeps a task credential out of durable, session, API, artifact, and sandbox surfaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "noneedwork-provider-isolation-"));
    directories.push(root);
    const appDataDirectory = join(root, "data");
    const repository = join(root, "repository");
    await mkdir(repository);
    await writeFile(join(repository, "README.md"), "credential isolation fixture\n");
    const sentinel = `noneedwork-${randomBytes(24).toString("hex")}`;
    const vault = new FakeCredentialVault();
    vault.set("qwen-cn", sentinel);
    const faux = await createFauxModelHarness([{ error: "HTTP 429" }]);
    const observedCredentials: string[] = [];
    const adapter = createAdapter(async ({ credential }) => {
      observedCredentials.push(credential);
      return faux.modelHandle;
    });
    const sandbox = new LocalWorkspaceSandbox();
    const config = createRuntimeConfig({ launchToken: "i".repeat(64), appDataDirectory });
    const services = createRuntimeServices(config, {
      credentialVault: vault,
      modelAdapter: adapter,
      dockerProvider: sandbox,
      autoStartTasks: false,
    });
    const app = buildRuntimeApp(config, services);

    try {
      const project = await services.projectService.open(repository);
      const created = services.taskService.create({
        projectId: project.id,
        objective: "Pause safely after a model error",
      });
      const paused = await services.taskRunner.run(created.task.id);
      expect(paused.run).toMatchObject({
        status: "PAUSED",
        checkpoint: {
          boundary: "MODEL_BLOCKED",
          modelBlock: { reason: "MODEL_RATE_LIMITED" },
        },
      });
      expect(observedCredentials).toEqual([sentinel]);

      const responses = await Promise.all([
        app.inject({
          method: "GET",
          url: "/v1/models/credentials",
          headers: authenticatedHeaders(),
        }),
        app.inject({
          method: "GET",
          url: `/v1/tasks/${created.task.id}`,
          headers: authenticatedHeaders(),
        }),
        app.inject({
          method: "GET",
          url: `/v1/tasks/${created.task.id}/events`,
          headers: authenticatedHeaders(),
        }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
      expect(responses.map((response) => response.body).join("\n")).not.toContain(sentinel);

      const run = paused.run;
      if (!run) throw new Error("Expected paused TaskRun");
      expect(JSON.stringify(services.tasks.runs.events.list(run.id, 0, 1_000))).not.toContain(
        sentinel,
      );
      expect(JSON.stringify(services.tasks.artifacts.listByRun(run.id))).not.toContain(sentinel);
      expect(JSON.stringify(vault.operations())).not.toContain(sentinel);
      expect(JSON.stringify(sandbox.directories)).not.toContain(sentinel);
      expect(await scanDirectory(appDataDirectory, sentinel)).toEqual([]);

      await app.close();
      const restarted = createRuntimeServices(config, {
        credentialVault: vault,
        modelAdapter: adapter,
        dockerProvider: sandbox,
        autoStartTasks: false,
      });
      try {
        expect(restarted.tasks.details(created.task.id)?.run?.status).toBe("PAUSED");
        expect(JSON.stringify(restarted.recoveryDecisions)).not.toContain(sentinel);
        expect(await scanDirectory(appDataDirectory, sentinel)).toEqual([]);
      } finally {
        restarted.database.close();
      }
    } finally {
      await app.close().catch(() => undefined);
      await sandbox.cleanup();
    }
  });
});

const dockerDescribe = process.env.NONEEDWORK_DOCKER_TESTS === "1" ? describe : describe.skip;

dockerDescribe("provider credential Docker isolation", () => {
  it("does not place provider identities or values in Docker configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "noneedwork-provider-docker-"));
    directories.push(root);
    await writeFile(join(root, "README.md"), "docker credential fixture\n");
    const sentinel = `noneedwork-${randomBytes(24).toString("hex")}`;
    const provider = new DockerProvider();
    const sandboxId = await provider.createWorkspace(root);
    try {
      const inspection = await provider.inspectSandbox(sandboxId);
      const serialized = JSON.stringify(inspection);
      expect(serialized).not.toContain(sentinel);
      expect(serialized).not.toContain("QWEN_TOKEN_PLAN_CN_API_KEY");
      expect(serialized).not.toContain("MINIMAX_CN_API_KEY");
      expect(inspection.HostConfig.NetworkMode).toBe("none");
      expect(inspection.HostConfig.Binds ?? []).toEqual([]);
    } finally {
      await provider.removeSandbox(sandboxId).catch(() => undefined);
    }
  }, 60_000);
});

function createAdapter(createHandle: RuntimeModelAdapter["createHandle"]): RuntimeModelAdapter {
  return {
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
    createHandle,
    probe: async ({ handle }) => ({
      profileId: handle.identity.profileId,
      modelId: handle.identity.modelId,
      success: true,
      latencyMs: 1,
      checks: { text: true, toolCall: true },
    }),
  };
}

function authenticatedHeaders() {
  return {
    authorization: `Bearer ${"i".repeat(64)}`,
    "x-noneedwork-protocol": "1",
  };
}

async function scanDirectory(root: string, needle: string): Promise<string[]> {
  const matches: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && (await readFile(path)).includes(Buffer.from(needle)))
        matches.push(path);
    }
  }
  await visit(root);
  return matches;
}
