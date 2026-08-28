import { describe, expect, it } from "vitest";

import {
  canonicalizeWorkspacePath,
  InvalidWorkspacePathError,
  toContainerWorkspacePath,
} from "./path-mapper.js";

describe("workspace path mapping", () => {
  it("maps a relative repository path into the container workspace", () => {
    expect(canonicalizeWorkspacePath("src/index.ts")).toBe("src/index.ts");
    expect(toContainerWorkspacePath("src/index.ts")).toBe("/workspace/src/index.ts");
  });

  it.each(["../secret", "src/../secret", "/etc/passwd", "C:/Windows/win.ini", "a\\b", "a//b", ""])(
    "rejects escaping or ambiguous path %j",
    (path) => expect(() => toContainerWorkspacePath(path)).toThrow(InvalidWorkspacePathError),
  );
});
