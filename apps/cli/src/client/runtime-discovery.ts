import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

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
