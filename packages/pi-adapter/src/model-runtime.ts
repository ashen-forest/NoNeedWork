import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type ModelSelection,
  modelCredentialSetRequestSchema,
  modelSelectionSchema,
} from "@noneedwork/protocol";

import {
  type NoNeedWorkModelIdentity,
  resolveNoNeedWorkModelIdentity,
} from "./provider-profiles.js";

export interface ModelLike {
  id: string;
  provider: string;
  api: string;
  [key: string]: unknown;
}

export interface ModelRuntimeLike {
  setRuntimeApiKey(providerId: string, credential: string): Promise<void>;
  removeRuntimeApiKey(providerId: string): Promise<void>;
  getModel(providerId: string, modelId: string): ModelLike | undefined;
  streamSimple(...args: unknown[]): unknown;
}

export interface ModelRuntimeCreationOptions {
  credentials: InMemoryCredentialStore;
  modelsPath: null;
  allowModelNetwork: false;
  refreshOnCreate: false;
}

export interface ModelRuntimeLikeFactory {
  create(options: ModelRuntimeCreationOptions): Promise<ModelRuntimeLike>;
}

export interface NoNeedWorkSessionModelOptions {
  model: unknown;
  modelRuntime: unknown;
}

export interface NoNeedWorkModelHandle {
  readonly identity: NoNeedWorkModelIdentity;
  createSessionModelOptions(): NoNeedWorkSessionModelOptions;
  dispose(): Promise<void>;
}

export type NoNeedWorkModelRuntimeErrorCode =
  | "MODEL_RUNTIME_INITIALIZATION_FAILED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_HANDLE_DISPOSED"
  | "MODEL_RUNTIME_DISPOSE_FAILED";

const MODEL_RUNTIME_ERROR_MESSAGES: Record<NoNeedWorkModelRuntimeErrorCode, string> = {
  MODEL_RUNTIME_INITIALIZATION_FAILED: "Model runtime initialization failed",
  MODEL_UNAVAILABLE: "Configured model is unavailable",
  MODEL_HANDLE_DISPOSED: "Model handle is disposed",
  MODEL_RUNTIME_DISPOSE_FAILED: "Model runtime disposal failed",
};

export class NoNeedWorkModelRuntimeError extends Error {
  constructor(readonly code: NoNeedWorkModelRuntimeErrorCode) {
    super(MODEL_RUNTIME_ERROR_MESSAGES[code]);
    this.name = "NoNeedWorkModelRuntimeError";
  }
}

export interface CreateNoNeedWorkModelHandleOptions {
  selection: ModelSelection;
  credential: string;
}

export interface CreateNoNeedWorkModelHandleDependencies {
  runtimeFactory?: ModelRuntimeLikeFactory;
}

const defaultRuntimeFactory: ModelRuntimeLikeFactory = {
  create: async (options) => (await ModelRuntime.create(options)) as unknown as ModelRuntimeLike,
};

export async function createNoNeedWorkModelHandle(
  rawOptions: CreateNoNeedWorkModelHandleOptions,
  dependencies: CreateNoNeedWorkModelHandleDependencies = {},
): Promise<NoNeedWorkModelHandle> {
  let selection: ModelSelection;
  let credential: string;
  let identity: NoNeedWorkModelIdentity;
  try {
    selection = modelSelectionSchema.parse(rawOptions.selection);
    credential = modelCredentialSetRequestSchema.parse({ secret: rawOptions.credential }).secret;
    identity = resolveNoNeedWorkModelIdentity(selection);
  } catch {
    throw new NoNeedWorkModelRuntimeError("MODEL_RUNTIME_INITIALIZATION_FAILED");
  }

  const credentials = new InMemoryCredentialStore();
  let runtime: ModelRuntimeLike;
  try {
    runtime = await (dependencies.runtimeFactory ?? defaultRuntimeFactory).create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
  } catch {
    throw new NoNeedWorkModelRuntimeError("MODEL_RUNTIME_INITIALIZATION_FAILED");
  }

  let keyInstalled = false;
  try {
    await runtime.setRuntimeApiKey(identity.piProviderId, credential);
    keyInstalled = true;
    const model = runtime.getModel(identity.piProviderId, identity.modelId);
    if (!model || model.api !== identity.api) {
      throw new NoNeedWorkModelRuntimeError("MODEL_UNAVAILABLE");
    }

    let disposed = false;
    let disposePromise: Promise<void> | undefined;
    return {
      identity,
      createSessionModelOptions: () => {
        if (disposed) throw new NoNeedWorkModelRuntimeError("MODEL_HANDLE_DISPOSED");
        return { model, modelRuntime: runtime };
      },
      dispose: () => {
        disposePromise ??= (async () => {
          disposed = true;
          try {
            await runtime.removeRuntimeApiKey(identity.piProviderId);
          } catch {
            throw new NoNeedWorkModelRuntimeError("MODEL_RUNTIME_DISPOSE_FAILED");
          }
        })();
        return disposePromise;
      },
    };
  } catch (error) {
    if (keyInstalled) {
      try {
        await runtime.removeRuntimeApiKey(identity.piProviderId);
      } catch {
        // The public initialization error remains constant and secret-free.
      }
    }
    if (error instanceof NoNeedWorkModelRuntimeError) throw error;
    throw new NoNeedWorkModelRuntimeError("MODEL_RUNTIME_INITIALIZATION_FAILED");
  }
}
