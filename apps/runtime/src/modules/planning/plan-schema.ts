import { z } from "zod";

const relativePatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.startsWith("/") &&
      !/^[a-zA-Z]:/u.test(value) &&
      !value.split("/").includes(".."),
    "Allowed paths must be relative workspace patterns",
  );

export const proposedPlanStepSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
  objective: z.string().trim().min(1).max(10_000),
  dependencies: z
    .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u))
    .max(40)
    .default([]),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(20),
  allowedPaths: z.array(relativePatternSchema).min(1).max(100),
  verificationCommands: z
    .array(z.array(z.string().min(1).max(4096)).min(1).max(50))
    .min(1)
    .max(20),
  requiresWrite: z.boolean(),
});

export const proposedPlanSchema = z.object({
  schemaVersion: z.literal(1),
  objective: z.string().trim().min(1).max(20_000),
  steps: z.array(proposedPlanStepSchema).min(1).max(40),
});

export type ProposedPlan = z.infer<typeof proposedPlanSchema>;
export type ProposedPlanStep = z.infer<typeof proposedPlanStepSchema>;
