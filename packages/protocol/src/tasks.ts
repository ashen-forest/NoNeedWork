import { z } from "zod";
import {
  artifactIdSchema,
  projectIdSchema,
  stepIdSchema,
  taskIdSchema,
  taskRunIdSchema,
} from "./ids.js";

export const taskStatusSchema = z.enum([
  "CREATED",
  "PREPARING",
  "PLANNING",
  "AWAITING_APPROVAL",
  "EXECUTING",
  "VERIFYING",
  "REPLANNING",
  "PAUSED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export const taskBudgetSchema = z.object({
  maxTurns: z.number().int().positive().max(200).default(40),
  maxWriteOperations: z.number().int().nonnegative().max(100).default(20),
  maxReplans: z.number().int().nonnegative().max(10).default(2),
  maxConcurrentWorkers: z.number().int().min(1).max(3).default(3),
  wallClockMs: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60 * 1000)
    .default(90 * 60 * 1000),
});

export const createTaskRequestSchema = z.object({
  projectId: projectIdSchema,
  objective: z.string().trim().min(1).max(20_000),
  budget: taskBudgetSchema.optional(),
});

export const planStepStatusSchema = z.enum([
  "PENDING",
  "READY",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
]);

export const planStepSchema = z.object({
  id: stepIdSchema,
  taskRunId: taskRunIdSchema,
  position: z.number().int().nonnegative(),
  objective: z.string().trim().min(1),
  dependencies: z.array(stepIdSchema),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  allowedPaths: z.array(z.string().trim().min(1)).min(1),
  verificationCommands: z.array(z.array(z.string().min(1)).min(1)),
  requiresWrite: z.boolean(),
  status: planStepStatusSchema,
  stateVersion: z.number().int().nonnegative(),
  resultArtifactId: artifactIdSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const taskRunSchema = z.object({
  id: taskRunIdSchema,
  taskId: taskIdSchema,
  status: taskStatusSchema,
  stateVersion: z.number().int().nonnegative(),
  replanCount: z.number().int().nonnegative(),
  leaseOwner: z.string().nullable(),
  leaseExpiresAt: z.iso.datetime({ offset: true }).nullable(),
  checkpoint: z.record(z.string(), z.unknown()).nullable(),
  piSessionId: z.string().nullable(),
  piSessionFile: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const taskSnapshotSchema = z.object({
  id: taskIdSchema,
  projectId: projectIdSchema,
  currentRunId: taskRunIdSchema.nullable(),
  objective: z.string(),
  status: taskStatusSchema,
  stateVersion: z.number().int().nonnegative(),
  budget: taskBudgetSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const taskDetailsSchema = z.object({
  task: taskSnapshotSchema,
  run: taskRunSchema.nullable(),
  planSteps: z.array(planStepSchema),
  artifactIds: z.array(artifactIdSchema),
});

export const taskControlActionSchema = z.enum(["pause", "resume", "cancel"]);
export const taskControlRequestSchema = z.object({ action: taskControlActionSchema });

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type PlanStepStatus = z.infer<typeof planStepStatusSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;
export type TaskRun = z.infer<typeof taskRunSchema>;
export type TaskBudget = z.infer<typeof taskBudgetSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
export type TaskDetails = z.infer<typeof taskDetailsSchema>;
export type TaskControlAction = z.infer<typeof taskControlActionSchema>;
