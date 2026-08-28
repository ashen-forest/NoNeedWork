#!/usr/bin/env node
import { PROTOCOL_VERSION, runtimeHandshakeSchema } from "@noneedwork/protocol";

import { buildRuntimeApp } from "./app.js";
import { createRuntimeConfig } from "./config.js";

async function main(): Promise<void> {
  const config = createRuntimeConfig();
  const app = buildRuntimeApp(config);
  const address = await app.listen({ host: config.host, port: config.port });
  const port = Number(new URL(address).port);
  const handshake = runtimeHandshakeSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    kind: "noneedwork.runtime.ready",
    host: config.host,
    port,
    bearerToken: config.launchToken,
    pid: process.pid,
  });

  process.stdout.write(`${JSON.stringify(handshake)}\n`);

  const shutdown = async () => {
    await app.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ kind: "noneedwork.runtime.error", message })}\n`);
  process.exitCode = 1;
});
