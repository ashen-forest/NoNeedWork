import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { NoNeedWorkModelHandle } from "./model-runtime.js";
import { resolveNoNeedWorkModelIdentity } from "./provider-profiles.js";

export type FauxModelTurn =
  | { text: string }
  | { toolCall: { name: string; args: Record<string, unknown> } }
  | { error: string };

export interface FauxModelHarness {
  modelHandle: NoNeedWorkModelHandle;
}

/** Deterministic model seam for contract and integration tests only. */
export async function createFauxModelHarness(
  turns: readonly FauxModelTurn[],
): Promise<FauxModelHarness> {
  const faux = fauxProvider({ provider: "noneedwork-faux", api: "noneedwork-faux" });
  faux.setResponses(
    turns.map((turn) =>
      "text" in turn
        ? fauxAssistantMessage(turn.text)
        : "toolCall" in turn
          ? fauxAssistantMessage(fauxToolCall(turn.toolCall.name, turn.toolCall.args), {
              stopReason: "toolUse",
            })
          : fauxAssistantMessage("", { stopReason: "error", errorMessage: turn.error }),
    ),
  );
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  let disposed = false;
  const model = faux.getModel();
  return {
    modelHandle: {
      identity: resolveNoNeedWorkModelIdentity({
        profileId: "qwen-cn",
        modelId: "qwen3.7-plus",
      }),
      createSessionModelOptions: () => {
        if (disposed) throw new Error("Faux model handle is disposed");
        return { model, modelRuntime };
      },
      dispose: async () => {
        disposed = true;
      },
    },
  };
}
