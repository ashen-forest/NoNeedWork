import {
  type ModelBlock,
  type ModelBlockReason,
  type ModelProfileId,
  modelBlockSchema,
} from "@noneedwork/protocol";

const ACTIONS: Record<ModelBlockReason, string> = {
  MODEL_BINDING_MISSING: "Create a new TaskRun with an explicit model binding.",
  MODEL_CREDENTIAL_MISSING: "Configure the provider credential and resume the task.",
  MODEL_AUTH_REJECTED: "Replace the rejected provider credential and resume the task.",
  MODEL_QUOTA_EXHAUSTED: "Restore provider quota, then resume the task.",
  MODEL_RATE_LIMITED: "Wait for the provider limit to reset, then resume the task.",
  MODEL_TEMPORARILY_UNAVAILABLE: "Wait for the provider to recover, then resume the task.",
  MODEL_UNAVAILABLE: "Create a new TaskRun with a model available in the locked PI catalog.",
  MODEL_PROTOCOL_ERROR: "Review the provider protocol diagnostics before starting a new TaskRun.",
  UNKNOWN_MODEL_OUTCOME:
    "Review partial model output before deciding whether to start a new TaskRun.",
};

export interface CreateModelBlockOptions {
  reason: ModelBlockReason;
  profileId: ModelProfileId;
  modelId: string;
  retryAfterMs?: number;
}

export function createModelBlock(options: CreateModelBlockOptions): ModelBlock {
  const recoverable = options.reason !== "MODEL_PROTOCOL_ERROR";
  return modelBlockSchema.parse({
    reason: options.reason,
    profileId: options.profileId,
    modelId: options.modelId,
    recoverable,
    ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
    action: ACTIONS[options.reason],
  });
}

export class ModelBlockedError extends Error {
  constructor(readonly modelBlock: ModelBlock) {
    super(`Model execution blocked: ${modelBlock.reason}`);
    this.name = "ModelBlockedError";
  }
}
