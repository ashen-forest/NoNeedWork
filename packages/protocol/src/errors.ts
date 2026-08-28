import { z } from "zod";

export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "DEPENDENCY_UNAVAILABLE",
  "BUDGET_EXHAUSTED",
  "UNKNOWN_OUTCOME",
  "INTERNAL_ERROR",
]);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
    traceId: z.string().min(1).optional(),
  }),
  protocolVersion: z.literal(1),
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
