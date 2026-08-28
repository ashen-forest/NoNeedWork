import type { TaskBudget } from "@noneedwork/protocol";

import { type ProposedPlan, proposedPlanSchema } from "./plan-schema.js";

export function parsePlanOutput(output: string, budget: TaskBudget): ProposedPlan {
  const trimmed = output.trim();
  const json = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "")
    : trimmed;
  const plan = proposedPlanSchema.parse(JSON.parse(json));
  validatePlan(plan, budget);
  return plan;
}

export function validatePlan(plan: ProposedPlan, budget: TaskBudget): void {
  const keys = new Set<string>();
  for (const step of plan.steps) {
    if (keys.has(step.key)) throw new Error(`Duplicate plan step key: ${step.key}`);
    keys.add(step.key);
  }
  for (const step of plan.steps) {
    for (const dependency of step.dependencies) {
      if (!keys.has(dependency)) {
        throw new Error(`Plan step ${step.key} has unknown dependency ${dependency}`);
      }
      if (dependency === step.key) throw new Error(`Plan step ${step.key} depends on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(plan.steps.map((step) => [step.key, step]));
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error(`Plan contains a dependency cycle at ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependencies ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of keys) visit(key);

  const writeSteps = plan.steps.filter((step) => step.requiresWrite).length;
  if (writeSteps > budget.maxWriteOperations) {
    throw new Error(
      `Plan requires ${writeSteps} write steps but budget allows ${budget.maxWriteOperations}`,
    );
  }
  if (plan.steps.length > budget.maxTurns) {
    throw new Error(`Plan has ${plan.steps.length} steps but turn budget is ${budget.maxTurns}`);
  }
}
