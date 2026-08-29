import { createInterface } from "node:readline/promises";

import type { RuntimeClient } from "@noneedwork/client-sdk";
import {
  type ModelCredentialStatus,
  type ModelCredentialStatusList,
  type ModelProbeResult,
  type ModelProfileList,
  type ModelSelection,
  modelProfileIdSchema,
  modelSelectionSchema,
} from "@noneedwork/protocol";
import type { Command } from "commander";

import { ensureRuntime } from "../client/runtime-discovery.js";
import { readSecret } from "../io/secret-reader.js";

export type ModelCommandClient = Pick<
  RuntimeClient,
  | "listModelProfiles"
  | "getModelSelection"
  | "setModelSelection"
  | "listModelCredentials"
  | "setModelCredential"
  | "deleteModelCredential"
  | "probeModel"
>;

export interface ModelCommandDependencies {
  connect(): Promise<{ client: ModelCommandClient }>;
  readSecret(prompt: string): Promise<string>;
  confirm(prompt: string): Promise<boolean>;
  stdout(value: string): void;
  stderr(value: string): void;
}

const defaultDependencies: ModelCommandDependencies = {
  connect: ensureRuntime,
  readSecret,
  confirm: confirmInteractive,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export function registerModelCommand(
  program: Command,
  dependencies: ModelCommandDependencies = defaultDependencies,
): void {
  const model = program.command("model").description("Manage model providers and credentials");

  model
    .command("list")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const { client } = await dependencies.connect();
      printProfiles(await client.listModelProfiles(), options.json, dependencies.stdout);
    });

  const credential = model.command("credential").description("Manage provider credentials");
  credential
    .command("set")
    .argument("<profile-id>")
    .option("--json", "Print machine-readable JSON")
    .action(async (rawProfileId: string, options: { json?: boolean }) => {
      const profileId = modelProfileIdSchema.parse(rawProfileId);
      let secret = await dependencies.readSecret(`Credential for ${profileId}: `);
      try {
        const { client } = await dependencies.connect();
        printCredentialStatus(
          await client.setModelCredential(profileId, secret),
          options.json,
          dependencies.stdout,
        );
      } finally {
        secret = "";
      }
    });

  credential
    .command("list")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const { client } = await dependencies.connect();
      printCredentials(await client.listModelCredentials(), options.json, dependencies.stdout);
    });

  credential
    .command("delete")
    .argument("<profile-id>")
    .option("--json", "Print machine-readable JSON")
    .action(async (rawProfileId: string, options: { json?: boolean }) => {
      const profileId = modelProfileIdSchema.parse(rawProfileId);
      const { client } = await dependencies.connect();
      printCredentialStatus(
        await client.deleteModelCredential(profileId),
        options.json,
        dependencies.stdout,
      );
    });

  model
    .command("select")
    .argument("<profile-id>")
    .argument("<model-id>")
    .option("--json", "Print machine-readable JSON")
    .action(async (rawProfileId: string, rawModelId: string, options: { json?: boolean }) => {
      const selection = modelSelectionSchema.parse({
        profileId: rawProfileId,
        modelId: rawModelId,
      });
      const { client } = await dependencies.connect();
      printSelection(await client.setModelSelection(selection), options.json, dependencies.stdout);
    });

  model
    .command("test")
    .argument("<profile-id>")
    .option("--yes", "Confirm quota use without an interactive prompt")
    .option("--json", "Print machine-readable JSON")
    .action(async (rawProfileId: string, options: { yes?: boolean; json?: boolean }) => {
      const profileId = modelProfileIdSchema.parse(rawProfileId);
      dependencies.stderr("Warning: this provider protocol test consumes Token Plan quota.\n");
      if (
        !options.yes &&
        !(await dependencies.confirm("Continue with the provider test? [y/N] "))
      ) {
        dependencies.stderr("Provider test cancelled.\n");
        return;
      }
      const { client } = await dependencies.connect();
      printProbe(await client.probeModel(profileId), options.json, dependencies.stdout);
    });
}

export function parseTaskModelOption(raw: string): ModelSelection {
  const parts = raw.split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error("--model must use the exact <profile-id>/<model-id> form");
  }
  return modelSelectionSchema.parse({ profileId: parts[0], modelId: parts[1] });
}

async function confirmInteractive(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Provider test confirmation requires an interactive TTY or --yes");
  }
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await reader.question(prompt)).trim().toLowerCase() === "y";
  } finally {
    reader.close();
  }
}

function printProfiles(
  result: ModelProfileList,
  json: boolean | undefined,
  write: (v: string) => void,
) {
  if (json) return write(`${JSON.stringify(result, null, 2)}\n`);
  for (const profile of result.profiles) {
    write(`${profile.profileId}\t${profile.defaultModelId}\t${profile.modelIds.join(",")}\n`);
  }
}

function printSelection(
  result: ModelSelection,
  json: boolean | undefined,
  write: (v: string) => void,
) {
  write(json ? `${JSON.stringify(result, null, 2)}\n` : `${result.profileId}/${result.modelId}\n`);
}

function printCredentials(
  result: ModelCredentialStatusList,
  json: boolean | undefined,
  write: (v: string) => void,
) {
  if (json) return write(`${JSON.stringify(result, null, 2)}\n`);
  for (const status of result.credentials) printCredentialStatus(status, false, write);
}

function printCredentialStatus(
  status: ModelCredentialStatus,
  json: boolean | undefined,
  write: (v: string) => void,
) {
  write(
    json
      ? `${JSON.stringify(status, null, 2)}\n`
      : `${status.profileId}\t${status.configured ? "configured" : "not-configured"}\t${status.updatedAt ?? "-"}\n`,
  );
}

function printProbe(
  result: ModelProbeResult,
  json: boolean | undefined,
  write: (v: string) => void,
) {
  write(
    json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${result.profileId}/${result.modelId}\t${result.success ? "ok" : (result.errorCode ?? "failed")}\t${result.latencyMs}ms\n`,
  );
}
