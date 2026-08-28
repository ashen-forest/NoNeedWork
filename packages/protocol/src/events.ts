import { z } from "zod";
import { taskIdSchema, taskRunIdSchema } from "./ids.js";

export const eventTypeSchema = z.enum([
  "TASK_STATE_CHANGED",
  "PLAN_UPDATED",
  "AGENT_MESSAGE_DELTA",
  "TOOL_STARTED",
  "TOOL_COMPLETED",
  "APPROVAL_REQUESTED",
  "APPROVAL_RESOLVED",
  "WORKER_STARTED",
  "WORKER_COMPLETED",
  "ARTIFACT_CREATED",
  "DIAGNOSTIC",
]);

export const eventEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  cursor: z.number().int().nonnegative(),
  taskId: taskIdSchema,
  runId: taskRunIdSchema,
  type: eventTypeSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});

export type EventType = z.infer<typeof eventTypeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
