import { MODEL_PROFILE_IDS, type ModelProfileId, modelProfileIdSchema } from "@noneedwork/protocol";

export const MODEL_CREDENTIAL_SERVICE = "NoNeedWork/model-provider" as const;
export const MODEL_CREDENTIAL_ACCOUNTS = MODEL_PROFILE_IDS;

export function modelCredentialAccount(rawProfileId: ModelProfileId): ModelProfileId {
  return modelProfileIdSchema.parse(rawProfileId);
}
