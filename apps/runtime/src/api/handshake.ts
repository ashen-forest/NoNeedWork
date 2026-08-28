import { PROTOCOL_VERSION, runtimeHandshakeResponseSchema } from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";

export function registerHandshakeRoute(app: FastifyInstance): void {
  app.post("/v1/handshake", async () =>
    runtimeHandshakeResponseSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      accepted: true,
    }),
  );
}
