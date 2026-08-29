import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { arch, argv, platform } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = argv[2] ? resolve(argv[2]) : defaultBinary(repositoryRoot);
const child = spawn(binary, [], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });

try {
  const handshake = await readFirstJsonLine(child, 20_000);
  if (
    handshake?.kind !== "noneedwork.runtime.ready" ||
    handshake?.protocolVersion !== 1 ||
    handshake?.host !== "127.0.0.1"
  ) {
    throw new Error("Sidecar returned an invalid runtime handshake");
  }
  const response = await fetch(`http://${handshake.host}:${handshake.port}/v1/health`, {
    headers: {
      authorization: `Bearer ${handshake.bearerToken}`,
      "x-noneedwork-protocol": "1",
    },
  });
  const health = await response.json();
  if (!response.ok || health?.engine?.name !== "pi" || health?.engine?.version !== "0.84.3") {
    throw new Error(`Sidecar health verification failed: ${JSON.stringify(health)}`);
  }
  const profilesResponse = await fetch(
    `http://${handshake.host}:${handshake.port}/v1/models/profiles`,
    {
      headers: {
        authorization: `Bearer ${handshake.bearerToken}`,
        "x-noneedwork-protocol": "1",
      },
    },
  );
  const profiles = await profilesResponse.json();
  const defaults = Object.fromEntries(
    (profiles?.profiles ?? []).map((profile) => [profile.profileId, profile.defaultModelId]),
  );
  if (
    !profilesResponse.ok ||
    defaults["qwen-cn"] !== "qwen3.7-plus" ||
    defaults["minimax-cn"] !== "MiniMax-M3"
  ) {
    throw new Error(`Sidecar model profile verification failed: ${JSON.stringify(profiles)}`);
  }
  process.stdout.write(
    `${JSON.stringify({
      kind: "noneedwork.sidecar.verified",
      binary,
      protocolVersion: health.protocolVersion,
      piVersion: health.engine.version,
      safeMode: health.engine.safeMode,
      modelProfiles: defaults,
    })}\n`,
  );
} finally {
  child.kill("SIGTERM");
}

function defaultBinary(root) {
  const key = `${platform}-${arch}`;
  const fileNames = {
    "win32-x64": "nw-runtime-x86_64-pc-windows-msvc.exe",
    "linux-x64": "nw-runtime-x86_64-unknown-linux-gnu",
    "darwin-arm64": "nw-runtime-aarch64-apple-darwin",
  };
  const fileName = fileNames[key];
  if (!fileName) throw new Error(`Unsupported sidecar verification target: ${key}`);
  return join(root, "apps", "desktop", "src-tauri", "binaries", fileName);
}

async function readFirstJsonLine(processHandle, timeoutMs) {
  if (!processHandle.stdout) throw new Error("Sidecar stdout is unavailable");
  const lines = createInterface({ input: processHandle.stdout });
  return new Promise((resolveLine, rejectLine) => {
    const timeout = setTimeout(
      () => rejectLine(new Error("Sidecar handshake timed out")),
      timeoutMs,
    );
    timeout.unref();
    processHandle.once("exit", (code) =>
      rejectLine(new Error(`Sidecar exited with ${String(code)}`)),
    );
    lines.once("line", (line) => {
      clearTimeout(timeout);
      try {
        resolveLine(JSON.parse(line));
      } catch (error) {
        rejectLine(new Error("Sidecar handshake was not JSON", { cause: error }));
      }
    });
  });
}
