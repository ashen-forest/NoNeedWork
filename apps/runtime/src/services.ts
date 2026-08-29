import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { RuntimeConfig } from "./config.js";
import { ArtifactStore } from "./modules/artifacts/artifact-store.js";
import type { CredentialVault } from "./modules/credentials/credential-vault.js";
import { KeyringCredentialVault } from "./modules/credentials/keyring.js";
import { ModelPreferenceRepository } from "./modules/models/model-preference-repository.js";
import { ModelService, type RuntimeModelAdapter } from "./modules/models/model-service.js";
import { PlanService } from "./modules/planning/plan-service.js";
import { StepVerifier } from "./modules/planning/step-verifier.js";
import { ProjectService } from "./modules/projects/project-service.js";
import { DockerProvider } from "./modules/sandbox/docker-provider.js";
import { RuntimeDatabase } from "./modules/storage/database.js";
import { ProjectRepository } from "./modules/storage/repositories/project-repository.js";
import { SandboxRepository } from "./modules/storage/repositories/sandbox-repository.js";
import { TaskRepository } from "./modules/storage/repositories/task-repository.js";
import { ToolOperationRepository } from "./modules/storage/repositories/tool-operation-repository.js";
import { CheckpointService } from "./modules/tasks/checkpoint-service.js";
import { PiTaskDriver } from "./modules/tasks/pi-task-driver.js";
import { type RecoveryDecision, RecoveryService } from "./modules/tasks/recovery-service.js";
import { RunLease } from "./modules/tasks/run-lease.js";
import {
  TaskOrchestrator,
  type WorkspaceSandboxProvider,
} from "./modules/tasks/task-orchestrator.js";
import { type TaskDriverFactory, TaskRunner } from "./modules/tasks/task-runner.js";
import { TaskService } from "./modules/tasks/task-service.js";
import { ToolAudit } from "./modules/tools/tool-audit.js";
import { ToolGateway } from "./modules/tools/tool-gateway.js";

export interface RuntimeServices {
  database: RuntimeDatabase;
  projects: ProjectRepository;
  tasks: TaskRepository;
  sandboxes: SandboxRepository;
  projectService: ProjectService;
  taskService: TaskService;
  credentialVault: CredentialVault;
  modelService: ModelService;
  artifactStore: ArtifactStore;
  orchestrator: TaskOrchestrator;
  toolGateway: ToolGateway;
  taskRunner: TaskRunner;
  autoStartTasks: boolean;
  recoveryDecisions: readonly RecoveryDecision[];
}

export interface RuntimeServiceOverrides {
  databasePath?: string;
  artifactRoot?: string;
  dockerProvider?: WorkspaceSandboxProvider;
  taskDriverFactory?: TaskDriverFactory;
  credentialVault?: CredentialVault;
  modelAdapter?: RuntimeModelAdapter;
  autoStartTasks?: boolean;
}

export function createRuntimeServices(
  config: RuntimeConfig,
  overrides: RuntimeServiceOverrides = {},
): RuntimeServices {
  const database = new RuntimeDatabase(
    overrides.databasePath ?? join(config.appDataDirectory, "noneedwork.db"),
  );
  const projects = new ProjectRepository(database);
  const tasks = new TaskRepository(database);
  const credentialVault = overrides.credentialVault ?? new KeyringCredentialVault();
  const modelService = new ModelService({
    preferences: new ModelPreferenceRepository(database),
    bindings: tasks.models,
    credentials: credentialVault,
    ...(overrides.modelAdapter ? { adapter: overrides.modelAdapter } : {}),
  });
  const operations = new ToolOperationRepository(database);
  const sandboxes = new SandboxRepository(database);
  const artifactStore = new ArtifactStore(
    overrides.artifactRoot ?? join(config.appDataDirectory, "artifacts"),
    tasks.artifacts,
  );
  const checkpoints = new CheckpointService(tasks.runs);
  const dockerProvider = overrides.dockerProvider ?? new DockerProvider();
  const toolGateway = new ToolGateway(
    dockerProvider,
    new ToolAudit(operations, artifactStore, checkpoints),
  );
  const recoveryDecisions = new RecoveryService(
    tasks.runs,
    operations,
    () => new Date(),
    tasks.models,
  ).scan();
  const orchestrator = new TaskOrchestrator(
    tasks,
    sandboxes,
    dockerProvider,
    new PlanService(tasks.steps),
    new StepVerifier(tasks.steps),
    artifactStore,
    toolGateway,
    operations,
    checkpoints,
    new RunLease(tasks.runs, `runtime-${process.pid}-${randomUUID()}`),
  );
  const createDriver: TaskDriverFactory =
    overrides.taskDriverFactory ??
    (({ taskId, projectRoot }) => {
      const binding = tasks.details(taskId)?.model ?? null;
      return new PiTaskDriver({
        taskId,
        projectRoot,
        agentDirectory: join(config.appDataDirectory, "pi"),
        tasks,
        sandboxes,
        tools: toolGateway,
        binding,
        prepareModelHandle: async () => {
          if (!binding) {
            throw new Error(`Task ${taskId} has no model binding`);
          }
          return modelService.createHandle(binding);
        },
      });
    });
  const taskRunner = new TaskRunner(projects, tasks, orchestrator, createDriver);
  return {
    database,
    projects,
    tasks,
    sandboxes,
    projectService: new ProjectService(projects),
    taskService: new TaskService(projects, tasks, modelService),
    credentialVault,
    modelService,
    artifactStore,
    orchestrator,
    toolGateway,
    taskRunner,
    autoStartTasks: overrides.autoStartTasks ?? true,
    recoveryDecisions,
  };
}
