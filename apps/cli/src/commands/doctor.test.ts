import { describe, expect, it } from "vitest";

import { type DoctorDependencies, runDoctor } from "./doctor.js";

function dependencies(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    platform: "win32",
    nodeVersion: "24.9.0",
    env: { LOCALAPPDATA: "C:\\Temp" },
    verifyWritable: async () => true,
    run: async (command, args) => ({
      ok: true,
      stdout: `${command} ${args.join(" ")}`,
      stderr: "",
    }),
    modelStatus: async () => ({
      runtimeAvailable: true,
      selection: { profileId: "qwen-cn", modelId: "qwen3.7-plus" },
      credentialConfigured: true,
    }),
    ...overrides,
  };
}

describe("nw doctor", () => {
  it("reports Runtime model readiness without inspecting environment credentials", async () => {
    const secret = "must-not-appear";
    const report = await runDoctor(
      dependencies({ env: { LOCALAPPDATA: "C:\\Temp", OPENAI_API_KEY: secret } }),
    );

    expect(report.ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.checks.find((check) => check.id === "default-model")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "model-credential")?.status).toBe("pass");
  });

  it("warns when Runtime model status is unavailable", async () => {
    const report = await runDoctor(
      dependencies({ modelStatus: async () => ({ runtimeAvailable: false }) }),
    );

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "default-model")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "model-credential")?.status).toBe("warn");
  });

  it("returns actionable failures for missing Docker and sandbox image", async () => {
    const report = await runDoctor(
      dependencies({
        run: async (command) => ({
          ok: command !== "docker",
          stdout: command,
          stderr: "",
        }),
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "docker")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "sandbox-image")?.remediation).toMatch(
      /docker build/u,
    );
  });
});
