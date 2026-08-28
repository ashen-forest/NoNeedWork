import { artifactIdSchema, artifactListSchema, taskIdSchema } from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { RuntimeServices } from "../services.js";

const artifactParamsSchema = z.object({ artifactId: artifactIdSchema });
const taskParamsSchema = z.object({ taskId: taskIdSchema });

export function registerArtifactRoutes(app: FastifyInstance, services: RuntimeServices): void {
  app.get("/v1/tasks/:taskId/artifacts", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const details = services.taskService.get(taskId);
    if (!details?.run) return reply.code(404).send({ error: "Task not found" });
    return artifactListSchema.parse({
      artifacts: services.tasks.artifacts.listByRun(details.run.id),
    });
  });

  app.get("/v1/artifacts/:artifactId", async (request, reply) => {
    const { artifactId } = artifactParamsSchema.parse(request.params);
    const artifact = services.tasks.artifacts.get(artifactId);
    if (!artifact) return reply.code(404).send({ error: "Artifact not found" });
    const { bytes } = await services.artifactStore.read(artifact.id);
    return reply
      .header("content-type", artifact.mediaType)
      .header("content-length", String(bytes.length))
      .header("content-disposition", `attachment; filename=${JSON.stringify(artifact.name)}`)
      .send(bytes);
  });
}
