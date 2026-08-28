import { createStepId, type PlanStep, type TaskBudget, type TaskRunId } from "@noneedwork/protocol";

import type { PlanStepRepository } from "../storage/repositories/plan-step-repository.js";
import { parsePlanOutput, validatePlan } from "./plan-parser.js";
import type { ProposedPlan } from "./plan-schema.js";

export interface Planner {
  createPlan(input: { objective: string; budget: TaskBudget }): Promise<string | ProposedPlan>;
}

export class PlanService {
  constructor(private readonly steps: PlanStepRepository) {}

  async create(
    runId: TaskRunId,
    objective: string,
    budget: TaskBudget,
    planner: Planner,
  ): Promise<PlanStep[]> {
    const output = await planner.createPlan({ objective, budget });
    const proposed =
      typeof output === "string"
        ? parsePlanOutput(output, budget)
        : validateAndReturn(output, budget);
    const ids = new Map(proposed.steps.map((step) => [step.key, createStepId()]));
    return this.steps.replaceForRun(
      runId,
      proposed.steps.map((step, position) => ({
        id: requireId(ids, step.key),
        taskRunId: runId,
        position,
        objective: step.objective,
        dependencies: step.dependencies.map((dependency) => requireId(ids, dependency)),
        acceptanceCriteria: step.acceptanceCriteria,
        allowedPaths: step.allowedPaths,
        verificationCommands: step.verificationCommands,
        requiresWrite: step.requiresWrite,
        status: step.dependencies.length === 0 ? "READY" : "PENDING",
      })),
    );
  }
}

function validateAndReturn(plan: ProposedPlan, budget: TaskBudget): ProposedPlan {
  validatePlan(plan, budget);
  return plan;
}

function requireId(ids: ReadonlyMap<string, ReturnType<typeof createStepId>>, key: string) {
  const id = ids.get(key);
  if (!id) throw new Error(`Unknown plan step key ${key}`);
  return id;
}
