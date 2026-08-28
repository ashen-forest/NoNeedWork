import { PI_SDK_VERSION } from "@noneedwork/pi-adapter";
import { PROTOCOL_VERSION, runtimeHealthSchema } from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";

export function registerHealthRoute(
  app: FastifyInstance,
  version: string,
  startedAt: number,
): void {
  app.get("/v1/health", async () =>
    runtimeHealthSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      service: "noneedwork-runtime",
      status: "ready",
      version,
      uptimeSeconds: Math.max(0, (Date.now() - startedAt) / 1000),
      engine: { name: "pi", version: PI_SDK_VERSION, safeMode: true },
    }),
  );
}
