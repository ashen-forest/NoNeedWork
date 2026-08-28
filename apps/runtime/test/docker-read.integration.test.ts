import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { DockerProvider } from "../src/modules/sandbox/docker-provider.js";
import { ToolGateway } from "../src/modules/tools/tool-gateway.js";

const runDockerTests = process.env.NONEEDWORK_DOCKER_TESTS === "1";
const dockerTest = runDockerTests ? describe : describe.skip;
const directories: string[] = [];
const sandboxes: string[] = [];
const provider = new DockerProvider();

afterAll(async () => {
  await Promise.all(
    sandboxes.splice(0).map((id) => provider.removeSandbox(id).catch(() => undefined)),
  );
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

dockerTest("Docker read-only tool path", () => {
  it("copies a fixture and reads it without host bind mounts or networking", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "noneedwork-docker-fixture-"));
    directories.push(fixture);
    await mkdir(join(fixture, "src"));
    await writeFile(join(fixture, "README.md"), "NoNeedWork fixture\n", "utf8");
    await writeFile(join(fixture, "src", "index.ts"), "export const ready = true;\n", "utf8");

    const sandboxId = await provider.createWorkspace(fixture);
    sandboxes.push(sandboxId);
    const gateway = new ToolGateway(provider);

    await expect(
      gateway.dispatch("read_file", { path: "README.md" }, { sandboxId }),
    ).resolves.toMatchObject({ ok: true, content: "NoNeedWork fixture\n" });

    const inspection = await provider.inspectSandbox(sandboxId);
    expect(inspection.HostConfig.Binds ?? []).toEqual([]);
    expect(inspection.HostConfig.NetworkMode).toBe("none");
    expect(inspection.HostConfig.ReadonlyRootfs).toBe(true);
    expect(inspection.HostConfig.CapDrop).toContain("ALL");
    expect(inspection.Config.Env ?? []).toEqual([]);
  }, 60_000);
});
