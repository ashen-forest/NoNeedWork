import { rm } from "node:fs/promises";

import type { ArtifactRepository } from "./artifact-repository.js";

export async function removeUnreferencedBlob(
  repository: ArtifactRepository,
  sha256: string,
  filesystemPath: string,
): Promise<boolean> {
  if (repository.countReferences(sha256) > 0) return false;
  await rm(filesystemPath, { force: true });
  return true;
}
