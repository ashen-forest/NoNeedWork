import Fastify, { type FastifyInstance } from "fastify";

import { registerHandshakeRoute } from "./api/handshake.js";
import { registerHealthRoute } from "./api/health.js";
import type { RuntimeConfig } from "./config.js";
import { installLocalAuth } from "./security/local-auth.js";

export function buildRuntimeApp(config: RuntimeConfig): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
    requestTimeout: 30_000,
  });
  const startedAt = Date.now();

  installLocalAuth(app, {
    launchToken: config.launchToken,
    allowedOrigins: config.allowedOrigins,
  });
  registerHealthRoute(app, config.version, startedAt);
  registerHandshakeRoute(app);

  return app;
}
