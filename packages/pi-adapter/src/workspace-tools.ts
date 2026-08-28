import { type TSchema, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

import type { NoNeedWorkTool, WorkspaceToolDispatcher } from "./types.js";

interface WorkspaceToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
}

const pathSchema = Type.String({
  minLength: 1,
  maxLength: 4096,
  description: "Workspace-relative path using forward slashes",
});
const argvSchema = Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
  minItems: 1,
  maxItems: 50,
});

const definitions: readonly WorkspaceToolDefinition[] = [
  {
    name: "read_file",
    label: "Read File",
    description: "Read a UTF-8 file from the isolated task workspace.",
    parameters: Type.Object({ path: pathSchema, maxBytes: Type.Optional(Type.Integer()) }),
  },
  {
    name: "list_files",
    label: "List Files",
    description: "List files below a workspace-relative directory in the isolated workspace.",
    parameters: Type.Object({
      path: Type.Optional(pathSchema),
      maxEntries: Type.Optional(Type.Integer()),
    }),
  },
  {
    name: "search_text",
    label: "Search Text",
    description: "Search workspace files for a literal text pattern.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 4096 }),
      path: Type.Optional(pathSchema),
      maxMatches: Type.Optional(Type.Integer()),
    }),
  },
  {
    name: "write_file",
    label: "Write File",
    description: "Write an entire UTF-8 file inside the current plan step's allowed paths.",
    parameters: Type.Object({
      path: pathSchema,
      content: Type.String({ maxLength: 2 * 1024 * 1024 }),
    }),
  },
  {
    name: "apply_edit",
    label: "Apply Edit",
    description: "Replace an exact text fragment inside an allowed workspace file.",
    parameters: Type.Object({
      path: pathSchema,
      oldText: Type.String({ minLength: 1, maxLength: 1024 * 1024 }),
      newText: Type.String({ maxLength: 1024 * 1024 }),
      expectedReplacements: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
  },
  {
    name: "run_command",
    label: "Run Command",
    description: "Run one argv command in the isolated task workspace without a shell.",
    parameters: Type.Object({
      argv: argvSchema,
      timeoutMs: Type.Optional(Type.Integer()),
      maxOutputBytes: Type.Optional(Type.Integer()),
    }),
  },
  {
    name: "git_diff",
    label: "Git Diff",
    description: "Export the current isolated workspace changes as a unified binary-safe patch.",
    parameters: Type.Object({ maxBytes: Type.Optional(Type.Integer()) }),
  },
];

export function createWorkspaceTools(dispatch: WorkspaceToolDispatcher): NoNeedWorkTool[] {
  return definitions.map((definition) =>
    defineTool({
      ...definition,
      async execute(toolCallId, params) {
        const result = await dispatch(definition.name, params, toolCallId);
        if (!result.ok) throw new Error(result.content);
        return {
          content: [{ type: "text", text: result.content }],
          details: result.details,
        };
      },
    }),
  );
}
