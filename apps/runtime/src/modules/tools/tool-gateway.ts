import type { ZodType } from "zod";

import type { SandboxExecutor } from "../sandbox/docker-provider.js";
import { type ApplyEditInput, applyEditInputSchema, applyEditTool } from "./builtin/apply-edit.js";
import { type GitDiffInput, gitDiffInputSchema, gitDiffTool } from "./builtin/git-diff.js";
import { type ListFilesInput, listFilesInputSchema, listFilesTool } from "./builtin/list-files.js";
import { type ReadFileInput, readFileInputSchema, readFileTool } from "./builtin/read-file.js";
import {
  type RunCommandInput,
  runCommandInputSchema,
  runCommandTool,
} from "./builtin/run-command.js";
import {
  type SearchTextInput,
  searchTextInputSchema,
  searchTextTool,
} from "./builtin/search-text.js";
import { type WriteFileInput, writeFileInputSchema, writeFileTool } from "./builtin/write-file.js";
import type { ToolAudit } from "./tool-audit.js";
import type { ToolContext } from "./tool-context.js";
import type { ToolResult } from "./tool-result.js";

interface RegisteredTool<TInput> {
  schema: ZodType<TInput>;
  sideEffecting: boolean;
  execute(context: ToolContext, input: TInput): Promise<ToolResult>;
}

export class ToolGateway {
  readonly #tools = new Map<string, RegisteredTool<unknown>>();
  readonly #audit: ToolAudit | undefined;

  constructor(executor: SandboxExecutor, audit?: ToolAudit) {
    this.#audit = audit;
    this.register<ReadFileInput>("read_file", readFileInputSchema, (context, input) =>
      readFileTool(executor, context, input),
    );
    this.register<ListFilesInput>("list_files", listFilesInputSchema, (context, input) =>
      listFilesTool(executor, context, input),
    );
    this.register<SearchTextInput>("search_text", searchTextInputSchema, (context, input) =>
      searchTextTool(executor, context, input),
    );
    this.register<WriteFileInput>(
      "write_file",
      writeFileInputSchema,
      (context, input) => writeFileTool(executor, context, input),
      true,
    );
    this.register<ApplyEditInput>(
      "apply_edit",
      applyEditInputSchema,
      (context, input) => applyEditTool(executor, context, input),
      true,
    );
    this.register<RunCommandInput>(
      "run_command",
      runCommandInputSchema,
      (context, input) => runCommandTool(executor, context, input),
      true,
    );
    this.register<GitDiffInput>(
      "git_diff",
      gitDiffInputSchema,
      (context, input) => gitDiffTool(executor, context, input),
      true,
    );
  }

  get toolNames(): readonly string[] {
    return [...this.#tools.keys()];
  }

  register<TInput>(
    name: string,
    schema: ZodType<TInput>,
    execute: (context: ToolContext, input: TInput) => Promise<ToolResult>,
    sideEffecting = false,
  ): void {
    if (this.#tools.has(name)) throw new Error(`Tool already registered: ${name}`);
    this.#tools.set(name, { schema, execute, sideEffecting } as RegisteredTool<unknown>);
  }

  async dispatch(name: string, rawInput: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const input = tool.schema.parse(rawInput);
    if (tool.sideEffecting) {
      if (!this.#audit) throw new Error(`Side-effecting tool ${name} requires a ToolAudit`);
      return this.#audit.dispatch(name, input, context, () => tool.execute(context, input));
    }
    return tool.execute(context, input);
  }
}
