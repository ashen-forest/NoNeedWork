import { type ZodType, z } from "zod";

const persistedEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  value: z.unknown(),
});

export function encodePersistedJson(value: unknown): string {
  return JSON.stringify({ schemaVersion: 1, value });
}

export function decodePersistedJson<T>(text: string, schema: ZodType<T>): T {
  const envelope = persistedEnvelopeSchema.parse(JSON.parse(text));
  return schema.parse(envelope.value);
}
