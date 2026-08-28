import type { ZodType } from "zod";

import type { SandboxExecutor } from "../sandbox/docker-provider.js";
import { type ListFilesInput, listFilesInputSchema, listFilesTool } from "./builtin/list-files.js";
import { type ReadFileInput, readFileInputSchema, readFileTool } from "./builtin/read-file.js";
import {
  type SearchTextInput,
  searchTextInputSchema,
  searchTextTool,
} from "./builtin/search-text.js";
import type { ToolContext } from "./tool-context.js";
import type { ToolResult } from "./tool-result.js";

interface RegisteredTool<TInput> {
  schema: ZodType<TInput>;
  execute(context: ToolContext, input: TInput): Promise<ToolResult>;
}

export class ToolGateway {
  readonly #tools = new Map<string, RegisteredTool<unknown>>();

  constructor(executor: SandboxExecutor) {
    this.register<ReadFileInput>("read_file", readFileInputSchema, (context, input) =>
      readFileTool(executor, context, input),
    );
    this.register<ListFilesInput>("list_files", listFilesInputSchema, (context, input) =>
      listFilesTool(executor, context, input),
    );
    this.register<SearchTextInput>("search_text", searchTextInputSchema, (context, input) =>
      searchTextTool(executor, context, input),
    );
  }

  get toolNames(): readonly string[] {
    return [...this.#tools.keys()];
  }

  register<TInput>(
    name: string,
    schema: ZodType<TInput>,
    execute: (context: ToolContext, input: TInput) => Promise<ToolResult>,
  ): void {
    if (this.#tools.has(name)) throw new Error(`Tool already registered: ${name}`);
    this.#tools.set(name, { schema, execute } as RegisteredTool<unknown>);
  }

  async dispatch(name: string, rawInput: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const input = tool.schema.parse(rawInput);
    return tool.execute(context, input);
  }
}
