import { taskBudgetSchema } from "@noneedwork/protocol";
import { describe, expect, it } from "vitest";

import { validatePlan } from "./plan-parser.js";
import type { ProposedPlan } from "./plan-schema.js";

const budget = taskBudgetSchema.parse({ maxTurns: 3, maxWriteOperations: 1 });

function plan(steps: ProposedPlan["steps"]): ProposedPlan {
  return { schemaVersion: 1, objective: "Test objective", steps };
}

function step(key: string, dependencies: string[] = []): ProposedPlan["steps"][number] {
  return {
    key,
    objective: `Complete ${key}`,
    dependencies,
    acceptanceCriteria: [`${key} is verified`],
    allowedPaths: ["src/**"],
    verificationCommands: [["npm", "test"]],
    requiresWrite: true,
  };
}

describe("plan validation", () => {
  it("accepts an acyclic plan within its task budget", () => {
    expect(() => validatePlan(plan([step("first")]), budget)).not.toThrow();
  });

  it("rejects a dependency cycle", () => {
    expect(() =>
      validatePlan(plan([step("first", ["second"]), step("second", ["first"])]), budget),
    ).toThrow(/dependency cycle/);
  });

  it("rejects unknown dependencies and duplicate keys", () => {
    expect(() => validatePlan(plan([step("first", ["missing"])]), budget)).toThrow(
      /unknown dependency/,
    );
    expect(() => validatePlan(plan([step("first"), step("first")]), budget)).toThrow(
      /Duplicate plan step key/,
    );
  });

  it("rejects a plan that exceeds the write budget", () => {
    expect(() => validatePlan(plan([step("first"), step("second")]), budget)).toThrow(
      /write steps but budget allows/,
    );
  });
});
