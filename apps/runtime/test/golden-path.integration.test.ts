import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createFauxModelHarness } from "@noneedwork/pi-adapter";
import { createTaskRequestSchema } from "@noneedwork/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ArtifactStore } from "../src/modules/artifacts/artifact-store.js";
import type { ProposedPlan } from "../src/modules/planning/plan-schema.js";
import { PlanService } from "../src/modules/planning/plan-service.js";
import { StepVerifier } from "../src/modules/planning/step-verifier.js";
import { RuntimeDatabase } from "../src/modules/storage/database.js";
import { ProjectRepository } from "../src/modules/storage/repositories/project-repository.js";
import { SandboxRepository } from "../src/modules/storage/repositories/sandbox-repository.js";
import { TaskRepository } from "../src/modules/storage/repositories/task-repository.js";
import { ToolOperationRepository } from "../src/modules/storage/repositories/tool-operation-repository.js";
import { CheckpointService } from "../src/modules/tasks/checkpoint-service.js";
import { PiTaskDriver } from "../src/modules/tasks/pi-task-driver.js";
import { RunLease } from "../src/modules/tasks/run-lease.js";
import {
  type StepExecutionResult,
  type TaskDriver,
  TaskOrchestrator,
  type TaskToolbox,
} from "../src/modules/tasks/task-orchestrator.js";
import { ToolAudit } from "../src/modules/tools/tool-audit.js";
import { ToolGateway } from "../src/modules/tools/tool-gateway.js";
import { LocalWorkspaceSandbox } from "./helpers/local-workspace-sandbox.js";
import { createTestModelBinding } from "./helpers/model-binding.js";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const caseSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  fixture: z.string(),
  objective: z.string(),
  path: z.string(),
  oldText: z.string(),
  newText: z.string(),
  verificationCommand: z.array(z.string()).min(1),
});
type GoldenCase = z.infer<typeof caseSchema>;

const caseNames = ["golden-001", "golden-002", "golden-003", "golden-004", "golden-005"];
const directories: string[] = [];
const sandboxes: LocalWorkspaceSandbox[] = [];
const databases: RuntimeDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      // Already closed by the restart scenario.
    }
  }
  await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.cleanup()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class GoldenDriver implements TaskDriver {
  executions = 0;

  constructor(private readonly testCase: GoldenCase) {}

  async createPlan(): Promise<ProposedPlan> {
    return {
      schemaVersion: 1,
      objective: this.testCase.objective,
      steps: [
        {
          key: "fix",
          objective: this.testCase.objective,
          dependencies: [],
          acceptanceCriteria: ["The fixture verification command exits with code zero"],
          allowedPaths: [this.testCase.path],
          verificationCommands: [this.testCase.verificationCommand],
          requiresWrite: true,
        },
      ],
    };
  }

  async executeStep(input: { tools: TaskToolbox }): Promise<StepExecutionResult> {
    this.executions += 1;
    const result = this.testCase.oldText
      ? await input.tools.call("apply_edit", {
          path: this.testCase.path,
          oldText: this.testCase.oldText,
          newText: this.testCase.newText,
          expectedReplacements: 1,
        })
      : await input.tools.call("write_file", {
          path: this.testCase.path,
          content: this.testCase.newText,
        });
    if (!result.ok) throw new Error(result.content);
    return { summary: `Applied deterministic fix for ${this.testCase.id}` };
  }
}

