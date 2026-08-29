import type { PlanStepStatus, TaskStatus } from "@noneedwork/protocol";
import { describe, expect, it } from "vitest";

import { assertStepTransition, stepTransitionTable } from "./step-state-machine.js";
import {
  assertTaskTransition,
  canTransitionTask,
  taskTransitionTable,
} from "./task-state-machine.js";

describe("TaskRun state machine", () => {
  it("accepts exactly the declared transition table", () => {
    const statuses = Object.keys(taskTransitionTable) as TaskStatus[];
    for (const from of statuses) {
      for (const to of statuses) {
        if (taskTransitionTable[from].has(to)) {
          expect(() => assertTaskTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertTaskTransition(from, to)).toThrow(
            `Invalid TaskRun transition ${from} -> ${to}`,
          );
        }
      }
    }
  });

  it("supports durable model preflight pause and resume", () => {
    expect(canTransitionTask("PREPARING", "PAUSED")).toBe(true);
    expect(canTransitionTask("PAUSED", "PREPARING")).toBe(true);
  });
});

describe("PlanStep state machine", () => {
  it("accepts exactly the declared transition table", () => {
    const statuses = Object.keys(stepTransitionTable) as PlanStepStatus[];
    for (const from of statuses) {
      for (const to of statuses) {
        if (stepTransitionTable[from].has(to)) {
          expect(() => assertStepTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertStepTransition(from, to)).toThrow(
            `Invalid PlanStep transition ${from} -> ${to}`,
          );
        }
      }
    }
  });
});
