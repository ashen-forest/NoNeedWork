import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RuntimeClient } from "@noneedwork/client-sdk";
import {
  artifactListSchema,
  eventPageSchema,
  projectSchema,
  type TaskDetails,
  type TaskRun,
  taskDetailsSchema,
} from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildRuntimeApp } from "../src/app.js";
import { createRuntimeConfig } from "../src/config.js";
import type { ProposedPlan } from "../src/modules/planning/plan-schema.js";
import type {
  StepExecutionResult,
  TaskDriver,
  TaskToolbox,
} from "../src/modules/tasks/task-orchestrator.js";
import {
  createRuntimeServices,
  type RuntimeServiceOverrides,
  type RuntimeServices,
} from "../src/services.js";
import { LocalWorkspaceSandbox } from "./helpers/local-workspace-sandbox.js";

const execFileAsync = promisify(execFile);

interface TestRuntime {
  app: FastifyInstance;
  services: RuntimeServices;
  directory: string;
  headers: Record<string, string>;
}

const runtimes: TestRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.app.close();
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

describe("Phase 2 Local API", () => {
  it("opens a project and creates a durable task", async () => {
    // GIVEN: An authenticated Runtime and a local repository directory
    const runtime = await createTestRuntime();
    const repository = join(runtime.directory, "repository");
    await mkdir(repository);
    await writeFile(join(repository, "README.md"), "fixture\n");

    // WHEN: Opening the repository and creating a task through the Local API
    const projectResponse = await runtime.app.inject({
      method: "POST",
      url: "/v1/projects/open",
      headers: runtime.headers,
      payload: { path: repository },
    });
    const project = projectSchema.parse(projectResponse.json());
    const taskResponse = await runtime.app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: runtime.headers,
      payload: { projectId: project.id, objective: "Update the fixture" },
    });
    const details = taskDetailsSchema.parse(taskResponse.json());

    // THEN: The API and SQLite ledger expose the same created TaskRun
    expect(projectResponse.statusCode).toBe(201);
    expect(taskResponse.statusCode).toBe(201);
    expect(details.task.status).toBe("CREATED");
    expect(runtime.services.tasks.details(details.task.id)).toEqual(details);
  });

  it("returns ordered events from an exclusive cursor", async () => {
    // GIVEN: A task with two persisted state events
    const runtime = await createTestRuntime();
    const details = await createTaskThroughApi(runtime);
    const run = requireRun(details);
    runtime.services.tasks.runs.transition(run, "PREPARING");

    // WHEN: Reading events after the creation cursor
    const response = await runtime.app.inject({
      method: "GET",
      url: `/v1/tasks/${details.task.id}/events?after=1`,
      headers: runtime.headers,
    });
    const page = eventPageSchema.parse(response.json());

    // THEN: Only the later monotonic event is returned
    expect(response.statusCode).toBe(200);
    expect(page.events.map((event) => [event.cursor, event.payload.to])).toEqual([
      [2, "PREPARING"],
    ]);
    expect(page.nextCursor).toBe(2);
  });

  it("streams a snapshot and cursor-ordered events over an authenticated WebSocket", async () => {
    // GIVEN: A listening Runtime, durable task, and typed Local API client
    const runtime = await createTestRuntime();
    const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const client = new RuntimeClient({ baseUrl: address, bearerToken: "test-token" });
    const repository = join(runtime.directory, "stream-repository");
    await mkdir(repository);
    const project = await client.openProject({ path: repository });
    const details = await client.createTask({ projectId: project.id, objective: "Stream events" });
    const frames: unknown[] = [];
    let resolveFrames!: (frames: unknown[]) => void;
    let rejectFrames!: (error: unknown) => void;
    const received = new Promise<unknown[]>((resolve, reject) => {
      resolveFrames = resolve;
      rejectFrames = reject;
    });

    // WHEN: Connecting from cursor zero through the typed event stream
    const subscription = client.streamEvents(
      details.task.id,
      {
        onFrame(frame) {
          frames.push(frame);
          if (frames.length === 2) resolveFrames(frames);
        },
        onError(error) {
          rejectFrames(error);
        },
      },
      0,
    );
    const streamed = await received;
    subscription.close();

    // THEN: The snapshot precedes the task-created event and preserves its cursor
    expect(streamed).toMatchObject([
      { protocolVersion: 1, kind: "snapshot", reason: "initial", cursor: 0 },
      { protocolVersion: 1, kind: "event", event: { cursor: 1, type: "TASK_STATE_CHANGED" } },
    ]);
  });

  it("replays the current snapshot when a WebSocket cursor has expired", async () => {
    // GIVEN: A task whose retained event range starts after the requested cursor
    const runtime = await createTestRuntime();
    const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const client = new RuntimeClient({ baseUrl: address, bearerToken: "test-token" });
    const repository = join(runtime.directory, "expired-cursor-repository");
    await mkdir(repository);
    const project = await client.openProject({ path: repository });
    const details = await client.createTask({ projectId: project.id, objective: "Replay state" });
    const run = requireRun(details);
    const preparing = runtime.services.tasks.runs.transition(run, "PREPARING");
    runtime.services.tasks.runs.transition(preparing, "PLANNING");
    runtime.services.database.connection
      .prepare("DELETE FROM run_events WHERE run_id = ? AND sequence <= 2")
      .run(run.id);

    // WHEN: Reconnecting from a cursor older than the retained event range
    let closeStream = () => undefined;
    const frame = await new Promise<unknown>((resolve, reject) => {
      const subscription = client.streamEvents(
        details.task.id,
        {
          onFrame(value) {
            resolve(value);
          },
          onError: reject,
        },
        1,
      );
      closeStream = () => subscription.close();
    });
    closeStream();

    // THEN: The stream sends a current snapshot at the latest retained cursor
    expect(frame).toMatchObject({
      protocolVersion: 1,
      kind: "snapshot",
      reason: "cursor_expired",
      cursor: 3,
      snapshot: { task: { status: "PLANNING" } },
    });
  });

  it("downloads an integrity-checked artifact", async () => {
    // GIVEN: A task with one content-addressed artifact
    const runtime = await createTestRuntime();
    const details = await createTaskThroughApi(runtime);
    const artifact = await runtime.services.artifactStore.put({
      taskRunId: requireRun(details).id,
      name: "changes.patch",
      mediaType: "text/x-diff",
      bytes: Buffer.from("fixture patch\n"),
      producer: "api-test",
    });

    // WHEN: Listing and downloading the artifact through authenticated endpoints
    const listResponse = await runtime.app.inject({
      method: "GET",
      url: `/v1/tasks/${details.task.id}/artifacts`,
      headers: runtime.headers,
    });
    const downloadResponse = await runtime.app.inject({
      method: "GET",
      url: `/v1/artifacts/${artifact.id}`,
      headers: runtime.headers,
    });

    // THEN: Metadata and bytes exactly match the committed artifact
    expect(artifactListSchema.parse(listResponse.json()).artifacts).toEqual([
      expect.objectContaining({ id: artifact.id, sha256: artifact.sha256 }),
    ]);
    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers["content-type"]).toContain("text/x-diff");
    expect(downloadResponse.rawPayload.toString("utf8")).toBe("fixture patch\n");
  });

  it("rejects malformed task input before persistence", async () => {
    // GIVEN: An authenticated Runtime
    const runtime = await createTestRuntime();

    // WHEN: Submitting a malformed task request
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: runtime.headers,
      payload: { projectId: "not-a-uuid", objective: "" },
    });

    // THEN: The boundary returns a versioned validation error and stores no task
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      protocolVersion: 1,
      error: { code: "VALIDATION_ERROR", retryable: false },
    });
    expect(runtime.services.tasks.list()).toEqual([]);
  });

  it("starts a deterministic task in the Runtime after API creation", async () => {
    // GIVEN: A committed fixture and an injected deterministic Runtime driver
    const sandbox = new LocalWorkspaceSandbox();
    const driver = new ApiFixtureDriver();
    const runtime = await createTestRuntime({
      dockerProvider: sandbox,
      taskDriverFactory: () => driver,
      autoStartTasks: true,
    });
    const repository = join(runtime.directory, "auto-start-repository");
    await mkdir(repository);
    await writeFile(join(repository, "README.md"), "fixture\n");
    await writeFile(
      join(repository, "test.mjs"),
      "import { readFileSync } from 'node:fs'; if (readFileSync('RESULT.md', 'utf8') !== 'done\\n') process.exit(1);\n",
    );
    await execFileAsync("git", ["init", "--quiet", repository]);
    await execFileAsync("git", ["-C", repository, "config", "user.email", "ci@noneedwork.dev"]);
    await execFileAsync("git", ["-C", repository, "config", "user.name", "NoNeedWork CI"]);
    await execFileAsync("git", ["-C", repository, "add", "."]);
    await execFileAsync("git", ["-C", repository, "commit", "--quiet", "-m", "fixture"]);

    // WHEN: Creating a task through the public API and joining the background runner
    const projectResponse = await runtime.app.inject({
      method: "POST",
      url: "/v1/projects/open",
      headers: runtime.headers,
      payload: { path: repository },
    });
    const project = projectSchema.parse(projectResponse.json());
    const taskResponse = await runtime.app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: runtime.headers,
      payload: { projectId: project.id, objective: "Create RESULT.md" },
    });
    const created = taskDetailsSchema.parse(taskResponse.json());
    const completed = await runtime.services.taskRunner.run(created.task.id);

    // THEN: Runtime, not the client, drives the task through verification and artifacts
    expect(taskResponse.statusCode).toBe(201);
    expect(completed.task.status).toBe("SUCCEEDED");
    expect(driver.executions).toBe(1);
    expect(
      runtime.services.tasks.artifacts.listByRun(requireRun(completed).id).map((item) => item.name),
    ).toContain("changes.patch");
    await sandbox.cleanup();
  });
});

