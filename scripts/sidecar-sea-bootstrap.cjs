const { access } = require("node:fs/promises");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const resourcesFlag = process.argv.indexOf("--resources");
const resourcesRoot =
  resourcesFlag >= 0 && process.argv[resourcesFlag + 1]
    ? resolve(process.argv[resourcesFlag + 1])
    : join(dirname(process.execPath), "nw-runtime-resources");
const runtimeEntry = join(resourcesRoot, "apps", "runtime", "dist", "main.js");

access(runtimeEntry)
  .then(() => import(pathToFileURL(runtimeEntry).href))
  .catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(
      `${JSON.stringify({
        kind: "noneedwork.runtime.bootstrap-error",
        message,
        resourcesRoot,
      })}\n`,
    );
    process.exitCode = 1;
  });
