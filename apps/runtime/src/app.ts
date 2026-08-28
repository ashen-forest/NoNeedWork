import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { registerArtifactRoutes } from "./api/artifacts.js";
import { registerEventRoutes } from "./api/events.js";
import { registerHandshakeRoute } from "./api/handshake.js";
import { registerHealthRoute } from "./api/health.js";
import { registerProjectRoutes } from "./api/projects.js";
import { registerTaskRoutes } from "./api/tasks.js";
import type { RuntimeConfig } from "./config.js";
import { installLocalAuth } from "./security/local-auth.js";
import { createRuntimeServices, type RuntimeServices } from "./services.js";

export function buildRuntimeApp(
  config: RuntimeConfig,
  runtimeServices?: RuntimeServices,
): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
    requestTimeout: 30_000,
  });
  const startedAt = Date.now();
  const services = runtimeServices ?? createRuntimeServices(config, { databasePath: ":memory:" });

  app.register(websocket);
  installLocalAuth(app, {
    launchToken: config.launchToken,
    allowedOrigins: config.allowedOrigins,
  });
  registerHealthRoute(app, config.version, startedAt);
  registerHandshakeRoute(app);
  registerProjectRoutes(app, services);
  registerTaskRoutes(app, services);
  app.after(() => registerEventRoutes(app, services));
  registerArtifactRoutes(app, services);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        protocolVersion: 1,
        error: { code: "VALIDATION_ERROR", message: error.message, retryable: false },
      });
    }
    const candidateStatus =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const statusCode = candidateStatus >= 400 ? candidateStatus : 500;
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(statusCode).send({
      protocolVersion: 1,
      error: {
        code: statusCode === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
        message,
        retryable: false,
      },
    });
  });
  app.addHook("onClose", async () => {
    await services.taskRunner.shutdown();
    services.database.close();
  });

  return app;
}
