import { version as uuidVersion, v7 as uuidv7, validate as validateUuid } from "uuid";
import { z } from "zod";

const uuidV7Schema = z
  .string()
  .refine(
    (value) => validateUuid(value) && uuidVersion(value) === 7,
    "Expected a UUIDv7 identifier",
  );

export const projectIdSchema = uuidV7Schema.brand<"ProjectId">();
export const taskIdSchema = uuidV7Schema.brand<"TaskId">();
export const taskRunIdSchema = uuidV7Schema.brand<"TaskRunId">();
export const stepIdSchema = uuidV7Schema.brand<"StepId">();
export const approvalIdSchema = uuidV7Schema.brand<"ApprovalId">();
export const artifactIdSchema = uuidV7Schema.brand<"ArtifactId">();
export const workerRunIdSchema = uuidV7Schema.brand<"WorkerRunId">();
export const operationIdSchema = uuidV7Schema.brand<"OperationId">();

export type ProjectId = z.infer<typeof projectIdSchema>;
export type TaskId = z.infer<typeof taskIdSchema>;
export type TaskRunId = z.infer<typeof taskRunIdSchema>;
export type StepId = z.infer<typeof stepIdSchema>;
export type ApprovalId = z.infer<typeof approvalIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type WorkerRunId = z.infer<typeof workerRunIdSchema>;
export type OperationId = z.infer<typeof operationIdSchema>;

export const createProjectId = (): ProjectId => projectIdSchema.parse(uuidv7());
export const createTaskId = (): TaskId => taskIdSchema.parse(uuidv7());
export const createTaskRunId = (): TaskRunId => taskRunIdSchema.parse(uuidv7());
export const createStepId = (): StepId => stepIdSchema.parse(uuidv7());
export const createApprovalId = (): ApprovalId => approvalIdSchema.parse(uuidv7());
export const createArtifactId = (): ArtifactId => artifactIdSchema.parse(uuidv7());
export const createWorkerRunId = (): WorkerRunId => workerRunIdSchema.parse(uuidv7());
export const createOperationId = (): OperationId => operationIdSchema.parse(uuidv7());
