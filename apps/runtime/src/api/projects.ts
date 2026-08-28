import { openProjectRequestSchema, projectListSchema } from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";

import type { RuntimeServices } from "../services.js";

export function registerProjectRoutes(app: FastifyInstance, services: RuntimeServices): void {
  app.post("/v1/projects/open", async (request, reply) => {
    const input = openProjectRequestSchema.parse(request.body);
    const project = await services.projectService.open(input.path);
    return reply.code(201).send(project);
  });

  app.get("/v1/projects", async () =>
    projectListSchema.parse({ projects: services.projects.list() }),
  );
}
