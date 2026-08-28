import { RuntimeClient } from "@noneedwork/client-sdk";
import type { Command } from "commander";

import { startRuntime } from "../client/runtime-discovery.js";

export function registerRuntimeCommand(program: Command): void {
  const runtime = program.command("runtime").description("Manage the local runtime process");
  runtime
    .command("start")
    .description("Start the runtime in the foreground")
    .action(async () => {
      const started = await startRuntime();
      const client = new RuntimeClient({
        baseUrl: `http://${started.handshake.host}:${started.handshake.port}`,
        bearerToken: started.handshake.bearerToken,
      });
      const health = await client.health();
      process.stdout.write(
        `${JSON.stringify({
          kind: started.handshake.kind,
          host: started.handshake.host,
          port: started.handshake.port,
          pid: started.handshake.pid,
          status: health.status,
        })}\n`,
      );

      const stop = () => void started.stop();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      await new Promise<void>((resolveExit) => started.child.once("exit", () => resolveExit()));
    });
}
