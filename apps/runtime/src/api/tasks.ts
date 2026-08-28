import {
  createTaskRequestSchema,
  taskControlRequestSchema,
  taskDetailsSchema,
  taskIdSchema,
} from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { RuntimeServices } from "../services.js";

const taskParamsSchema = z.object({ taskId: taskIdSchema });

export function registerTaskRoutes(app: FastifyInstance, services: RuntimeServices): void {
  app.post("/v1/tasks", async (request, reply) => {
    const input = createTaskRequestSchema.parse(request.body);
    const details = services.taskService.create(input);
    if (services.autoStartTasks) services.taskRunner.start(details.task.id);
    return reply.code(201).send(taskDetailsSchema.parse(details));
  });

  app.get("/v1/tasks/:taskId", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const details = services.taskService.get(taskId);
    if (!details) return reply.code(404).send({ error: "Task not found" });
    return taskDetailsSchema.parse(details);
  });

  app.post("/v1/tasks/:taskId/control", async (request) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const { action } = taskControlRequestSchema.parse(request.body);
    const details = services.taskService.control(taskId, action);
    if (action === "resume") services.taskRunner.start(taskId);
    else await services.taskRunner.cancelActive(taskId);
    return taskDetailsSchema.parse(details);
  });
}
