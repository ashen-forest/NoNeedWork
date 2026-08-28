import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { arch, platform } from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolveTarget(platform, arch);
const binariesRoot = join(repositoryRoot, "apps", "desktop", "src-tauri", "binaries");
const output = join(binariesRoot, target.fileName);
const resourcesOutput = join(binariesRoot, "nw-runtime-resources");
const packagingRoot = join(repositoryRoot, "packaging", "runtime-sidecar");
const buildRoot = join(repositoryRoot, ".sidecar-build");
const seaConfig = join(buildRoot, "sea-config.json");
const seaBlob = join(buildRoot, "nw-runtime.blob");
const seaBootstrap = join(repositoryRoot, "scripts", "sidecar-sea-bootstrap.cjs");

assertBuildPath(resourcesOutput, binariesRoot, "nw-runtime-resources");
assertBuildPath(buildRoot, repositoryRoot, ".sidecar-build");

await runNpm(["run", "build:packages"], repositoryRoot);
await runNpm(["run", "build", "-w", "@noneedwork/runtime"], repositoryRoot);
await runNpm(
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--install-links=true"],
  packagingRoot,
);

await rm(buildRoot, { force: true, recursive: true });
await rm(resourcesOutput, { force: true, recursive: true });
await mkdir(buildRoot, { recursive: true });
await mkdir(join(resourcesOutput, "apps", "runtime"), { recursive: true });
await cp(
  join(repositoryRoot, "apps", "runtime", "dist"),
  join(resourcesOutput, "apps", "runtime", "dist"),
  {
    recursive: true,
  },
);
await cp(join(packagingRoot, "node_modules"), join(resourcesOutput, "node_modules"), {
  dereference: true,
  recursive: true,
});
await copyFile(join(packagingRoot, "package.json"), join(resourcesOutput, "package.json"));

await writeFile(
  seaConfig,
  `${JSON.stringify(
    {
      main: seaBootstrap,
      output: seaBlob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await run(process.execPath, ["--experimental-sea-config", seaConfig], repositoryRoot);
await mkdir(dirname(output), { recursive: true });
await copyFile(process.execPath, output);
await runNpm(
  [
    "exec",
    "--",
    "postject",
    output,
    "NODE_SEA_BLOB",
    seaBlob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ...(platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
  ],
  repositoryRoot,
);
process.stdout.write(
  `${JSON.stringify({ kind: "noneedwork.sidecar.built", output, resourcesOutput, target })}\n`,
);

function resolveTarget(hostPlatform, hostArch) {
  const key = `${hostPlatform}-${hostArch}`;
  const targets = {
    "win32-x64": {
      fileName: "nw-runtime-x86_64-pc-windows-msvc.exe",
    },
    "linux-x64": {
      fileName: "nw-runtime-x86_64-unknown-linux-gnu",
    },
    "darwin-arm64": {
      fileName: "nw-runtime-aarch64-apple-darwin",
    },
  };
  const target = targets[key];
  if (!target) throw new Error(`Unsupported sidecar build target: ${key}`);
  return target;
}

function assertBuildPath(candidate, parent, expectedName) {
  const resolvedCandidate = resolve(candidate);
  const resolvedParent = resolve(parent);
  if (
    dirname(resolvedCandidate) !== resolvedParent ||
    basename(resolvedCandidate) !== expectedName
  ) {
    throw new Error(`Refusing to replace unsafe build path: ${resolvedCandidate}`);
  }
}

function runNpm(args, cwd) {
  const npmEntry =
    process.env.npm_execpath ??
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return run(process.execPath, [npmEntry, ...args], cwd);
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}
