import { execFileSync } from "child_process";
import { delimiter, resolve } from "path";
import {
  getLocalGlobalDir,
  removeLocalInstallState,
} from "./local-cli-install-state.mjs";

const workspaceRoot = resolve(import.meta.dirname, "..");
const globalBinDir = execFileSync("pnpm", ["bin", "--global"], {
  cwd: workspaceRoot,
  encoding: "utf8",
}).trim();
const localGlobalDir = getLocalGlobalDir(globalBinDir);
const pnpmGlobalEnv = {
  ...process.env,
  PATH: [globalBinDir, process.env.PATH].filter(Boolean).join(delimiter),
};
try {
  execFileSync(
    "pnpm",
    [
      "remove",
      "--global",
      "--global-dir",
      localGlobalDir,
      `--config.global-bin-dir=${globalBinDir}`,
      "wiki-graph",
    ],
    {
      cwd: workspaceRoot,
      env: pnpmGlobalEnv,
      stdio: "inherit",
    },
  );
} finally {
  removeLocalInstallState(globalBinDir);
}
