import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";

import {
  getCLICwd,
  getCLIDevProjectRoot,
  getCLIEnv,
  getCLIEnvPolicy,
  getCLIStateDir,
} from "./context.js";
import { DANGEROUS_RUNTIME_ENV_NAMES } from "./entry-context.js";

export type InternalChildKind = "gc-worker" | "queue-worker";

export interface InternalChildSpawnOptions {
  readonly args?: readonly string[];
  readonly detached?: boolean;
}

declare global {
  var __WIKIGRAPH_CLI_DIST_DIR__: string | undefined;
}

export function spawnInternalChild(
  kind: InternalChildKind,
  options: InternalChildSpawnOptions = {},
): ReturnType<typeof spawn> {
  const command = createInternalChildCommand(kind, options.args ?? []);

  return spawn(command.command, command.args, {
    cwd: getCLICwd(),
    detached: options.detached === true,
    env: createInternalChildEnvironment(),
    stdio: options.detached === true ? "ignore" : ["ignore", "pipe", "pipe"],
  });
}

export function createInternalChildEnvironmentForTesting(): NodeJS.ProcessEnv {
  return createInternalChildEnvironment();
}

export async function runInternalChildJSON<T>(
  kind: InternalChildKind,
  options: InternalChildSpawnOptions = {},
): Promise<T> {
  const child = spawnInternalChild(kind, options);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

  await new Promise<void>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Internal ${kind} failed with exit code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
        return;
      }
      resolvePromise();
    });
  });

  try {
    return JSON.parse(Buffer.concat(stdout).toString("utf8")) as T;
  } catch (error) {
    throw new Error(
      `Internal ${kind} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function createInternalChildCommandForTesting(
  kind: InternalChildKind,
  args: readonly string[] = [],
): { readonly args: readonly string[]; readonly command: string } {
  return createInternalChildCommand(kind, args);
}

function createInternalChildCommand(
  kind: InternalChildKind,
  args: readonly string[],
): { readonly args: readonly string[]; readonly command: string } {
  const devProjectRoot = getCLIDevProjectRoot();
  const stateDir = getCLIStateDir();

  if (devProjectRoot !== undefined && stateDir !== undefined) {
    return {
      args: [
        join(devProjectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(devProjectRoot, "packages", "cli", "src", "bin", `${kind}.ts`),
        "--wikigraph-internal-child",
        kind,
        "--wikigraph-state-dir",
        stateDir,
        "--wikigraph-env-policy",
        getCLIEnvPolicy(),
        "--wikigraph-dev-project-root",
        devProjectRoot,
        ...args,
      ],
      command: process.execPath,
    };
  }

  return {
    args: [
      resolveProductionEntryPath(kind),
      "--wikigraph-internal-child",
      kind,
      ...(stateDir === undefined ? [] : ["--wikigraph-state-dir", stateDir]),
      ...args,
    ],
    command: process.execPath,
  };
}

function createInternalChildEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...getCLIEnv() };

  for (const name of DANGEROUS_RUNTIME_ENV_NAMES) {
    delete environment[name];
  }

  return environment;
}

function resolveProductionEntryPath(kind: InternalChildKind): string {
  const filename = `${kind}.js`;
  const distDirPath =
    globalThis.__WIKIGRAPH_CLI_DIST_DIR__ ??
    resolve(getCLICwd(), "packages", "cli", "dist");
  const adjacent = join(distDirPath, filename);

  if (existsSync(adjacent)) {
    return adjacent;
  }

  return adjacent;
}
