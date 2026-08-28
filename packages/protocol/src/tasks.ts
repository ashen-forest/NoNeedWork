import { z } from "zod";
import { projectIdSchema, taskIdSchema, taskRunIdSchema } from "./ids.js";

export const taskStatusSchema = z.enum([
  "CREATED",
  "PREPARING",
  "PLANNING",
  "AWAITING_APPROVAL",
  "EXECUTING",
  "VERIFYING",
  "REPLANNING",
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

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskBudget = z.infer<typeof taskBudgetSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
