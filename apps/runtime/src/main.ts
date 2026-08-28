#!/usr/bin/env node
import { PROTOCOL_VERSION, runtimeHandshakeSchema } from "@noneedwork/protocol";

import { buildRuntimeApp } from "./app.js";
import { createRuntimeConfig } from "./config.js";
import { publishRuntimeRegistry, removeRuntimeRegistry } from "./runtime-registry.js";
import { createRuntimeServices } from "./services.js";

async function main(): Promise<void> {
  const config = createRuntimeConfig();
  const services = createRuntimeServices(config);
  const app = buildRuntimeApp(config, services);
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

  await publishRuntimeRegistry(config.appDataDirectory, handshake);
  process.stdout.write(`${JSON.stringify(handshake)}\n`);
  for (const decision of services.recoveryDecisions) {
    const run = services.tasks.runs.get(decision.runId);
    if (
      run &&
      (decision.action === "RESUME_FROM_CHECKPOINT" || decision.action === "WAIT_FOR_LEASE")
    ) {
      resumeWhenLeaseAvailable(services, run.taskId);
    }
  }

  const shutdown = async () => {
    await app.close();
    await removeRuntimeRegistry(config.appDataDirectory, process.pid);
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function resumeWhenLeaseAvailable(
  services: ReturnType<typeof createRuntimeServices>,
  taskId: string,
): void {
  const details = services.tasks.details(taskId);
  if (!details?.run || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(details.run.status)) return;
  const leaseExpiry = details.run.leaseExpiresAt ? Date.parse(details.run.leaseExpiresAt) : 0;
  if (details.run.leaseOwner && leaseExpiry > Date.now()) {
    const delay = Math.max(25, Math.min(leaseExpiry - Date.now() + 25, 30_000));
    const timer = setTimeout(() => resumeWhenLeaseAvailable(services, taskId), delay);
    timer.unref();
    return;
  }
  services.taskRunner.start(taskId);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ kind: "noneedwork.runtime.error", message })}\n`);
  process.exitCode = 1;
});
