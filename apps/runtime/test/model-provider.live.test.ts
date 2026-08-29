import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelProfileId } from "@noneedwork/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeConfig } from "../src/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/services.js";

const enabled = process.env.NONEEDWORK_LIVE_MODEL_TESTS === "1";
const liveDescribe = enabled ? describe : describe.skip;
let directory: string | undefined;
let services: RuntimeServices | undefined;

liveDescribe("live model providers (skipped unless NONEEDWORK_LIVE_MODEL_TESTS=1)", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "noneedwork-live-providers-"));
    services = createRuntimeServices(createRuntimeConfig({ appDataDirectory: directory }), {
      autoStartTasks: false,
    });
  });

  afterAll(async () => {
    services?.database.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  for (const profileId of ["qwen-cn", "minimax-cn"] as const) {
    it(`runs the bounded ${profileId} text and tool protocol probe from Credential Manager`, async (context) => {
      const runtime = requireServices();
      if (!credentialConfigured(runtime, profileId)) {
        context.skip(`Credential Manager has no ${profileId} credential`);
        return;
      }
      const result = await runtime.modelService.probe(profileId);
      process.stdout.write(
        `${JSON.stringify({ kind: "noneedwork.live-model-probe", ...result })}\n`,
      );
      expect(result).toMatchObject({
        profileId,
        success: true,
        checks: { text: true, toolCall: true },
      });
      expect(JSON.stringify(result).length).toBeLessThan(1_024);
    }, 35_000);
  }
});

function requireServices(): RuntimeServices {
  if (!services) throw new Error("Live provider Runtime was not initialized");
  return services;
}

function credentialConfigured(runtime: RuntimeServices, profileId: ModelProfileId): boolean {
  return (
    runtime.modelService
      .listCredentialStatus()
      .find((credential) => credential.profileId === profileId)?.configured ?? false
  );
}
