import { z } from "zod";

import { taskRunIdSchema } from "./ids.js";

export const MODEL_PROFILE_IDS = ["qwen-cn", "minimax-cn"] as const;
export const PI_MODEL_PROVIDER_IDS = ["qwen-token-plan-cn", "minimax-cn"] as const;
export const PI_SDK_VERSION = "0.84.3" as const;

const nonnegativeInt32Schema = z.number().int().min(0).max(2_147_483_647);
const modelIdSchema = z.string().trim().min(1).max(256);

export const modelProfileIdSchema = z.enum(MODEL_PROFILE_IDS);
export const piModelProviderIdSchema = z.enum(PI_MODEL_PROVIDER_IDS);

export const modelSelectionSchema = z
  .object({
    profileId: modelProfileIdSchema,
    modelId: modelIdSchema,
  })
  .strict();

export const modelCapabilitiesSchema = z
  .object({
    text: z.boolean(),
    thinking: z.boolean(),
    toolCalls: z.boolean(),
    images: z.boolean(),
  })
  .strict();

export const modelProfileSchema = z
  .object({
    profileId: modelProfileIdSchema,
    displayName: z.string().trim().min(1).max(128),
    defaultModelId: modelIdSchema,
    modelIds: z.array(modelIdSchema).min(1),
    capabilities: modelCapabilitiesSchema,
  })
  .strict();

export const modelProfileListSchema = z
  .object({
    profiles: z.array(modelProfileSchema).length(MODEL_PROFILE_IDS.length),
  })
  .strict();

export const modelCredentialStatusSchema = z
  .object({
    profileId: modelProfileIdSchema,
    configured: z.boolean(),
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const modelCredentialStatusListSchema = z
  .object({
    credentials: z.array(modelCredentialStatusSchema),
  })
  .strict();

export const modelCredentialSetRequestSchema = z
  .object({
    secret: z.string().trim().min(16).max(16_384),
  })
  .strict();

export const modelBlockReasonSchema = z.enum([
  "MODEL_BINDING_MISSING",
  "MODEL_CREDENTIAL_MISSING",
  "MODEL_AUTH_REJECTED",
  "MODEL_QUOTA_EXHAUSTED",
  "MODEL_RATE_LIMITED",
  "MODEL_TEMPORARILY_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "MODEL_PROTOCOL_ERROR",
  "UNKNOWN_MODEL_OUTCOME",
]);

export const modelBlockSchema = z
  .object({
    reason: modelBlockReasonSchema,
    profileId: modelProfileIdSchema,
    modelId: modelIdSchema,
    recoverable: z.boolean(),
    retryAfterMs: nonnegativeInt32Schema.optional(),
    action: z.string().trim().min(1).max(1_024),
  })
  .strict();

export const modelProbeResultSchema = z
  .object({
    profileId: modelProfileIdSchema,
    modelId: modelIdSchema,
    success: z.boolean(),
    latencyMs: nonnegativeInt32Schema,
    checks: z
      .object({
        text: z.boolean(),
        toolCall: z.boolean(),
      })
      .strict(),
    errorCode: modelBlockReasonSchema.optional(),
  })
  .strict();

export const modelSelectionSourceSchema = z.enum(["default", "task_override"]);

export const taskModelBindingSchema = z
  .object({
    runId: taskRunIdSchema,
    profileId: modelProfileIdSchema,
    piProviderId: piModelProviderIdSchema,
    modelId: modelIdSchema,
    piSdkVersion: z.literal(PI_SDK_VERSION),
    selectionSource: modelSelectionSourceSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ModelProfileId = z.infer<typeof modelProfileIdSchema>;
export type PiModelProviderId = z.infer<typeof piModelProviderIdSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelProfileList = z.infer<typeof modelProfileListSchema>;
export type ModelCredentialStatus = z.infer<typeof modelCredentialStatusSchema>;
export type ModelCredentialStatusList = z.infer<typeof modelCredentialStatusListSchema>;
export type ModelCredentialSetRequest = z.infer<typeof modelCredentialSetRequestSchema>;
export type ModelBlockReason = z.infer<typeof modelBlockReasonSchema>;
export type ModelBlock = z.infer<typeof modelBlockSchema>;
export type ModelProbeResult = z.infer<typeof modelProbeResultSchema>;
export type ModelSelectionSource = z.infer<typeof modelSelectionSourceSchema>;
export type TaskModelBinding = z.infer<typeof taskModelBindingSchema>;
