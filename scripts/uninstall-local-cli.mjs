import { execFileSync } from "child_process";
import { resolve } from "path";

const workspaceRoot = resolve(import.meta.dirname, "..");

function createNpmEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toLowerCase().startsWith("npm_config_"),
    ),
  );
}

execFileSync(
  "npm",
  [
    "uninstall",
    "--global",
    "wiki-graph",
    "wiki-graph-sdk",
    "wiki-graph-core",
    "wiki-graph-job",
    "wiki-graph-wikimedia",
  ],
  {
    cwd: workspaceRoot,
    env: createNpmEnv(),
    stdio: "inherit",
  },
);
