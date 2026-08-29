import { describe, expect, it } from "vitest";
import {
  createProjectId,
  createTaskId,
  createTaskRequestSchema,
  createTaskRunId,
  eventEnvelopeSchema,
  modelBlockSchema,
  modelCredentialSetRequestSchema,
  modelCredentialStatusSchema,
  modelProbeResultSchema,
  modelProfileIdSchema,
  modelProfileSchema,
  modelSelectionSchema,
  projectIdSchema,
  taskBudgetSchema,
  taskModelBindingSchema,
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

describe("model protocol", () => {
  const now = "2026-08-29T00:00:00.000Z";

  it("accepts only the two v0.1 profile identifiers", () => {
    expect(modelProfileIdSchema.options).toEqual(["qwen-cn", "minimax-cn"]);
    expect(modelProfileIdSchema.safeParse("openai").success).toBe(false);
  });

  it("validates a model selection and write-only credential request", () => {
    expect(modelSelectionSchema.parse({ profileId: "qwen-cn", modelId: "qwen3.7-plus" })).toEqual({
      profileId: "qwen-cn",
      modelId: "qwen3.7-plus",
    });
    expect(modelCredentialSetRequestSchema.parse({ secret: `  ${"x".repeat(16)}  ` })).toEqual({
      secret: "x".repeat(16),
    });
    expect(modelCredentialSetRequestSchema.safeParse({ secret: "too-short" }).success).toBe(false);
  });

  it("rejects secret-bearing public model responses", () => {
    const publicValues = [
      [
        modelProfileSchema,
        {
          profileId: "qwen-cn",
          displayName: "Qwen Token Plan CN",
          defaultModelId: "qwen3.7-plus",
          modelIds: ["qwen3.7-plus"],
          capabilities: { text: true, thinking: true, toolCalls: true, images: false },
        },
      ],
      [modelCredentialStatusSchema, { profileId: "qwen-cn", configured: true, updatedAt: now }],
      [
        modelProbeResultSchema,
        {
          profileId: "qwen-cn",
          modelId: "qwen3.7-plus",
          success: true,
          latencyMs: 10,
          checks: { text: true, toolCall: true },
        },
      ],
      [
        modelBlockSchema,
        {
          reason: "MODEL_CREDENTIAL_MISSING",
          profileId: "qwen-cn",
          modelId: "qwen3.7-plus",
          recoverable: true,
          action: "Configure the credential and resume the task.",
        },
      ],
      [
        taskModelBindingSchema,
        {
          runId: createTaskRunId(),
          profileId: "qwen-cn",
          piProviderId: "qwen-token-plan-cn",
          modelId: "qwen3.7-plus",
          piSdkVersion: "0.84.3",
          selectionSource: "default",
          createdAt: now,
        },
      ],
    ] as const;

    for (const [schema, value] of publicValues) {
      expect(schema.safeParse({ ...value, secret: "must-not-pass" }).success).toBe(false);
    }
  });

  it("bounds block reasons and integer timing fields", () => {
    expect(
      modelBlockSchema.safeParse({
        reason: "SOME_PROVIDER_ERROR",
        profileId: "qwen-cn",
        modelId: "qwen3.7-plus",
        recoverable: true,
        action: "Retry",
      }).success,
    ).toBe(false);
    expect(
      modelProbeResultSchema.safeParse({
        profileId: "qwen-cn",
        modelId: "qwen3.7-plus",
        success: true,
        latencyMs: 2 ** 31,
        checks: { text: true, toolCall: true },
      }).success,
    ).toBe(false);
  });
});
