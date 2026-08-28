import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxCommandResult } from "../../src/modules/sandbox/docker-provider.js";
import type { WorkspaceSandboxProvider } from "../../src/modules/tasks/task-orchestrator.js";

export class LocalWorkspaceSandbox implements WorkspaceSandboxProvider {
  readonly directories: string[] = [];

  async createWorkspace(sourceDirectory: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "noneedwork-local-sandbox-"));
    this.directories.push(directory);
    await cp(sourceDirectory, directory, { recursive: true });
    return directory;
  }

  async execute(
    sandboxId: string,
    argv: readonly string[],
    timeoutMs = 30_000,
  ): Promise<SandboxCommandResult> {
    const mappedArgv = argv.map((argument) => mapWorkspaceArgument(argument, sandboxId));
    const command = mappedArgv[0];
    if (!command) throw new Error("Command cannot be empty");
    return new Promise((resolve, reject) => {
      const child = spawn(command, mappedArgv.slice(1), {
        cwd: sandboxId,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      timeout.unref();
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve({
          exitCode: timedOut ? 124 : (code ?? 1),
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
        });
      });
    });
  }

  async removeSandbox(sandboxId: string): Promise<void> {
    await rm(sandboxId, { recursive: true, force: true });
    const index = this.directories.indexOf(sandboxId);
    if (index >= 0) this.directories.splice(index, 1);
  }

  async cleanup(): Promise<void> {
    await Promise.all(
      this.directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  }
}

function mapWorkspaceArgument(argument: string, sandboxId: string): string {
  if (argument === "/workspace") return sandboxId;
  if (argument.startsWith("/workspace/")) {
    return join(sandboxId, ...argument.slice("/workspace/".length).split("/"));
  }
  return argument;
}
