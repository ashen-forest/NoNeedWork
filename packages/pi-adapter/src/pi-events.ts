import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { NoNeedWorkPiEvent } from "./types.js";

function messageRole(
  event: Extract<AgentSessionEvent, { type: "message_start" | "message_end" }>,
): string {
  return event.message.role;
}

export function normalizePiEvent(event: AgentSessionEvent): NoNeedWorkPiEvent {
  switch (event.type) {
    case "agent_start":
      return { type: "agent.started" };
    case "agent_end":
      return { type: "agent.finished", willRetry: event.willRetry };
    case "agent_settled":
      return { type: "agent.settled" };
    case "turn_start":
      return { type: "turn.started" };
    case "turn_end":
      return { type: "turn.finished" };
    case "message_start":
      return { type: "message.started", role: messageRole(event) };
    case "message_end":
      return { type: "message.finished", role: messageRole(event) };
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return { type: "output.delta", delta: event.assistantMessageEvent.delta };
      }
      return { type: "pi.event", name: `message_update.${event.assistantMessageEvent.type}` };
    case "tool_execution_start":
      return {
        type: "tool.started",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
    case "tool_execution_update":
      return {
        type: "tool.updated",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        partialResult: event.partialResult,
      };
    case "tool_execution_end":
      return {
        type: "tool.finished",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
    case "queue_update":
      return {
        type: "queue.changed",
        steering: event.steering.length,
        followUp: event.followUp.length,
      };
    case "compaction_start":
      return { type: "compaction.started", reason: event.reason };
    case "compaction_end":
      return {
        type: "compaction.finished",
        reason: event.reason,
        aborted: event.aborted,
        willRetry: event.willRetry,
      };
    case "auto_retry_start":
      return {
        type: "retry.started",
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
      };
    case "auto_retry_end":
      return { type: "retry.finished", success: event.success, attempt: event.attempt };
    default:
      return { type: "pi.event", name: event.type };
  }
}
