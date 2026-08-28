import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { RuntimeClient } from "@noneedwork/client-sdk";
import { type RuntimeHandshake, runtimeHandshakeSchema } from "@noneedwork/protocol";

export interface StartedRuntime {
  child: ChildProcess;
  handshake: RuntimeHandshake;
  stop(): Promise<void>;
}

export interface StartRuntimeOptions {
  command?: string;
  args?: string[];
  timeoutMs?: number;
}

export interface RuntimeConnection {
  client: RuntimeClient;
  handshake: RuntimeHandshake;
}

export async function startRuntime(options: StartRuntimeOptions = {}): Promise<StartedRuntime> {
  const runtimeEntry = fileURLToPath(new URL("../../../runtime/dist/main.js", import.meta.url));
  const command = options.command ?? process.execPath;
  const args = options.args ?? [runtimeEntry];
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
    env: process.env,
  });
  const timeoutMs = options.timeoutMs ?? 15_000;

  try {
    const handshake = await readHandshake(child, timeoutMs);
    return {
      child,
      handshake,
      stop: () => stopChild(child),
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}

export async function discoverRuntime(
  appDataDirectory = defaultAppDataDirectory(),
): Promise<RuntimeConnection | undefined> {
  const registryPath = join(appDataDirectory, "runtime.json");
  const handshake = await readFile(registryPath, "utf8")
    .then((text) => runtimeHandshakeSchema.parse(JSON.parse(text)))
    .catch(() => undefined);
  if (!handshake) return undefined;
  const client = createClient(handshake);
  try {
    await client.health();
    return { client, handshake };
  } catch {
    return undefined;
  }
}

export async function ensureRuntime(
  appDataDirectory = defaultAppDataDirectory(),
): Promise<RuntimeConnection> {
  const existing = await discoverRuntime(appDataDirectory);
  if (existing) return existing;

  const runtimeEntry = fileURLToPath(new URL("../../../runtime/dist/main.js", import.meta.url));
  const child = spawn(process.execPath, [runtimeEntry], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const connection = await discoverRuntime(appDataDirectory);
    if (connection) return connection;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Runtime did not become discoverable within 15000ms");
}

async function readHandshake(child: ChildProcess, timeoutMs: number): Promise<RuntimeHandshake> {
  if (!child.stdout) throw new Error("Runtime stdout is unavailable");
  const lines = createInterface({ input: child.stdout });
  return new Promise((resolveHandshake, rejectHandshake) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectHandshake(new Error(`Runtime did not emit a handshake within ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref();

    const cleanup = () => {
      clearTimeout(timeout);
      lines.removeAllListeners();
      child.removeListener("exit", onExit);
    };
    const onExit = (code: number | null) => {
      cleanup();
      rejectHandshake(new Error(`Runtime exited before handshake with code ${String(code)}`));
    };
    child.once("exit", onExit);
    lines.once("line", (line) => {
      cleanup();
      try {
        resolveHandshake(runtimeHandshakeSchema.parse(JSON.parse(line)));
      } catch (error) {
        rejectHandshake(new Error("Runtime emitted an invalid handshake", { cause: error }));
      }
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  const forceTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  forceTimeout.unref();
  await exited.finally(() => clearTimeout(forceTimeout));
}

function createClient(handshake: RuntimeHandshake): RuntimeClient {
  return new RuntimeClient({
    baseUrl: `http://${handshake.host}:${handshake.port}`,
    bearerToken: handshake.bearerToken,
  });
}

function defaultAppDataDirectory(): string {
  return (
    process.env.NONEEDWORK_APP_DATA_DIRECTORY ??
    join(process.env.LOCALAPPDATA ?? join(process.cwd(), ".noneedwork-data"), "NoNeedWork")
  );
}
