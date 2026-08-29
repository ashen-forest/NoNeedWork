import {
  type ModelSelection,
  modelProfileIdSchema,
  modelSelectionSchema,
} from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../storage/database.js";

const preferenceRowSchema = z
  .object({
    id: z.literal("default"),
    profile_id: modelProfileIdSchema,
    model_id: z.string().trim().min(1).max(256),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export class ModelPreferenceRepository {
  constructor(
    private readonly database: RuntimeDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): ModelSelection | undefined {
    const raw = this.database.connection
      .prepare("SELECT * FROM model_preferences WHERE id = 'default'")
      .get();
    if (!raw) return undefined;
    const row = preferenceRowSchema.parse(raw);
    return modelSelectionSchema.parse({ profileId: row.profile_id, modelId: row.model_id });
  }

  set(rawSelection: ModelSelection): ModelSelection {
    const selection = modelSelectionSchema.parse(rawSelection);
    const updatedAt = this.now().toISOString();
    this.database.connection
      .prepare(`
        INSERT INTO model_preferences(id, profile_id, model_id, updated_at)
        VALUES ('default', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          profile_id = excluded.profile_id,
          model_id = excluded.model_id,
          updated_at = excluded.updated_at
      `)
      .run(selection.profileId, selection.modelId, updatedAt);
    const stored = this.get();
    if (!stored) throw new Error("Default model preference disappeared after write");
    return stored;
  }
}
