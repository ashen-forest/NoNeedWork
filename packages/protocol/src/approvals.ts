import { z } from "zod";
import { approvalIdSchema, stepIdSchema, taskIdSchema } from "./ids.js";

export const approvalStatusSchema = z.enum(["PENDING", "APPROVED", "DENIED", "EXPIRED"]);

export const approvalRequestSchema = z.object({
  id: approvalIdSchema,
  taskId: taskIdSchema,
  stepId: stepIdSchema,
  capability: z.string().min(1),
  canonicalResource: z.string().min(1),
  paramsHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(1),
  status: approvalStatusSchema,
  expiresAt: z.iso.datetime({ offset: true }),
});

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
