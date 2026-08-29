import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import {
  type ModelProfile,
  type ModelProfileId,
  type ModelSelection,
  modelProfileListSchema,
  modelSelectionSchema,
  PI_SDK_VERSION,
  type PiModelProviderId,
} from "@noneedwork/protocol";

type SupportedModelApi = "openai-completions" | "anthropic-messages";

export interface NoNeedWorkModelIdentity {
  profileId: ModelProfileId;
  piProviderId: PiModelProviderId;
  modelId: string;
  piSdkVersion: typeof PI_SDK_VERSION;
  api: SupportedModelApi;
}

interface ProviderProfileDefinition {
  profileId: ModelProfileId;
  displayName: string;
  piProviderId: PiModelProviderId;
  defaultModelId: string;
  api: SupportedModelApi;
}

const PROVIDER_PROFILES = [
  {
    profileId: "qwen-cn",
    displayName: "Qwen Token Plan CN",
    piProviderId: "qwen-token-plan-cn",
    defaultModelId: "qwen3.7-plus",
    api: "openai-completions",
  },
  {
    profileId: "minimax-cn",
    displayName: "MiniMax Token Plan CN",
    piProviderId: "minimax-cn",
    defaultModelId: "MiniMax-M3",
    api: "anthropic-messages",
  },
] as const satisfies readonly ProviderProfileDefinition[];

function definitionFor(profileId: ModelProfileId): ProviderProfileDefinition {
  const definition = PROVIDER_PROFILES.find((candidate) => candidate.profileId === profileId);
  if (!definition) throw new Error(`Unsupported NoNeedWork model profile: ${profileId}`);
  return definition;
}

function modelsFor(definition: ProviderProfileDefinition) {
  const models =
    definition.piProviderId === "qwen-token-plan-cn"
      ? getBuiltinModels("qwen-token-plan-cn")
      : getBuiltinModels("minimax-cn");
  const compatible = models.filter((model) => model.api === definition.api);
  if (compatible.length === 0) {
    throw new Error(`PI static catalog is empty for ${definition.profileId}`);
  }
  if (!compatible.some((model) => model.id === definition.defaultModelId)) {
    throw new Error(`PI static catalog is missing default model for ${definition.profileId}`);
  }
  return compatible;
}

export function listNoNeedWorkModelProfiles(): readonly ModelProfile[] {
  return modelProfileListSchema.parse({
    profiles: PROVIDER_PROFILES.map((definition) => {
      const models = modelsFor(definition);
      return {
        profileId: definition.profileId,
        displayName: definition.displayName,
        defaultModelId: definition.defaultModelId,
        modelIds: models.map((model) => model.id),
        capabilities: {
          text: true,
          thinking: models.some((model) => model.reasoning),
          toolCalls: true,
          images: models.some((model) => model.input.includes("image")),
        },
      };
    }),
  }).profiles;
}

export function resolveNoNeedWorkModelIdentity(
  rawSelection: ModelSelection,
): NoNeedWorkModelIdentity {
  const selection = modelSelectionSchema.parse(rawSelection);
  const definition = definitionFor(selection.profileId);
  const model = modelsFor(definition).find((candidate) => candidate.id === selection.modelId);
  if (!model) {
    throw new Error(`Model ${selection.modelId} is not available for ${selection.profileId}`);
  }
  return {
    profileId: definition.profileId,
    piProviderId: definition.piProviderId,
    modelId: model.id,
    piSdkVersion: PI_SDK_VERSION,
    api: definition.api,
  };
}
