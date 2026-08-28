import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createFauxModelHarness } from "@noneedwork/pi-adapter";
import { projectSchema, type TaskDetails, taskDetailsSchema } from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRuntimeApp } from "../../runtime/src/app.js";
import { createRuntimeConfig } from "../../runtime/src/config.js";
import { PiTaskDriver } from "../../runtime/src/modules/tasks/pi-task-driver.js";
import { publishRuntimeRegistry } from "../../runtime/src/runtime-registry.js";
import {
  createRuntimeServices,
  type RuntimeServiceOverrides,
  type RuntimeServices,
} from "../../runtime/src/services.js";
import { LocalWorkspaceSandbox } from "../../runtime/test/helpers/local-workspace-sandbox.js";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const cliEntry = join(root, "apps", "cli", "src", "main.ts");
const launchToken = "c".repeat(64);
const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Phase 2 CLI over the Local API", () => {
  it("starts a durable task through the Local API client boundary", async () => {
    // GIVEN: A discoverable authenticated Runtime and local repository
    const environment = await createCliRuntime();
    expect(environment.services.autoStartTasks).toBe(false);
    const repository = join(environment.directory, "repository");
    await mkdir(repository);

    // WHEN: Starting the task through the public nw command
    const started = await runCli(environment, [
      "task",
      "start",
      "--repo",
      repository,
      "Create",
      "a",
      "release",
      "note",
      "--json",
    ]);
    const details = taskDetailsSchema.parse(JSON.parse(started.stdout));
    if (!details.run) throw new Error("Expected created TaskRun");

    // THEN: Runtime owns the durable TaskRun and the CLI did not instantiate PI
    expect(details.task).toMatchObject({
      objective: "Create a release note",
      status: "CREATED",
    });
    expect(environment.services.tasks.details(details.task.id)?.run?.id).toBe(details.run.id);
  });

  it("watches ordered task events from the durable ledger", async () => {
    // GIVEN: A discoverable Runtime with one dormant task
    const environment = await createCliRuntime();
    const details = await createDormantTask(environment, "Watch the task ledger");

    // WHEN: Watching the current event page through the public nw command
    const watched = await runCli(environment, ["task", "watch", details.task.id, "--once"]);

    // THEN: The creation event is returned once with its monotonic cursor
    expect(
      watched.stdout
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line)),
    ).toEqual([expect.objectContaining({ cursor: 1, type: "TASK_STATE_CHANGED" })]);
  });

  it("opens a project through the public CLI", async () => {
    // GIVEN: A discoverable Runtime and local directory
    const environment = await createCliRuntime();
    const repository = join(environment.directory, "open-project");
    await mkdir(repository);

    // WHEN: Opening the directory through nw project open
    const result = await runCli(environment, ["project", "open", repository, "--json"]);

    // THEN: The canonical project is persisted by Runtime
    const project = projectSchema.parse(JSON.parse(result.stdout));
    expect(project.rootPath).toBe(await realpath(repository));
    expect(environment.services.projects.get(project.id)).toEqual(project);
  });

  it("lists projects already known to Runtime", async () => {
    // GIVEN: A Runtime with one project in its ledger
    const environment = await createCliRuntime();
    const details = await createDormantTask(environment, "List the project");

    // WHEN: Listing projects through the public nw command
    const result = await runCli(environment, ["project", "list", "--json"]);

    // THEN: The task's project is returned exactly once
    expect(JSON.parse(result.stdout).projects).toEqual([
      expect.objectContaining({ id: details.task.projectId }),
    ]);
  });

  it("downloads an artifact through the public CLI", async () => {
    // GIVEN: A durable task with one content-addressed artifact
    const environment = await createCliRuntime();
    const details = await createDormantTask(environment, "Download an artifact");
    if (!details.run) throw new Error("Expected created TaskRun");
    const artifact = await environment.services.artifactStore.put({
      taskRunId: details.run.id,
      name: "fixture.txt",
      mediaType: "text/plain",
      bytes: Buffer.from("artifact fixture\n"),
      producer: "cli-e2e",
    });
    const artifactPath = join(environment.directory, "downloads", "fixture.txt");

    // WHEN: Downloading the artifact through nw artifact get
    await runCli(environment, ["artifact", "get", artifact.id, "--output", artifactPath]);

    // THEN: The exact committed bytes are written to the requested path
    expect(await readFile(artifactPath, "utf8")).toBe("artifact fixture\n");
  });

  it("exports a redacted task trace through the public CLI", async () => {
    // GIVEN: A durable task with its creation event
    const environment = await createCliRuntime();
    const details = await createDormantTask(environment, "Export the trace");
    const tracePath = join(environment.directory, "exports", "trace.json");

    // WHEN: Exporting the trace through nw trace export
    await runCli(environment, ["trace", "export", details.task.id, "--output", tracePath]);

    // THEN: The export contains the versioned event ledger for only this task
    expect(JSON.parse(await readFile(tracePath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      taskId: details.task.id,
      events: [{ cursor: 1 }],
    });
  });

  it("cancels a dormant task through the public CLI", async () => {
    // GIVEN: A durable task that has not started execution
    const environment = await createCliRuntime();
    const details = await createDormantTask(environment, "Cancel the task");

    // WHEN: Cancelling through nw task cancel
    const cancelled = await runCli(environment, ["task", "cancel", details.task.id, "--json"]);

    // THEN: The CLI response and SQLite ledger agree on the terminal state
    expect(taskDetailsSchema.parse(JSON.parse(cancelled.stdout)).task.status).toBe("CANCELLED");
    expect(environment.services.tasks.details(details.task.id)?.task.status).toBe("CANCELLED");
  });

  it("completes a clean fixture through nw task start and watch using a faux PI model", async () => {
    // GIVEN: A clean Git fixture, isolated workspace provider, and deterministic PI model
    const sandbox = new LocalWorkspaceSandbox();
    const environment = await createCliRuntime({
      autoStartTasks: true,
      dockerProvider: sandbox,
    });
    const repository = join(environment.directory, "golden-cli-repository");
    await mkdir(repository);
    await writeFile(join(repository, "message.txt"), "before\n");
    await writeFile(
      join(repository, "test.mjs"),
      "import { readFileSync } from 'node:fs'; if (readFileSync('message.txt', 'utf8').trim() !== 'after') process.exit(1);\n",
    );
    await execFileAsync("git", ["init", "--quiet", repository]);
    await execFileAsync("git", ["-C", repository, "config", "user.email", "ci@noneedwork.dev"]);
    await execFileAsync("git", ["-C", repository, "config", "user.name", "NoNeedWork CI"]);
    await execFileAsync("git", ["-C", repository, "add", "."]);
    await execFileAsync("git", ["-C", repository, "commit", "--quiet", "-m", "fixture"]);
    const faux = await createFauxModelHarness([
      {
        text: JSON.stringify({
          schemaVersion: 1,
          objective: "Change message.txt from before to after",
          steps: [
            {
              key: "change-message",
              objective: "Change the fixture message",
              dependencies: [],
              acceptanceCriteria: ["node test.mjs exits successfully"],
              allowedPaths: ["message.txt"],
              verificationCommands: [["node", "test.mjs"]],
              requiresWrite: true,
            },
          ],
        }),
      },
      {
        toolCall: {
          name: "apply_edit",
          args: {
            path: "message.txt",
            oldText: "before",
            newText: "after",
            expectedReplacements: 1,
          },
        },
      },
      { text: "Changed and verified the isolated fixture." },
    ]);
    environment.services.taskRunner.configureDriverFactory(
      ({ taskId, projectRoot }) =>
        new PiTaskDriver({
          taskId,
          projectRoot,
          agentDirectory: join(environment.appDataDirectory, "pi-e2e"),
          tasks: environment.services.tasks,
          sandboxes: environment.services.sandboxes,
          tools: environment.services.toolGateway,
          model: faux.model,
          modelRuntime: faux.modelRuntime,
        }),
    );
    const startTask = vi.spyOn(environment.services.taskRunner, "start");

    // WHEN: Starting and watching the task exclusively through the CLI
    const started = await runCli(environment, [
      "task",
      "start",
      "--repo",
      repository,
      "Change",
      "message.txt",
      "from",
      "before",
      "to",
      "after",
      "--json",
    ]);
    const created = taskDetailsSchema.parse(JSON.parse(started.stdout));
    expect(environment.services.autoStartTasks).toBe(true);
    expect(startTask).toHaveBeenCalledWith(created.task.id);
    try {
      await runCli(environment, ["task", "watch", created.task.id, "--interval", "100"]);
    } catch (error) {
      const snapshot = environment.services.tasks.details(created.task.id);
      const events = snapshot?.run
        ? environment.services.tasks.runs.events.list(snapshot.run.id, 0, 500).events
        : [];
      throw new Error(
        `CLI watch failed with ledger ${JSON.stringify({ snapshot, events }, null, 2)}`,
        { cause: error },
      );
    }
    const completed = environment.services.tasks.details(created.task.id);

    // THEN: PI finishes in Runtime, produces release artifacts, and leaves the host fixture untouched
    if (!completed?.run) throw new Error("Expected completed TaskRun");
    if (completed.task.status !== "SUCCEEDED") {
      const events = environment.services.tasks.runs.events.list(completed.run.id, 0, 500).events;
      const operations = environment.services.database.connection
        .prepare(
          "SELECT capability, state FROM tool_operations WHERE run_id = ? ORDER BY created_at",
        )
        .all(completed.run.id);
      throw new Error(
        `Expected a successful CLI task, received ${completed.task.status}: ${JSON.stringify({ events, operations }, null, 2)}`,
      );
    }
    expect(completed?.task.status).toBe("SUCCEEDED");
    expect(completed.artifactIds.length).toBeGreaterThanOrEqual(4);
    expect(await readFile(join(repository, "message.txt"), "utf8")).toBe("before\n");
    expect(
      environment.services.tasks.artifacts
        .listByRun(completed.run.id)
        .map((artifact) => artifact.name),
    ).toEqual(
      expect.arrayContaining([
        "changes.patch",
        "test-results.json",
        "trace-summary.json",
        "unresolved-items.json",
      ]),
    );
    await sandbox.cleanup();
  }, 60_000);
});