class ApiFixtureDriver implements TaskDriver {
  executions = 0;

  async createPlan(): Promise<ProposedPlan> {
    return {
      schemaVersion: 1,
      objective: "Create RESULT.md",
      steps: [
        {
          key: "create-result",
          objective: "Create the verified result file",
          dependencies: [],
          acceptanceCriteria: ["RESULT.md contains done"],
          allowedPaths: ["RESULT.md"],
          verificationCommands: [["node", "test.mjs"]],
          requiresWrite: true,
        },
      ],
    };
  }

  async executeStep(input: { tools: TaskToolbox }): Promise<StepExecutionResult> {
    this.executions += 1;
    const result = await input.tools.call("write_file", {
      path: "RESULT.md",
      content: "done\n",
    });
    if (!result.ok) throw new Error(result.content);
    return { summary: "Created RESULT.md" };
  }
}

function requireRun(details: TaskDetails): TaskRun {
  if (!details.run) throw new Error(`Expected TaskRun for task ${details.task.id}`);
  return details.run;
}

async function createTestRuntime(overrides: RuntimeServiceOverrides = {}): Promise<TestRuntime> {
  const directory = await mkdtemp(join(tmpdir(), "noneedwork-api-"));
  const config = createRuntimeConfig({
    launchToken: "test-token",
    appDataDirectory: join(directory, "data"),
  });
  const services = createRuntimeServices(config, {
    databasePath: join(directory, "data", "noneedwork.db"),
    artifactRoot: join(directory, "artifacts"),
    autoStartTasks: false,
    ...overrides,
  });
  const runtime = {
    app: buildRuntimeApp(config, services),
    services,
    directory,
    headers: {
      authorization: "Bearer test-token",
      "x-noneedwork-protocol": "1",
    },
  };
  runtimes.push(runtime);
  return runtime;
}

async function createTaskThroughApi(runtime: TestRuntime) {
  const repository = join(runtime.directory, `repository-${Date.now()}`);
  await mkdir(repository);
  const projectResponse = await runtime.app.inject({
    method: "POST",
    url: "/v1/projects/open",
    headers: runtime.headers,
    payload: { path: repository },
  });
  const project = projectSchema.parse(projectResponse.json());
  const taskResponse = await runtime.app.inject({
    method: "POST",
    url: "/v1/tasks",
    headers: runtime.headers,
    payload: { projectId: project.id, objective: "Exercise API" },
  });
  return taskDetailsSchema.parse(taskResponse.json());
}
