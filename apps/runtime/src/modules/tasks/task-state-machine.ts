import type { TaskStatus } from "@noneedwork/protocol";

const TERMINAL = new Set<TaskStatus>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  CREATED: new Set(["PREPARING", "PAUSED", "FAILED", "CANCELLED"]),
  PREPARING: new Set(["PLANNING", "PAUSED", "FAILED", "CANCELLED"]),
  PLANNING: new Set(["EXECUTING", "AWAITING_APPROVAL", "PAUSED", "FAILED", "CANCELLED"]),
  AWAITING_APPROVAL: new Set(["EXECUTING", "PAUSED", "FAILED", "CANCELLED"]),
  EXECUTING: new Set(["VERIFYING", "REPLANNING", "PAUSED", "FAILED", "CANCELLED"]),
  VERIFYING: new Set(["SUCCEEDED", "REPLANNING", "PAUSED", "FAILED", "CANCELLED"]),
  REPLANNING: new Set(["EXECUTING", "PAUSED", "FAILED", "CANCELLED"]),
  PAUSED: new Set([
    "PREPARING",
    "PLANNING",
    "AWAITING_APPROVAL",
    "EXECUTING",
    "VERIFYING",
    "REPLANNING",
    "FAILED",
    "CANCELLED",
  ]),
  SUCCEEDED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
};

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].has(to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`Invalid TaskRun transition ${from} -> ${to}`);
  }
}

export const taskTransitionTable = TRANSITIONS;