describe("Phase 2 deterministic golden path", () => {
  for (const caseName of caseNames) {
    it(`completes ${caseName} and exports an applicable patch`, async () => {
      // GIVEN: A clean committed fixture, durable ledger, and deterministic driver
      const testCase = await loadCase(caseName);
      const environment = await createFixtureEnvironment(testCase);
      const database = openDatabase(environment.databasePath);
      const sandbox = new LocalWorkspaceSandbox();
      sandboxes.push(sandbox);
      const harness = createHarness(database, environment.artifactRoot, sandbox, caseName);
      const project = harness.projects.open(environment.repository, "a".repeat(64));
      const created = harness.tasks.create(
        createTaskRequestSchema.parse({ projectId: project.id, objective: testCase.objective }),
        {},
        createTestModelBinding(),
      );
      const driver = await createGoldenPiDriver(
        harness,
        created.task.id,
        environment.repository,
        environment.directory,
        testCase,
      );

      // WHEN: Running the complete isolated task workflow
      const completed = await harness.orchestrator.run(
        created.task.id,
        environment.repository,
        driver,
      );

      // THEN: The run succeeds and its patch applies to a fresh checkout
      expect(completed.task.status).toBe("SUCCEEDED");
      expect(completed.run?.status).toBe("SUCCEEDED");
      expect(
        database.connection
          .prepare("SELECT COUNT(*) AS count FROM tool_operations WHERE capability = ?")
          .get(testCase.oldText ? "apply_edit" : "write_file"),
      ).toEqual({ count: 1 });
      const artifactNames = harness.tasks.artifacts
        .listByRun(created.runId)
        .map((artifact) => artifact.name);
      expect(artifactNames).toEqual(
        expect.arrayContaining([
          "changes.patch",
          "test-results.json",
          "trace-summary.json",
          "unresolved-items.json",
        ]),
      );
      await verifyPatchOnFreshCheckout(harness, created.runId, environment, testCase);
      expect(await readFile(join(environment.repository, testCase.path), "utf8")).toContain(
        testCase.oldText,
      );
      driver.dispose();
      database.close();
    }, 30_000);
  }

  it("resumes after a stable checkpoint without repeating a write", async () => {
    // GIVEN: A run stopped after its only plan step reached a stable checkpoint
    const testCase = await loadCase("golden-001");
    const environment = await createFixtureEnvironment(testCase);
    const sandbox = new LocalWorkspaceSandbox();
    sandboxes.push(sandbox);
    const firstDatabase = openDatabase(environment.databasePath);
    const first = createHarness(firstDatabase, environment.artifactRoot, sandbox, "runtime-before");
    const project = first.projects.open(environment.repository, "e".repeat(64));
    const created = first.tasks.create(
      createTaskRequestSchema.parse({ projectId: project.id, objective: testCase.objective }),
      {},
      createTestModelBinding(),
    );
    const driver = await createGoldenPiDriver(
      first,
      created.task.id,
      environment.repository,
      environment.directory,
      testCase,
    );
    const createdDetails = requireTaskDetails(first.tasks, created.task.id);
    first.tasks.runs.transition(createdDetails.run, "PREPARING");
    await driver.preflight();
    await first.orchestrator.prepareRun(
      requireTaskDetails(first.tasks, created.task.id),
      environment.repository,
    );
    await first.orchestrator.planRun(requireTaskDetails(first.tasks, created.task.id), driver);
    await first.orchestrator.executeReadyStep(
      requireTaskDetails(first.tasks, created.task.id),
      driver,
    );
    const persistedSession = requireTaskDetails(first.tasks, created.task.id).run;
    expect(persistedSession.piSessionId).toBeTruthy();
    const sessionFile = persistedSession.piSessionFile;
    if (!sessionFile) throw new Error("Expected a persisted PI session file");
    await readFile(sessionFile, "utf8");
    await driver.dispose();
    firstDatabase.close();

    // WHEN: A new Runtime instance resumes the same durable TaskRun
    const resumedDatabase = openDatabase(environment.databasePath);
    const resumed = createHarness(
      resumedDatabase,
      environment.artifactRoot,
      sandbox,
      "runtime-after",
    );
    const resumeDriver = new GoldenDriver(testCase);
    const completed = await resumed.orchestrator.run(
      created.task.id,
      environment.repository,
      resumeDriver,
    );

    // THEN: Completion uses the checkpoint and no duplicate apply_edit is recorded
    expect(completed.task.status).toBe("SUCCEEDED");
    expect(resumeDriver.executions).toBe(0);
    const writes = resumedDatabase.connection
      .prepare("SELECT COUNT(*) AS count FROM tool_operations WHERE capability = 'apply_edit'")
      .get();
    expect(writes).toEqual({ count: 1 });
    resumedDatabase.close();
  }, 30_000);

  it("includes a newly created untracked file in the exported patch", async () => {
    // GIVEN: A clean fixture and a deterministic plan that creates a new file
    const testCase: GoldenCase = {
      schemaVersion: 1,
      id: "untracked-file",
      fixture: "golden-001",
      objective: "Create a release note in the isolated workspace.",
      path: "RELEASE_NOTE.md",
      oldText: "",
      newText: "Phase 2 patch export includes new files.\n",
      verificationCommand: ["node", "-e", "require('node:fs').accessSync('RELEASE_NOTE.md')"],
    };
    const environment = await createFixtureEnvironment(testCase);
    const database = openDatabase(environment.databasePath);
    const sandbox = new LocalWorkspaceSandbox();
    sandboxes.push(sandbox);
    const harness = createHarness(database, environment.artifactRoot, sandbox, "untracked-file");
    const project = harness.projects.open(environment.repository, "9".repeat(64));
    const created = harness.tasks.create(
      createTaskRequestSchema.parse({ projectId: project.id, objective: testCase.objective }),
      {},
      createTestModelBinding(),
    );

    // WHEN: The orchestrator writes and exports the workspace diff
    const driver = await createGoldenPiDriver(
      harness,
      created.task.id,
      environment.repository,
      environment.directory,
      testCase,
    );
    await harness.orchestrator.run(created.task.id, environment.repository, driver);

    // THEN: The patch applies to a fresh checkout and materializes the new file
    await verifyPatchOnFreshCheckout(harness, created.runId, environment, testCase);
    driver.dispose();
    database.close();
  }, 30_000);
});

