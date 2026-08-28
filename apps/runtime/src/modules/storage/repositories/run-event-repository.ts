import {
  type EventEnvelope,
  type EventPage,
  type EventType,
  eventEnvelopeSchema,
  eventPageSchema,
} from "@noneedwork/protocol";
import { z } from "zod";

import type { RuntimeDatabase } from "../database.js";
import { decodePersistedJson, encodePersistedJson } from "../json.js";

const eventPayloadSchema = z.record(z.string(), z.unknown());
const eventRowSchema = z.object({
  run_id: z.string(),
  sequence: z.number().int().nonnegative(),
  task_id: z.string(),
  event_type: z.string(),
  payload_json: z.string(),
  occurred_at: z.string(),
});

export class RunEventRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  append(
    taskId: string,
    runId: string,
    type: EventType,
    payload: Record<string, unknown>,
  ): EventEnvelope {
    const next = this.database.connection
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = ?")
      .get(runId) as { sequence: number };
    const occurredAt = new Date().toISOString();
    this.database.connection
      .prepare(`
        INSERT INTO run_events(run_id, sequence, task_id, event_type, payload_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(runId, next.sequence, taskId, type, encodePersistedJson(payload), occurredAt);
    return eventEnvelopeSchema.parse({
      protocolVersion: 1,
      cursor: next.sequence,
      taskId,
      runId,
      type,
      occurredAt,
      payload,
    });
  }

  list(runId: string, afterCursor = 0, limit = 200): EventPage {
    const rows = this.database.connection
      .prepare(`
        SELECT * FROM run_events
        WHERE run_id = ? AND sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
      `)
      .all(runId, afterCursor, limit)
      .map(parseEvent);
    return eventPageSchema.parse({
      events: rows,
      nextCursor: rows.at(-1)?.cursor ?? afterCursor,
    });
  }

  bounds(runId: string): { earliest: number | null; latest: number | null } {
    const row = this.database.connection
      .prepare(`
        SELECT MIN(sequence) AS earliest, MAX(sequence) AS latest
        FROM run_events WHERE run_id = ?
      `)
      .get(runId) as { earliest: number | null; latest: number | null };
    return row;
  }
}

function parseEvent(raw: unknown): EventEnvelope {
  const row = eventRowSchema.parse(raw);
  return eventEnvelopeSchema.parse({
    protocolVersion: 1,
    cursor: row.sequence,
    taskId: row.task_id,
    runId: row.run_id,
    type: row.event_type,
    occurredAt: row.occurred_at,
    payload: decodePersistedJson(row.payload_json, eventPayloadSchema),
  });
}
