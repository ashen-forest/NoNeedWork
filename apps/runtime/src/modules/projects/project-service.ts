import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";

import type { Project } from "@noneedwork/protocol";

import type { ProjectRepository } from "../storage/repositories/project-repository.js";

const execFileAsync = promisify(execFile);

export class ProjectService {
  constructor(private readonly projects: ProjectRepository) {}

  async open(path: string): Promise<Project> {
    const rootPath = await realpath(path);
    const info = await stat(rootPath);
    if (!info.isDirectory()) throw new Error(`Project path is not a directory: ${rootPath}`);
    const head = await execFileAsync("git", ["-C", rootPath, "rev-parse", "HEAD"], {
      windowsHide: true,
      timeout: 5_000,
    })
      .then(({ stdout }) => stdout.trim())
      .catch(() => "not-a-git-repository");
    const fingerprint = createHash("sha256")
      .update(rootPath)
      .update("\0")
      .update(head)
      .digest("hex");
    return this.projects.open(rootPath, fingerprint);
  }
}
