import { z } from "zod";

import { projectIdSchema } from "./ids.js";

export const openProjectRequestSchema = z.object({
  path: z.string().trim().min(1).max(32_768),
});

export const projectSchema = z.object({
  id: projectIdSchema,
  rootPath: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const projectListSchema = z.object({ projects: z.array(projectSchema) });

export type OpenProjectRequest = z.infer<typeof openProjectRequestSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectList = z.infer<typeof projectListSchema>;
