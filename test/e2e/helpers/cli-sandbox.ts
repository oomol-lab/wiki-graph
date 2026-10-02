import { spawn } from "child_process";
import { mkdir, mkdtemp, readFile } from "fs/promises";
import { join } from "path";
import { inject } from "vitest";

export interface CLIResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface CLISandbox {
  readonly archivePath: string;
  readonly archiveUri: string;
  readonly home: string;
  readonly root: string;
  readonly setConfig: (
    section: "wikimedia" | "wikispine",
    value: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
  readonly run: (
    args: readonly string[],
    options?: { readonly input?: string; readonly timeoutMs?: number },
  ) => Promise<CLIResult>;
  readonly runJSON: <T = Record<string, unknown>>(
    args: readonly string[],
    options?: { readonly input?: string; readonly timeoutMs?: number },
  ) => Promise<T>;
}

const blockedEnvironmentNames = [
  "WIKIGRAPH_DEV",
  "WIKIGRAPH_ENV_POLICY",
  "WIKIGRAPH_QUEUE_DISABLE_AUTOSTART",
  "WIKIGRAPH_STATE_DIR",
] as const;

export async function createCLISandbox(name: string): Promise<CLISandbox> {
  const { cliPath, installRoot, suiteRoot } = inject("cliE2E");
  const casesRoot = join(suiteRoot, "cases");
  await mkdir(casesRoot, { recursive: true });
  const root = await mkdtemp(join(casesRoot, `${sanitizeName(name)}-`));
  const cwd = join(root, "workspace");
  const home = join(root, "home");
  const temp = join(root, "tmp");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(temp, { recursive: true }),
  ]);
  const archivePath = join(cwd, "knowledge.wikg");
  const archiveUri = `wikg://${archivePath}`;
  const env = createIsolatedEnvironment(home, temp);

  const run = async (
    args: readonly string[],
    options: { readonly input?: string; readonly timeoutMs?: number } = {},
  ): Promise<CLIResult> =>
    await runCLI(cliPath, args, {
      cwd,
      env,
      ...(options.input === undefined ? {} : { input: options.input }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });

  return {
    archivePath,
    archiveUri,
    home,
    root,
    run,
    runJSON: async <T>(
      args: readonly string[],
      options: { readonly input?: string; readonly timeoutMs?: number } = {},
    ): Promise<T> => {
      const result = await run(args, options);
      assertSucceeded(args, result);
      return JSON.parse(result.stdout) as T;
    },
    setConfig: async (section, value) => {
      const script = [
        'import { createWikiGraphSDK } from "wiki-graph-sdk";',
        "const sdk = createWikiGraphSDK();",
        "try {",
        "  await sdk.config.replace(process.argv[1], JSON.parse(process.argv[2]));",
        "} finally {",
        "  sdk.close();",
        "}",
      ].join("\n");
      const result = await runCLI(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          script,
          section,
          JSON.stringify(value),
        ],
        { cwd: installRoot, env },
      );
      assertSucceeded(["configure", section], result);
    },
  };
}

export async function readFixture(path: string): Promise<string> {
  return await readFile(
    new URL(`../../fixtures/${path}`, import.meta.url),
    "utf8",
  );
}

export function assertSucceeded(
  args: readonly string[],
  result: CLIResult,
): void {
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `wg ${args.join(" ")} exited with ${result.exitCode}.`,
        result.stdout === "" ? "" : `stdout:\n${result.stdout}`,
        result.stderr === "" ? "" : `stderr:\n${result.stderr}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function createIsolatedEnvironment(
  home: string,
  temp: string,
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of blockedEnvironmentNames) delete env[name];
  return {
    ...env,
    HOME: home,
    TMPDIR: temp,
    USERPROFILE: home,
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
  };
}

async function runCLI(
  cliPath: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly input?: string;
    readonly timeoutMs?: number;
  },
): Promise<CLIResult> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(cliPath, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `wg ${args.join(" ")} exceeded ${options.timeoutMs ?? 30_000}ms.`,
        ),
      );
    }, options.timeoutMs ?? 30_000);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolvePromise({
        exitCode: exitCode ?? 1,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
    child.stdin.end(options.input);
  });
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9-]+/giu, "-").replace(/^-+|-+$/gu, "");
}
