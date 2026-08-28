import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ArtifactRepository, StoredArtifact } from "./artifact-repository.js";
import { sha256 } from "./hash.js";

export interface PutArtifactInput {
  taskRunId: string;
  name: string;
  mediaType: string;
  bytes: Uint8Array;
  producer: string;
  retention?: "task" | "release" | "permanent";
}

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}

export class ArtifactStore {
  constructor(
    private readonly rootDirectory: string,
    private readonly repository: ArtifactRepository,
  ) {}

  async put(input: PutArtifactInput): Promise<StoredArtifact> {
    const content = Buffer.from(input.bytes);
    const digest = sha256(content);
    const destination = this.pathForHash(digest);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporary, destination);
    } catch (error) {
      const existing = await readFile(destination).catch(() => undefined);
      if (!existing || sha256(existing) !== digest) throw error;
      await rm(temporary, { force: true });
    }

    return this.repository.create({
      taskRunId: input.taskRunId,
      sha256: digest,
      mediaType: input.mediaType,
      size: content.length,
      name: input.name,
      producer: input.producer,
      retention: input.retention ?? "task",
      filesystemPath: destination,
    });
  }

  async read(artifactId: string): Promise<{ artifact: StoredArtifact; bytes: Buffer }> {
    const artifact = this.repository.get(artifactId);
    if (!artifact) throw new Error(`Unknown artifact ${artifactId}`);
    const bytes = await readFile(artifact.filesystemPath);
    const digest = sha256(bytes);
    if (digest !== artifact.sha256 || bytes.length !== artifact.size) {
      throw new ArtifactIntegrityError(`Artifact ${artifact.id} failed integrity validation`);
    }
    return { artifact, bytes };
  }

  pathForHash(digest: string): string {
    return join(this.rootDirectory, "sha256", digest.slice(0, 2), digest.slice(2, 4), digest);
  }
}
