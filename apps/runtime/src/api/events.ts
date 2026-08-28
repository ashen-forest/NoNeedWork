import {
  eventPageSchema,
  eventStreamFrameSchema,
  taskDetailsSchema,
  taskIdSchema,
} from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { RuntimeServices } from "../services.js";

const eventParamsSchema = z.object({ taskId: taskIdSchema });
const eventQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function registerEventRoutes(app: FastifyInstance, services: RuntimeServices): void {
  app.get("/v1/tasks/:taskId/events", async (request, reply) => {
    const { taskId } = eventParamsSchema.parse(request.params);
    const query = eventQuerySchema.parse(request.query);
    const details = services.taskService.get(taskId);
    if (!details?.run) return reply.code(404).send({ error: "Task not found" });
    return eventPageSchema.parse(
      services.tasks.runs.events.list(details.run.id, query.after, query.limit),
    );
  });

  app.get("/v1/tasks/:taskId/events/stream", { websocket: true }, (socket, request) => {
    const { taskId } = eventParamsSchema.parse(request.params);
    const { after } = eventQuerySchema.parse(request.query);
    const details = services.taskService.get(taskId);
    if (!details?.run) {
      socket.close(1008, "Task not found");
      return;
    }
    const runId = details.run.id;
    const bounds = services.tasks.runs.events.bounds(runId);
    const cursorExpired = after > 0 && bounds.earliest !== null && after < bounds.earliest - 1;
    let cursor = cursorExpired ? (bounds.latest ?? 0) : after;
    if (after === 0 || cursorExpired) {
      socket.send(
        JSON.stringify(
          eventStreamFrameSchema.parse({
            protocolVersion: 1,
            kind: "snapshot",
            reason: cursorExpired ? "cursor_expired" : "initial",
            cursor,
            snapshot: taskDetailsSchema.parse(details),
          }),
        ),
      );
    }
    const flush = () => {
      if (socket.readyState !== socket.OPEN) return;
      for (;;) {
        const page = services.tasks.runs.events.list(runId, cursor, 500);
        for (const event of page.events) {
          socket.send(
            JSON.stringify(
              eventStreamFrameSchema.parse({
                protocolVersion: 1,
                kind: "event",
                event,
              }),
            ),
          );
        }
        cursor = page.nextCursor;
        if (page.events.length < 500) break;
      }
    };
    flush();
    const interval = setInterval(flush, 250);
    interval.unref();
    socket.once("close", () => clearInterval(interval));
  });
}
