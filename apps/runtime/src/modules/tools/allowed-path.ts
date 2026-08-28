import { canonicalizeWorkspacePath } from "../sandbox/path-mapper.js";

export function assertAllowedPath(input: string, patterns: readonly string[] | undefined): string {
  const path = canonicalizeWorkspacePath(input);
  if (!patterns || patterns.length === 0)
    throw new Error("No writable workspace paths were granted");
  const allowed = patterns.some((pattern) => {
    if (pattern === "**" || pattern === "*") return true;
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3).replace(/\/$/u, "");
      return path === prefix || path.startsWith(`${prefix}/`);
    }
    return path === pattern;
  });
  if (!allowed) throw new Error(`Path is outside the current plan grant: ${JSON.stringify(path)}`);
  return path;
}
