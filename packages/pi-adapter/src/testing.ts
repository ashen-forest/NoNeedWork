import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { NoNeedWorkModel, NoNeedWorkModelRuntime } from "./types.js";

export type FauxModelTurn =
  | { text: string }
  | { toolCall: { name: string; args: Record<string, unknown> } };

export interface FauxModelHarness {
  model: NoNeedWorkModel;
  modelRuntime: NoNeedWorkModelRuntime;
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
        : fauxAssistantMessage(fauxToolCall(turn.toolCall.name, turn.toolCall.args), {
            stopReason: "toolUse",
          }),
    ),
  );
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  return { model: faux.getModel(), modelRuntime };
}
