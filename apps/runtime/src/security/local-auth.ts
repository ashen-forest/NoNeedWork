import { timingSafeEqual } from "node:crypto";
import { PROTOCOL_VERSION } from "@noneedwork/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface LocalAuthOptions {
  launchToken: string;
  allowedOrigins: ReadonlySet<string>;
}

function constantTimeTokenEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function reject(
  reply: FastifyReply,
  statusCode: 401 | 403,
  code: "UNAUTHORIZED" | "FORBIDDEN",
  message: string,
) {
  return reply.code(statusCode).send({
    protocolVersion: PROTOCOL_VERSION,
    error: { code, message, retryable: false },
  });
}

export function installLocalAuth(app: FastifyInstance, options: LocalAuthOptions): void {
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && !options.allowedOrigins.has(origin)) {
      return reject(reply, 403, "FORBIDDEN", "Origin is not allowed");
    }

    const protocol = request.headers["x-noneedwork-protocol"];
    if (protocol !== String(PROTOCOL_VERSION)) {
      return reject(reply, 403, "FORBIDDEN", "Protocol version is missing or unsupported");
    }

    const authorization = request.headers.authorization;
    const prefix = "Bearer ";
    const token = authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : "";
    if (!constantTimeTokenEqual(options.launchToken, token)) {
      return reject(reply, 401, "UNAUTHORIZED", "Launch token is missing or invalid");
    }
  });
}