function createHarness(
  database: RuntimeDatabase,
  artifactRoot: string,
  sandbox: LocalWorkspaceSandbox,
  leaseOwner: string,
) {
  const projects = new ProjectRepository(database);
  const tasks = new TaskRepository(database);
  const sandboxesRepository = new SandboxRepository(database);
  const artifactStore = new ArtifactStore(artifactRoot, tasks.artifacts);
  const checkpoints = new CheckpointService(tasks.runs);
  const operations = new ToolOperationRepository(database);
  const gateway = new ToolGateway(sandbox, new ToolAudit(operations, artifactStore, checkpoints));
  return {
    projects,
    tasks,
    sandboxes: sandboxesRepository,
    artifactStore,
    gateway,
    orchestrator: new TaskOrchestrator(
      tasks,
      sandboxesRepository,
      sandbox,
      new PlanService(tasks.steps),
      new StepVerifier(tasks.steps),
      artifactStore,
      gateway,
      operations,
      checkpoints,
      new RunLease(tasks.runs, leaseOwner, 30_000),
    ),
  };
}

async function createGoldenPiDriver(
  harness: ReturnType<typeof createHarness>,
  taskId: string,
  projectRoot: string,
  agentRoot: string,
  testCase: GoldenCase,
): Promise<PiTaskDriver> {
  const plan: ProposedPlan = {
    schemaVersion: 1,
    objective: testCase.objective,
    steps: [
      {
        key: "fix",
        objective: testCase.objective,
        dependencies: [],
        acceptanceCriteria: ["The fixture verification command exits with code zero"],
        allowedPaths: [testCase.path],
        verificationCommands: [testCase.verificationCommand],
        requiresWrite: true,
      },
    ],
  };
  const toolCall = testCase.oldText
    ? {
        name: "apply_edit",
        args: {
          path: testCase.path,
          oldText: testCase.oldText,
          newText: testCase.newText,
          expectedReplacements: 1,
        },
      }
    : {
        name: "write_file",
        args: { path: testCase.path, content: testCase.newText },
      };
  const faux = await createFauxModelHarness([
    { text: JSON.stringify(plan) },
    { toolCall },
    { text: `Applied deterministic PI fix for ${testCase.id}` },
  ]);
  const binding = harness.tasks.details(taskId)?.model;
  if (!binding) throw new Error(`Task ${taskId} has no model binding`);
  return new PiTaskDriver({
    taskId,
    projectRoot,
    agentDirectory: join(agentRoot, "pi-agent"),
    tasks: harness.tasks,
    sandboxes: harness.sandboxes,
    tools: harness.gateway,
    binding,
    prepareModelHandle: async () => faux.modelHandle,
  });
}

async function loadCase(name: string): Promise<GoldenCase> {
  return caseSchema.parse(
    JSON.parse(await readFile(join(root, "benchmarks", "cases", `${name}.json`), "utf8")),
  );
}

function openDatabase(path: string): RuntimeDatabase {
  const database = new RuntimeDatabase(path);
  databases.push(database);
  return database;
}

function requireTaskDetails(tasks: TaskRepository, taskId: string) {
  const details = tasks.details(taskId);
  if (!details?.run) throw new Error(`Expected TaskRun for task ${taskId}`);
  return { ...details, run: details.run };
}

async function createFixtureEnvironment(testCase: GoldenCase) {
  const directory = await mkdtemp(join(tmpdir(), `noneedwork-${testCase.id}-`));
  directories.push(directory);
  const repository = join(directory, "repository");
  await cp(join(root, "benchmarks", "fixtures", testCase.fixture), repository, {
    recursive: true,
  });
  await execFileAsync("git", ["init", "--quiet", repository]);
  await execFileAsync("git", ["-C", repository, "config", "user.email", "ci@noneedwork.dev"]);
  await execFileAsync("git", ["-C", repository, "config", "user.name", "NoNeedWork CI"]);
  await execFileAsync("git", ["-C", repository, "add", "."]);
  await execFileAsync("git", ["-C", repository, "commit", "--quiet", "-m", "fixture"]);
  return {
    directory,
    repository,
    databasePath: join(directory, "data", "noneedwork.db"),
    artifactRoot: join(directory, "artifacts"),
  };
}

async function verifyPatchOnFreshCheckout(
  harness: ReturnType<typeof createHarness>,
  runId: string,
  environment: Awaited<ReturnType<typeof createFixtureEnvironment>>,
  testCase: GoldenCase,
): Promise<void> {
  const patchArtifact = harness.tasks.artifacts
    .listByRun(runId)
    .find((artifact) => artifact.name === "changes.patch");
  if (!patchArtifact) throw new Error("Expected changes.patch artifact");
  const { bytes } = await harness.artifactStore.read(patchArtifact.id);
  const patchPath = join(environment.directory, "changes.patch");
  const checkout = join(environment.directory, "fresh-checkout");
  await writeFile(patchPath, bytes);
  await execFileAsync("git", ["clone", "--quiet", environment.repository, checkout]);
  await execFileAsync("git", ["-C", checkout, "apply", "--whitespace=nowarn", patchPath]);
  const [command, ...args] = testCase.verificationCommand;
  if (!command) throw new Error(`Golden case ${testCase.id} has no verification command`);
  await execFileAsync(command, args, { cwd: checkout });
  const materialized = (await readFile(join(checkout, testCase.path), "utf8")).replace(
    /\r\n/gu,
    "\n",
  );
  expect(materialized).toContain(testCase.newText);
}
