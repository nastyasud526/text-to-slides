import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadArtifactTool() {
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) {
    throw new Error("RUNTIME_NODE_MODULES is not set. Set it to the bundled Node packages directory from load_workspace_dependencies.");
  }
  const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
  const entry = require.resolve("@oai/artifact-tool");
  return import(pathToFileURL(entry).href);
}

export function usage(command, argumentsText) {
  throw new Error(`Usage: ${command} ${argumentsText}`);
}
