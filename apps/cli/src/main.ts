#!/usr/bin/env node
import { Command } from "commander";

import { registerArtifactCommand } from "./commands/artifact.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerProjectCommand } from "./commands/project.js";
import { registerRuntimeCommand } from "./commands/runtime.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerTraceCommand } from "./commands/trace.js";

const program = new Command()
  .name("nw")
  .description("NoNeedWork local software engineering agent")
  .version("0.0.0");

registerDoctorCommand(program);
registerRuntimeCommand(program);
registerProjectCommand(program);
registerTaskCommand(program);
registerArtifactCommand(program);
registerTraceCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`NoNeedWork CLI error: ${message}\n`);
  process.exitCode = 1;
});
