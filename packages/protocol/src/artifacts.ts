import { z } from "zod";
import { artifactIdSchema, taskRunIdSchema } from "./ids.js";

export const artifactSchema = z.object({
  id: artifactIdSchema,
  taskRunId: taskRunIdSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mediaType: z.string().min(1),
  size: z.number().int().nonnegative(),
  name: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
});

export type Artifact = z.infer<typeof artifactSchema>;
