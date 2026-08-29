import {
  type ModelProfile,
  type ModelSelection,
  modelProfileListSchema,
  modelSelectionSchema,
} from "@noneedwork/protocol";

export const DEFAULT_MODEL_SELECTION: ModelSelection = {
  profileId: "qwen-cn",
  modelId: "qwen3.7-plus",
};

export class ModelSelectionError extends Error {
  constructor() {
    super("Selected model is not available for the profile");
    this.name = "ModelSelectionError";
  }
}

export function validateModelProfiles(
  rawProfiles: readonly ModelProfile[],
): readonly ModelProfile[] {
  return modelProfileListSchema.parse({ profiles: rawProfiles }).profiles;
}

export function assertModelSelectionAvailable(
  rawSelection: ModelSelection,
  profiles: readonly ModelProfile[],
): ModelSelection {
  const selection = modelSelectionSchema.parse(rawSelection);
  const profile = profiles.find((candidate) => candidate.profileId === selection.profileId);
  if (!profile?.modelIds.includes(selection.modelId)) {
    throw new ModelSelectionError();
  }
  return selection;
}
