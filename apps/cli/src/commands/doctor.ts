import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ModelSelection } from "@noneedwork/protocol";
import type { Command } from "commander";

import { discoverRuntime } from "../client/runtime-discovery.js";

const execFileAsync = promisify(execFile);

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  remediation?: string;
}

export interface DoctorReport {
  ok: boolean;
  generatedAt: string;
  checks: DoctorCheck[];
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface DoctorModelStatus {
  runtimeAvailable: boolean;
  selection?: ModelSelection;
  credentialConfigured?: boolean;
}

export interface DoctorDependencies {
  run(command: string, args: readonly string[]): Promise<CommandResult>;
  platform: NodeJS.Platform;
  nodeVersion: string;
  env: NodeJS.ProcessEnv;
  verifyWritable(directory: string): Promise<boolean>;
  modelStatus(): Promise<DoctorModelStatus>;
}

const defaultDependencies: DoctorDependencies = {
  async run(command, args) {
    try {
      const result = await execFileAsync(command, [...args], {
        timeout: 10_000,
        windowsHide: true,
      });
      return { ok: true, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const value = error as { stdout?: string; stderr?: string };
      return { ok: false, stdout: value.stdout ?? "", stderr: value.stderr ?? "" };
    }
  },
  platform: process.platform,
  nodeVersion: process.versions.node,
  env: process.env,
  async verifyWritable(directory) {
    try {
      await mkdir(directory, { recursive: true });
      const probe = await mkdtemp(join(directory, "doctor-"));
      await rm(probe, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  },
  async modelStatus() {
    const connection = await discoverRuntime();
    if (!connection) return { runtimeAvailable: false };
    try {
      const [selection, credentials] = await Promise.all([
        connection.client.getModelSelection(),
        connection.client.listModelCredentials(),
      ]);
      return {
        runtimeAvailable: true,
        selection,
        credentialConfigured:
          credentials.credentials.find((credential) => credential.profileId === selection.profileId)
            ?.configured ?? false,
      };
    } catch {
      return { runtimeAvailable: false };
    }
  },
};

export async function runDoctor(
  dependencies: DoctorDependencies = defaultDependencies,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number.parseInt(dependencies.nodeVersion.split(".")[0] ?? "0", 10);
  checks.push(
    nodeMajor === 24
      ? pass("node", "Node.js 24", `Node ${dependencies.nodeVersion}`)
      : fail(
          "node",
          "Node.js 24",
          `Found Node ${dependencies.nodeVersion}`,
          "Install Node.js 24 LTS.",
        ),
  );

  const git = await dependencies.run("git", ["--version"]);
  checks.push(
    git.ok
      ? pass("git", "Git", git.stdout.trim())
      : fail("git", "Git", "Git was not found", "Install Git and add it to PATH."),
  );

  const docker = await dependencies.run("docker", ["version", "--format", "{{.Server.Version}}"]);
  checks.push(
    docker.ok
      ? pass("docker", "Docker Engine", `Server ${docker.stdout.trim()}`)
      : fail(
          "docker",
          "Docker Engine",
          "Docker Engine is unavailable",
          "Install or start Docker Desktop with the WSL2 backend.",
        ),
  );

  const image = docker.ok
    ? await dependencies.run("docker", ["image", "inspect", "noneedwork/sandbox:0.1"])
    : { ok: false, stdout: "", stderr: "" };
  checks.push(
    image.ok
      ? pass("sandbox-image", "Sandbox image", "noneedwork/sandbox:0.1 is available")
      : fail(
          "sandbox-image",
          "Sandbox image",
          "noneedwork/sandbox:0.1 is missing",
          "Run: docker build -t noneedwork/sandbox:0.1 images/sandbox",
        ),
  );

  if (dependencies.platform === "win32") {
    const wsl = await dependencies.run("wsl.exe", ["--status"]);
    checks.push(
      wsl.ok
        ? pass("wsl2", "WSL2", "WSL is available")
        : fail(
            "wsl2",
            "WSL2",
            "WSL is unavailable",
            "Enable WSL2 and install a Linux distribution.",
          ),
    );
  } else {
    checks.push(warn("wsl2", "WSL2", "Not applicable on this operating system"));
  }

  const appDataRoot = dependencies.env.LOCALAPPDATA ?? join(tmpdir(), "noneedwork-local-data");
  const appDataDirectory = join(appDataRoot, "NoNeedWork");
  checks.push(
    (await dependencies.verifyWritable(appDataDirectory))
      ? pass("app-data", "Application data", `${appDataDirectory} is writable`)
      : fail(
          "app-data",
          "Application data",
          `${appDataDirectory} is not writable`,
          "Check directory permissions and available disk space.",
        ),
  );

  const modelStatus = await dependencies.modelStatus();
  checks.push(
    modelStatus.runtimeAvailable && modelStatus.selection
      ? pass(
          "default-model",
          "Default model",
          `${modelStatus.selection.profileId}/${modelStatus.selection.modelId}`,
        )
      : warn(
          "default-model",
          "Default model",
          "Runtime model selection is unavailable",
          "Start Runtime and run: nw model select <profile-id> <model-id>",
        ),
  );
  checks.push(
    modelStatus.credentialConfigured
      ? pass("model-credential", "Model credential", "Selected profile credential is configured")
      : warn(
          "model-credential",
          "Model credential",
          "Selected profile credential is not configured",
          "Run: nw model credential set <profile-id>",
        ),
  );

  const rust = await dependencies.run("rustc", ["--version"]);
  checks.push(
    rust.ok
      ? pass("rust", "Rust toolchain", rust.stdout.trim())
      : warn(
          "rust",
          "Rust toolchain",
          "Rust is not installed (only required to build the desktop app)",
          "Install Rust with rustup when developing the Tauri Workbench.",
        ),
  );

  return {
    ok: checks.every((check) => check.status !== "fail"),
    generatedAt: new Date().toISOString(),
    checks,
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check local NoNeedWork prerequisites")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const report = await runDoctor();
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else printDoctorReport(report);
      if (!report.ok) process.exitCode = 1;
    });
}

function printDoctorReport(report: DoctorReport): void {
  for (const check of report.checks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    process.stdout.write(`[${marker}] ${check.label}: ${check.message}\n`);
    if (check.remediation) process.stdout.write(`       ${check.remediation}\n`);
  }
  process.stdout.write(`\nNoNeedWork doctor: ${report.ok ? "ready" : "action required"}\n`);
}

function pass(id: string, label: string, message: string): DoctorCheck {
  return { id, label, status: "pass", message };
}

function warn(id: string, label: string, message: string, remediation?: string): DoctorCheck {
  return { id, label, status: "warn", message, ...(remediation ? { remediation } : {}) };
}

function fail(id: string, label: string, message: string, remediation: string): DoctorCheck {
  return { id, label, status: "fail", message, remediation };
}
