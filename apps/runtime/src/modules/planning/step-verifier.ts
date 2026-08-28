import type { PlanStep, PlanStepStatus } from "@noneedwork/protocol";

import type { PlanStepRepository } from "../storage/repositories/plan-step-repository.js";
import { dependenciesSatisfied } from "../tasks/step-state-machine.js";

export interface VerificationResult {
  argv: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class StepVerifier {
  constructor(private readonly steps: PlanStepRepository) {}

  promoteReady(runId: string): PlanStep[] {
    const current = this.steps.list(runId);
    const statuses = new Map<string, PlanStepStatus>(current.map((step) => [step.id, step.status]));
    for (const step of current) {
      if (step.status === "PENDING" && dependenciesSatisfied(step.dependencies, statuses)) {
        const ready = this.steps.transition(step, "READY");
        statuses.set(ready.id, ready.status);
      }
    }
    return this.steps.list(runId);
  }

  isSuccessful(results: readonly VerificationResult[]): boolean {
    return results.length > 0 && results.every((result) => result.exitCode === 0);
  }
}
