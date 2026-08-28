import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { type RuntimeHandshake, runtimeHandshakeSchema } from "@noneedwork/protocol";

const execFileAsync = promisify(execFile);

export function runtimeRegistryPath(appDataDirectory: string): string {
  return join(appDataDirectory, "runtime.json");
}

export async function publishRuntimeRegistry(
  appDataDirectory: string,
  handshake: RuntimeHandshake,
): Promise<void> {
  await mkdir(appDataDirectory, { recursive: true });
  const destination = runtimeRegistryPath(appDataDirectory);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(handshake)}\n`, { encoding: "utf8", mode: 0o600 });
  await hardenRegistryPermissions(temporary);
  await rename(temporary, destination);
}

export async function removeRuntimeRegistry(appDataDirectory: string, pid: number): Promise<void> {
  const path = runtimeRegistryPath(appDataDirectory);
  const registered = await readFile(path, "utf8")
    .then((text) => runtimeHandshakeSchema.parse(JSON.parse(text)))
    .catch(() => undefined);
  if (registered?.pid === pid) await rm(path, { force: true });
}

async function hardenRegistryPermissions(path: string): Promise<void> {
  await chmod(path, 0o600);
  if (process.platform !== "win32") return;
  const { stdout } = await execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true,
    timeout: 5_000,
  });
  const sid = /S-\d+(?:-\d+)+/u.exec(stdout)?.[0];
  if (!sid) throw new Error("Could not determine the current Windows user SID");
  await execFileAsync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:(F)`], {
    windowsHide: true,
    timeout: 5_000,
  });
}
