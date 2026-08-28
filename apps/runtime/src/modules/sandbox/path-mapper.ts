import { posix } from "node:path";

import { SANDBOX_WORKSPACE } from "./sandbox-profile.js";

export class InvalidWorkspacePathError extends Error {
  constructor(path: string) {
    super(`Path must stay inside the sandbox workspace: ${JSON.stringify(path)}`);
    this.name = "InvalidWorkspacePathError";
  }
}

export function canonicalizeWorkspacePath(input: string): string {
  if (
    input.length === 0 ||
    input.includes("\0") ||
    input.includes("\\") ||
    input.startsWith("/") ||
    /^[a-zA-Z]:/u.test(input)
  ) {
    throw new InvalidWorkspacePathError(input);
  }

  const segments = input.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new InvalidWorkspacePathError(input);
  }

  const normalized = posix.normalize(input);
  if (normalized === "." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
    throw new InvalidWorkspacePathError(input);
  }
  return normalized;
}

export function toContainerWorkspacePath(input: string): string {
  return posix.join(SANDBOX_WORKSPACE, canonicalizeWorkspacePath(input));
}
