#!/usr/bin/env node
import { Command } from "commander";

import { registerDoctorCommand } from "./commands/doctor.js";
import { registerRuntimeCommand } from "./commands/runtime.js";

const program = new Command()
  .name("nw")
  .description("NoNeedWork local software engineering agent")
  .version("0.0.0");

registerDoctorCommand(program);
registerRuntimeCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`NoNeedWork CLI error: ${message}\n`);
  process.exitCode = 1;
});