async function createDormantTask(
  environment: { directory: string; services: RuntimeServices },
  objective: string,
): Promise<TaskDetails> {
  const repository = join(environment.directory, `repository-${objective.replaceAll(" ", "-")}`);
  await mkdir(repository);
  const project = await environment.services.projectService.open(repository);
  return environment.services.taskService.create({ projectId: project.id, objective });
}

async function createCliRuntime(overrides: RuntimeServiceOverrides = {}): Promise<{
  app: FastifyInstance;
  services: RuntimeServices;
  directory: string;
  localAppData: string;
  appDataDirectory: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "noneedwork-cli-e2e-"));
  directories.push(directory);
  const localAppData = join(directory, "local-app-data");
  const appDataDirectory = join(localAppData, "NoNeedWork");
  const config = createRuntimeConfig({
    launchToken,
    appDataDirectory,
  });
  const services = createRuntimeServices(config, { autoStartTasks: false, ...overrides });
  const app = buildRuntimeApp(config, services);
  apps.push(app);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const port = Number(new URL(address).port);
  await publishRuntimeRegistry(config.appDataDirectory, {
    protocolVersion: 1,
    kind: "noneedwork.runtime.ready",
    host: "127.0.0.1",
    port,
    bearerToken: launchToken,
    pid: process.pid,
  });
  return { app, services, directory, localAppData, appDataDirectory };
}

async function runCli(
  environment: { localAppData: string; appDataDirectory: string },
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd: root,
    windowsHide: true,
    timeout: 30_000,
    env: {
      ...process.env,
      LOCALAPPDATA: environment.localAppData,
      NONEEDWORK_APP_DATA_DIRECTORY: environment.appDataDirectory,
    },
  });
}
