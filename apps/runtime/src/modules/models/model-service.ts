import {
  createNoNeedWorkModelHandle,
  listNoNeedWorkModelProfiles,
  type NoNeedWorkModelHandle,
  type NoNeedWorkModelIdentity,
  NoNeedWorkModelRuntimeError,
  probeNoNeedWorkModel,
  resolveNoNeedWorkModelIdentity,
} from "@noneedwork/pi-adapter";
import {
  MODEL_PROFILE_IDS,
  type ModelCredentialStatus,
  type ModelProbeResult,
  type ModelProfile,
  type ModelProfileId,
  type ModelSelection,
  modelCredentialSetRequestSchema,
  modelCredentialStatusListSchema,
  modelProfileIdSchema,
  PI_SDK_VERSION,
  type TaskModelBinding,
  taskModelBindingSchema,
} from "@noneedwork/protocol";

import type { CredentialVault } from "../credentials/credential-vault.js";
import type { ModelBindingRepository } from "./model-binding-repository.js";
import { createModelBlock, ModelBlockedError } from "./model-errors.js";
import type { ModelPreferenceRepository } from "./model-preference-repository.js";
import {
  assertModelSelectionAvailable,
  DEFAULT_MODEL_SELECTION,
  validateModelProfiles,
} from "./model-profile.js";
import {
  type ResolvedTaskModelSelection,
  resolvedTaskModelSelectionSchema,
} from "./model-selection.js";

export interface RuntimeModelAdapter {
  listProfiles(): readonly ModelProfile[];
  resolveIdentity(selection: ModelSelection): NoNeedWorkModelIdentity;
  createHandle(options: {
    selection: ModelSelection;
    credential: string;
  }): Promise<NoNeedWorkModelHandle>;
  probe(options: { handle: NoNeedWorkModelHandle; timeoutMs?: number }): Promise<ModelProbeResult>;
}

export interface ModelBindingReader {
  get(runId: string): TaskModelBinding | undefined;
}

export interface ModelServiceOptions {
  preferences: ModelPreferenceRepository;
  bindings: ModelBindingReader | ModelBindingRepository;
  credentials: CredentialVault;
  adapter?: RuntimeModelAdapter;
}

const defaultAdapter: RuntimeModelAdapter = {
  listProfiles: listNoNeedWorkModelProfiles,
  resolveIdentity: resolveNoNeedWorkModelIdentity,
  createHandle: createNoNeedWorkModelHandle,
  probe: probeNoNeedWorkModel,
};

export class ModelService {
  readonly #preferences: ModelPreferenceRepository;
  readonly #bindings: ModelBindingReader;
  readonly #credentials: CredentialVault;
  readonly #adapter: RuntimeModelAdapter;
  readonly #profiles: readonly ModelProfile[];

  constructor(options: ModelServiceOptions) {
    this.#preferences = options.preferences;
    this.#bindings = options.bindings;
    this.#credentials = options.credentials;
    this.#adapter = options.adapter ?? defaultAdapter;
    this.#profiles = validateModelProfiles(this.#adapter.listProfiles());
  }

