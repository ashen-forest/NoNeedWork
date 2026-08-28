import { createHash } from "node:crypto";

import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { ToolOperationRepository } from "../storage/repositories/tool-operation-repository.js";
import type { CheckpointService } from "../tasks/checkpoint-service.js";
import type { ToolContext } from "./tool-context.js";
import type { ToolResult } from "./tool-result.js";

export class ToolAudit {
  constructor(
    private readonly operations: ToolOperationRepository,
    private readonly artifacts: ArtifactStore,
    private readonly checkpoints: CheckpointService,
  ) {}

  async dispatch(
    toolName: string,
    input: unknown,
    context: ToolContext,
    execute: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const taskId = requireContext(context.taskId, "taskId");
    const runId = requireContext(context.runId, "runId");
    const toolCallId = requireContext(context.toolCallId, "toolCallId");
    const argsJson = canonicalJson(input);
    const operation = this.operations.createIntent({
      runId,
      ...(context.stepId ? { stepId: context.stepId } : {}),
      toolCallId,
      capability: toolName,
      argsHash: createHash("sha256").update(argsJson).digest("hex"),
      args: input,
    });
    this.operations.markStarted(operation.id);

    let result: ToolResult;
    try {
      result = await execute();
    } catch (error) {
      const failure: ToolResult = {
        ok: false,
        content: "Tool execution ended without a known durable outcome",
        details: {
          error: error instanceof Error ? error.message : String(error),
          unknownOutcome: true,
        },
      };
      const artifact = await this.persistResult(runId, operation.id, toolName, failure);
      this.operations.markUnknown(operation.id, artifact.id);
      this.checkpoints.record(runId, "TOOL_UNKNOWN_OUTCOME", {
        taskId,
        stepId: context.stepId ?? null,
        toolCallId,
        operationId: operation.id,
        resultArtifactId: artifact.id,
      });
      throw error;
    }
    const artifact = await this.persistResult(runId, operation.id, toolName, result);
    this.operations.markFinished(operation.id, artifact.id);
    this.checkpoints.record(runId, "TOOL_OBSERVATION", {
      taskId,
      stepId: context.stepId ?? null,
      toolCallId,
      operationId: operation.id,
      resultArtifactId: artifact.id,
    });
    return result;
  }

  private async persistResult(
    runId: string,
    operationId: string,
    toolName: string,
    result: ToolResult,
  ) {
    const artifact = await this.artifacts.put({
      taskRunId: runId,
      name: `tool-${operationId}.json`,
      mediaType: "application/json",
      bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, toolName, result }, null, 2)),
      producer: `tool:${toolName}`,
    });
    return artifact;
  }
}

function requireContext(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Side-effecting tool requires ${name} in ToolContext`);
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}
