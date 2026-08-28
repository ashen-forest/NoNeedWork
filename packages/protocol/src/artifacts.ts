import { z } from "zod";
import { artifactIdSchema, taskRunIdSchema } from "./ids.js";

export const artifactSchema = z.object({
  id: artifactIdSchema,
  taskRunId: taskRunIdSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mediaType: z.string().min(1),
  size: z.number().int().nonnegative(),
  name: z.string().min(1),
  retention: z.enum(["task", "release", "permanent"]).default("task"),
  createdAt: z.iso.datetime({ offset: true }),
});

export const artifactListSchema = z.object({ artifacts: z.array(artifactSchema) });

export type Artifact = z.infer<typeof artifactSchema>;
export type ArtifactList = z.infer<typeof artifactListSchema>;
