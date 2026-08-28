import { describe, expect, it } from "vitest";
import {
  createProjectId,
  createTaskId,
  createTaskRequestSchema,
  createTaskRunId,
  eventEnvelopeSchema,
  projectIdSchema,
  taskBudgetSchema,
} from "./index.js";

describe("protocol identifiers", () => {
  it("creates and validates UUIDv7 identifiers", () => {
    const id = createTaskId();
    expect(id[14]).toBe("7");
    expect(projectIdSchema.safeParse(id).success).toBe(true);
  });

  it("rejects non-UUIDv7 identifiers", () => {
    expect(projectIdSchema.safeParse("00000000-0000-4000-8000-000000000000").success).toBe(false);
  });
});

describe("task protocol", () => {
  it("applies the approved default budget", () => {
    expect(taskBudgetSchema.parse({})).toEqual({
      maxTurns: 40,
      maxWriteOperations: 20,
      maxReplans: 2,
      maxConcurrentWorkers: 3,
      wallClockMs: 5_400_000,
    });
  });

  it("rejects empty objectives", () => {
    const result = createTaskRequestSchema.safeParse({
      projectId: createProjectId(),
      objective: "   ",
    });
    expect(result.success).toBe(false);
  });
});

describe("event protocol", () => {
  it("round-trips a versioned event envelope", () => {
    const event = {
      protocolVersion: 1 as const,
      cursor: 1,
      taskId: createTaskId(),
      runId: createTaskRunId(),
      type: "DIAGNOSTIC" as const,
      occurredAt: new Date().toISOString(),
      payload: { message: "ready" },
    };
    expect(eventEnvelopeSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
});
