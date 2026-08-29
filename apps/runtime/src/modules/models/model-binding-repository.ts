import {
  type TaskModelBinding,
  taskModelBindingSchema,
  taskRunIdSchema,
} from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../storage/database.js";

const taskRunModelRowSchema = z
  .object({
    run_id: z.string(),
    profile_id: z.string(),
    pi_provider_id: z.string(),
    model_id: z.string(),
    pi_sdk_version: z.string(),
    selection_source: z.string(),
    created_at: z.string(),
  })
  .strict();

const taskRunStatusRowSchema = z.object({ status: z.string() }).strict();

export class ModelBindingRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  insert(rawBinding: TaskModelBinding): TaskModelBinding {
    const binding = taskModelBindingSchema.parse(rawBinding);
    if (this.get(binding.runId)) {
      throw new Error(`TaskRun ${binding.runId} already has a model binding`);
    }
    const rawRun = this.database.connection
      .prepare("SELECT status FROM task_runs WHERE id = ?")
      .get(binding.runId);
    if (!rawRun) throw new Error(`Unknown TaskRun ${binding.runId}`);
    const run = taskRunStatusRowSchema.parse(rawRun);
    if (run.status !== "CREATED") {
      throw new Error(`TaskRun ${binding.runId} must be CREATED before model binding`);
    }

    this.database.connection
      .prepare(`
        INSERT INTO task_run_models(
          run_id, profile_id, pi_provider_id, model_id,
          pi_sdk_version, selection_source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        binding.runId,
        binding.profileId,
        binding.piProviderId,
        binding.modelId,
        binding.piSdkVersion,
        binding.selectionSource,
        binding.createdAt,
      );
    const stored = this.get(binding.runId);
    if (!stored) throw new Error(`TaskRun ${binding.runId} model binding disappeared after insert`);
    return stored;
  }

  get(rawRunId: string): TaskModelBinding | undefined {
    const runId = taskRunIdSchema.parse(rawRunId);
    const raw = this.database.connection
      .prepare("SELECT * FROM task_run_models WHERE run_id = ?")
      .get(runId);
    if (!raw) return undefined;
    const row = taskRunModelRowSchema.parse(raw);
    return taskModelBindingSchema.parse({
      runId: row.run_id,
      profileId: row.profile_id,
      piProviderId: row.pi_provider_id,
      modelId: row.model_id,
      piSdkVersion: row.pi_sdk_version,
      selectionSource: row.selection_source,
      createdAt: row.created_at,
    });
  }
}
