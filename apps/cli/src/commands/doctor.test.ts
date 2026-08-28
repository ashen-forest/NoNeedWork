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
    ...overrides,
  };
}

describe("nw doctor", () => {
  it("reports a ready machine without exposing credential values", async () => {
    const secret = "must-not-appear";
    const report = await runDoctor(
      dependencies({ env: { LOCALAPPDATA: "C:\\Temp", OPENAI_API_KEY: secret } }),
    );

    expect(report.ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.checks.find((check) => check.id === "model-credential")?.status).toBe("pass");
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
