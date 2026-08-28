import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { PassThrough, Readable } from "node:stream";

import type Docker from "dockerode";
import tar from "tar-stream";

import {
  createDockerClient,
  type DockerClient,
  type DockerHealth,
  inspectDockerHealth,
} from "./docker-client.js";
import { createOfflineSandboxProfile, SANDBOX_IMAGE } from "./sandbox-profile.js";

export interface SandboxCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SandboxExecutor {
  execute(
    sandboxId: string,
    argv: readonly string[],
    timeoutMs?: number,
  ): Promise<SandboxCommandResult>;
}

export interface DockerProviderOptions {
  docker?: DockerClient;
  image?: string;
  maxSeedBytes?: number;
}

export class DockerProvider implements SandboxExecutor {
  readonly #docker: DockerClient;
  readonly #image: string;
  readonly #maxSeedBytes: number;

  constructor(options: DockerProviderOptions = {}) {
    this.#docker = options.docker ?? createDockerClient();
    this.#image = options.image ?? SANDBOX_IMAGE;
    this.#maxSeedBytes = options.maxSeedBytes ?? 64 * 1024 * 1024;
  }

  doctor(): Promise<DockerHealth> {
    return inspectDockerHealth(this.#docker);
  }

  async createWorkspace(sourceDirectory: string): Promise<string> {
    const sourceRoot = resolve(sourceDirectory);
    const archive = await createSeedArchive(sourceRoot, this.#maxSeedBytes);
    const container = await this.#docker.createContainer(createOfflineSandboxProfile(this.#image));
    try {
      await container.start();
      await container.putArchive(Readable.from(archive), { path: "/workspace" });
      const ready = await this.execute(
        container.id,
        ["test", "-f", "/tmp/noneedwork-ready"],
        10_000,
      );
      if (ready.exitCode !== 0) {
        throw new Error(`Sandbox failed to prepare its workspace: ${ready.stderr}`);
      }
      return container.id;
    } catch (error) {
      await container.remove({ force: true, v: true }).catch(() => undefined);
      throw error;
    }
  }

  async execute(
    sandboxId: string,
    argv: readonly string[],
    timeoutMs = 30_000,
  ): Promise<SandboxCommandResult> {
    if (argv.length === 0) throw new Error("Sandbox command must not be empty");
    const container = this.#docker.getContainer(sandboxId);
    const exec = await container.exec({
      Cmd: [...argv],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: "/workspace",
      Env: [],
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    container.modem.demuxStream(stream, stdout, stderr);

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void container.kill().catch(() => undefined);
    }, timeoutMs);
    timeout.unref();
    await new Promise<void>((resolveStream, rejectStream) => {
      stream.once("end", resolveStream);
      stream.once("error", rejectStream);
    }).finally(() => clearTimeout(timeout));
    const inspection = await exec.inspect();

    return {
      exitCode: timedOut ? 124 : (inspection.ExitCode ?? 1),
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
      timedOut,
    };
  }

  async downloadArchive(sandboxId: string, containerPath: string): Promise<Buffer> {
    const stream = await this.#docker.getContainer(sandboxId).getArchive({ path: containerPath });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      if (typeof chunk === "string" || chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      }
    }
    return Buffer.concat(chunks);
  }

  async inspectSandbox(sandboxId: string): Promise<Docker.ContainerInspectInfo> {
    return this.#docker.getContainer(sandboxId).inspect();
  }

  async removeSandbox(sandboxId: string): Promise<void> {
    await this.#docker.getContainer(sandboxId).remove({ force: true, v: true });
  }
}

async function createSeedArchive(sourceRoot: string, maxBytes: number): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on("data", (chunk: unknown) => {
    if (typeof chunk === "string" || chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    }
  });
  const finished = new Promise<void>((resolvePack, rejectPack) => {
    pack.once("end", resolvePack);
    pack.once("error", rejectPack);
  });
  let totalBytes = 0;

  async function addDirectory(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Sandbox seed cannot contain links: ${absolutePath}`);
      }
      const relativePath = relative(sourceRoot, absolutePath).split(sep).join("/");
      if (relativePath.startsWith("../") || relativePath === "..") {
        throw new Error(`Sandbox seed escaped source root: ${absolutePath}`);
      }
      const archivePath = relativePath;
      if (stat.isDirectory()) {
        await writeTarEntry(pack, { name: archivePath, type: "directory", mode: 0o755 });
        await addDirectory(absolutePath);
      } else if (stat.isFile()) {
        totalBytes += stat.size;
        if (totalBytes > maxBytes) throw new Error(`Sandbox seed exceeds ${maxBytes} bytes`);
        const content = await readFile(absolutePath);
        await writeTarEntry(
          pack,
          { name: archivePath, size: content.length, mode: 0o644 },
          content,
        );
      } else {
        throw new Error(`Unsupported sandbox seed entry: ${absolutePath}`);
      }
    }
  }

  await addDirectory(sourceRoot);
  pack.finalize();
  await finished;
  return Buffer.concat(chunks);
}

function writeTarEntry(
  pack: tar.Pack,
  header: Partial<tar.Header> & Pick<tar.Header, "name">,
  content?: Buffer,
): Promise<void> {
  return new Promise((resolveEntry, rejectEntry) => {
    const callback = (error?: Error | null) => {
      if (error) rejectEntry(error);
      else resolveEntry();
    };
    if (content) pack.entry(header, content, callback);
    else pack.entry(header, callback);
  });
}
