import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { delimiter, isAbsolute, join, resolve } from "path";
import {
  getLocalGlobalDir,
  removeLocalInstallState,
} from "./local-cli-install-state.mjs";

const workspaceRoot = resolve(import.meta.dirname, "..");
const cliRoot = join(workspaceRoot, "packages", "cli");
const globalBinDir = execFileSync("pnpm", ["bin", "--global"], {
  cwd: workspaceRoot,
  encoding: "utf8",
}).trim();
const localGlobalDir = getLocalGlobalDir(globalBinDir);
const packRoot = join(localGlobalDir, "packs");
const pnpmGlobalEnv = {
  ...process.env,
  PATH: [globalBinDir, process.env.PATH].filter(Boolean).join(delimiter),
};

function readTarballPath(packOutput) {
  const packResult = JSON.parse(packOutput);
  const filename = Array.isArray(packResult)
    ? packResult[0]?.filename
    : packResult.filename;

  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(
      "Failed to resolve tarball filename from pnpm pack output.",
    );
  }

  return isAbsolute(filename) ? filename : join(packRoot, filename);
}

execFileSync("pnpm", ["build"], {
  cwd: workspaceRoot,
  stdio: "inherit",
});

removeLocalInstallState(globalBinDir);
mkdirSync(packRoot, { recursive: true });

const packOutput = execFileSync(
  "pnpm",
  ["pack", "--json", "--pack-destination", packRoot],
  {
    cwd: cliRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);

const tarballPath = readTarballPath(packOutput);

execFileSync(
  "pnpm",
  [
    "add",
    "--global",
    "--global-dir",
    localGlobalDir,
    `--config.global-bin-dir=${globalBinDir}`,
    "--allow-build=esbuild",
    "--allow-build=sqlite3",
    tarballPath,
  ],
  {
    cwd: workspaceRoot,
    env: pnpmGlobalEnv,
    stdio: "inherit",
  },
);
