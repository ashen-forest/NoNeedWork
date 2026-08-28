import { z } from "zod";
import { taskIdSchema, taskRunIdSchema } from "./ids.js";
import { taskDetailsSchema } from "./tasks.js";

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
  "CHECKPOINT_CREATED",
  "OPERATION_INTENT",
  "OPERATION_FINISHED",
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

export const eventPageSchema = z.object({
  events: z.array(eventEnvelopeSchema),
  nextCursor: z.number().int().nonnegative(),
});

export const eventStreamFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    protocolVersion: z.literal(1),
    kind: z.literal("snapshot"),
    reason: z.enum(["initial", "cursor_expired"]),
    cursor: z.number().int().nonnegative(),
    snapshot: taskDetailsSchema,
  }),
  z.object({
    protocolVersion: z.literal(1),
    kind: z.literal("event"),
    event: eventEnvelopeSchema,
  }),
]);

export type EventType = z.infer<typeof eventTypeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type EventPage = z.infer<typeof eventPageSchema>;
export type EventStreamFrame = z.infer<typeof eventStreamFrameSchema>;
