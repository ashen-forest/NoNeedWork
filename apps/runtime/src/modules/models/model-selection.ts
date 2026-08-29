import {
  modelProfileIdSchema,
  modelSelectionSourceSchema,
  PI_SDK_VERSION,
  piModelProviderIdSchema,
} from "@noneedwork/protocol";
import { z } from "zod";

export const resolvedTaskModelSelectionSchema = z
  .object({
    profileId: modelProfileIdSchema,
    piProviderId: piModelProviderIdSchema,
    modelId: z.string().trim().min(1).max(256),
    piSdkVersion: z.literal(PI_SDK_VERSION),
    selectionSource: modelSelectionSourceSchema,
  })
  .strict();

export type ResolvedTaskModelSelection = z.infer<typeof resolvedTaskModelSelectionSchema>;