  listProfiles(): readonly ModelProfile[] {
    return this.#profiles.map((profile) => ({
      ...profile,
      modelIds: [...profile.modelIds],
      capabilities: { ...profile.capabilities },
    }));
  }

  getDefaultSelection(): ModelSelection {
    const stored = this.#preferences.get();
    return assertModelSelectionAvailable(stored ?? DEFAULT_MODEL_SELECTION, this.#profiles);
  }

  setDefaultSelection(rawSelection: ModelSelection): ModelSelection {
    const selection = assertModelSelectionAvailable(rawSelection, this.#profiles);
    this.#adapter.resolveIdentity(selection);
    return this.#preferences.set(selection);
  }

  resolveTaskSelection(rawSelection?: ModelSelection): ResolvedTaskModelSelection {
    const selection = assertModelSelectionAvailable(
      rawSelection ?? this.getDefaultSelection(),
      this.#profiles,
    );
    const identity = this.#adapter.resolveIdentity(selection);
    return resolvedTaskModelSelectionSchema.parse({
      profileId: identity.profileId,
      piProviderId: identity.piProviderId,
      modelId: identity.modelId,
      piSdkVersion: identity.piSdkVersion,
      selectionSource: rawSelection ? "task_override" : "default",
    });
  }

  getBinding(runId: string): TaskModelBinding | undefined {
    return this.#bindings.get(runId);
  }

  listCredentialStatus(): readonly ModelCredentialStatus[] {
    return modelCredentialStatusListSchema.parse({
      credentials: this.#credentials.listStatus(),
    }).credentials;
  }

  setCredential(rawProfileId: ModelProfileId, rawSecret: string): ModelCredentialStatus {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    const { secret } = modelCredentialSetRequestSchema.parse({ secret: rawSecret });
    this.#credentials.set(profileId, secret);
    return this.#credentials.status(profileId);
  }

  deleteCredential(rawProfileId: ModelProfileId): ModelCredentialStatus {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    this.#credentials.delete(profileId);
    return this.#credentials.status(profileId);
  }

  preflight(rawBinding: TaskModelBinding): TaskModelBinding {
    const candidate = rawBinding as TaskModelBinding & { piSdkVersion: string };
    if (candidate.piSdkVersion !== PI_SDK_VERSION) {
      throw this.#blocked("MODEL_UNAVAILABLE", candidate.profileId, candidate.modelId);
    }
    const binding = taskModelBindingSchema.parse(rawBinding);
    const selection = assertModelSelectionAvailable(
      { profileId: binding.profileId, modelId: binding.modelId },
      this.#profiles,
    );
    const identity = this.#adapter.resolveIdentity(selection);
    if (
      identity.piProviderId !== binding.piProviderId ||
      identity.piSdkVersion !== binding.piSdkVersion
    ) {
      throw this.#blocked("MODEL_UNAVAILABLE", binding.profileId, binding.modelId);
    }
    if (!this.#credentials.status(binding.profileId).configured) {
      throw this.#blocked("MODEL_CREDENTIAL_MISSING", binding.profileId, binding.modelId);
    }
    return binding;
  }

  async createHandle(rawBinding: TaskModelBinding): Promise<NoNeedWorkModelHandle> {
    const candidate = rawBinding as TaskModelBinding & { piSdkVersion: string };
    if (candidate.piSdkVersion !== PI_SDK_VERSION) {
      throw this.#blocked("MODEL_UNAVAILABLE", candidate.profileId, candidate.modelId);
    }
    const binding = taskModelBindingSchema.parse(rawBinding);
    const selection = assertModelSelectionAvailable(
      { profileId: binding.profileId, modelId: binding.modelId },
      this.#profiles,
    );
    const identity = this.#adapter.resolveIdentity(selection);
    if (identity.piProviderId !== binding.piProviderId) {
      throw this.#blocked("MODEL_UNAVAILABLE", binding.profileId, binding.modelId);
    }
    const credential = this.#credentials.get(binding.profileId);
    if (!credential) {
      throw this.#blocked("MODEL_CREDENTIAL_MISSING", binding.profileId, binding.modelId);
    }
    try {
      return await this.#adapter.createHandle({ selection, credential });
    } catch (error) {
      if (error instanceof NoNeedWorkModelRuntimeError) {
        const reason =
          error.code === "MODEL_UNAVAILABLE"
            ? "MODEL_UNAVAILABLE"
            : "MODEL_TEMPORARILY_UNAVAILABLE";
        throw this.#blocked(reason, binding.profileId, binding.modelId);
      }
      throw error;
    }
  }

  async probe(rawProfileId: ModelProfileId): Promise<ModelProbeResult> {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    const profile = this.#profiles.find((candidate) => candidate.profileId === profileId);
    if (!profile) throw new Error(`Unknown model profile ${profileId}`);
    const defaultSelection = this.getDefaultSelection();
    const selection = {
      profileId,
      modelId:
        defaultSelection.profileId === profileId
          ? defaultSelection.modelId
          : profile.defaultModelId,
    };
    const credential = this.#credentials.get(profileId);
    if (!credential) throw this.#blocked("MODEL_CREDENTIAL_MISSING", profileId, selection.modelId);
    const handle = await this.#adapter.createHandle({ selection, credential });
    try {
      return await this.#adapter.probe({ handle });
    } finally {
      await handle.dispose();
    }
  }

  #blocked(
    reason: Parameters<typeof createModelBlock>[0]["reason"],
    profileId: ModelProfileId,
    modelId: string,
  ): ModelBlockedError {
    return new ModelBlockedError(createModelBlock({ reason, profileId, modelId }));
  }
}

export const SUPPORTED_MODEL_PROFILE_IDS = MODEL_PROFILE_IDS;
