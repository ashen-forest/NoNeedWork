import type { PlanStepStatus } from "@noneedwork/protocol";

const TRANSITIONS: Readonly<Record<PlanStepStatus, ReadonlySet<PlanStepStatus>>> = {
  PENDING: new Set(["READY", "SKIPPED", "CANCELLED"]),
  READY: new Set(["RUNNING", "SKIPPED", "CANCELLED"]),
  RUNNING: new Set(["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"]),
  SUCCEEDED: new Set(),
  PARTIAL: new Set(),
  FAILED: new Set(),
  SKIPPED: new Set(),
  CANCELLED: new Set(),
};

export function assertStepTransition(from: PlanStepStatus, to: PlanStepStatus): void {
  if (!TRANSITIONS[from].has(to)) {
    throw new Error(`Invalid PlanStep transition ${from} -> ${to}`);
  }
}

export function dependenciesSatisfied(
  dependencyIds: readonly string[],
  statuses: ReadonlyMap<string, PlanStepStatus>,
): boolean {
  return dependencyIds.every((id) => statuses.get(id) === "SUCCEEDED");
}

export const stepTransitionTable = TRANSITIONS;
