import {
  createTaskRunId,
  type TaskModelBinding,
  taskModelBindingSchema,
} from "@noneedwork/protocol";

export function createTestModelBinding(
  overrides: Partial<TaskModelBinding> = {},
): TaskModelBinding {
  return taskModelBindingSchema.parse({
    runId: createTaskRunId(),
    profileId: "qwen-cn",
    piProviderId: "qwen-token-plan-cn",
    modelId: "qwen3.7-plus",
    piSdkVersion: "0.84.3",
    selectionSource: "default",
    createdAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  });
}
