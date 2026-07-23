import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";

export type InternalChildKind = "gc-worker" | "queue-worker";

export interface InternalChildSpawnOptions {
  readonly args?: readonly string[];
  readonly detached?: boolean;
}

const INTERNAL_CHILD_ENV_KEY = "WIKIGRAPH_INTERNAL_CHILD";

declare global {
  var __WIKIGRAPH_CLI_DIST_DIR__: string | undefined;
}

export function spawnInternalChild(
  kind: InternalChildKind,
  options: InternalChildSpawnOptions = {},
): ReturnType<typeof spawn> {
  const command = createInternalChildCommand(kind, options.args ?? []);

  return spawn(command.command, command.args, {
    detached: options.detached === true,
    env: {
      ...process.env,
      [INTERNAL_CHILD_ENV_KEY]: kind,
    },
    stdio: options.detached === true ? "ignore" : ["ignore", "pipe", "pipe"],
  });
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
  if (process.env.WIKIGRAPH_DEV !== undefined) {
    const projectRoot = resolveDevProjectRoot(process.env.WIKIGRAPH_DEV);

    return {
      args: [
        join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(
          projectRoot,
          "packages",
          "cli",
          "src",
          "bin",
          createDevEntryName(kind),
        ),
        ...args,
      ],
      command: process.execPath,
    };
  }

  return {
    args: [resolveProductionEntryPath(kind), ...args],
    command: process.execPath,
  };
}

function createDevEntryName(kind: InternalChildKind): string {
  switch (kind) {
    case "gc-worker":
      return "dev-gc-worker.ts";
    case "queue-worker":
      return "dev-queue-worker.ts";
  }
}

function resolveDevProjectRoot(devStateDirPath: string | undefined): string {
  if (devStateDirPath === undefined || devStateDirPath.trim() === "") {
    throw new Error("WIKIGRAPH_DEV must contain the development state path.");
  }

  return resolve(devStateDirPath, "..", "..");
}

function resolveProductionEntryPath(kind: InternalChildKind): string {
  const filename = `${kind}.js`;
  const distDirPath =
    globalThis.__WIKIGRAPH_CLI_DIST_DIR__ ??
    resolve(process.cwd(), "packages", "cli", "dist");
  const adjacent = join(distDirPath, filename);

  if (existsSync(adjacent)) {
    return adjacent;
  }

  return adjacent;
}
