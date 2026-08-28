import { z } from "zod";

export const runtimeStatusSchema = z.enum(["ready", "degraded", "stopping"]);

export const runtimeHealthSchema = z.object({
  protocolVersion: z.literal(1),
  service: z.literal("noneedwork-runtime"),
  status: runtimeStatusSchema,
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  engine: z.object({
    name: z.literal("pi"),
    version: z.string().min(1),
    safeMode: z.literal(true),
  }),
});

export const runtimeHandshakeSchema = z.object({
  protocolVersion: z.literal(1),
  kind: z.literal("noneedwork.runtime.ready"),
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65535),
  bearerToken: z.string().regex(/^[a-f0-9]{64}$/u),
  pid: z.number().int().positive(),
});

export const runtimeHandshakeResponseSchema = z.object({
  protocolVersion: z.literal(1),
  accepted: z.literal(true),
});

export type RuntimeHealth = z.infer<typeof runtimeHealthSchema>;
export type RuntimeHandshake = z.infer<typeof runtimeHandshakeSchema>;
export type RuntimeHandshakeResponse = z.infer<typeof runtimeHandshakeResponseSchema>;
