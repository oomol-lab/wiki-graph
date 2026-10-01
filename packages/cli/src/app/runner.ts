import { Readable, Writable } from "stream";

import { createWikiGraphSDK } from "wiki-graph-sdk";
import { dispatchWikiGraphCLI } from "./dispatch.js";
import {
  getCLIExitCode,
  withWikiGraphCLIRuntimeContext,
  type WikiGraphCLIRuntimeContext,
} from "../runtime/context.js";
import {
  createEntryRuntimeContext,
  type WikiGraphEntryEnvPolicy,
} from "../runtime/entry-context.js";

export interface RunWikiGraphCLIInput {
  /**
   * CLI arguments without the executable name. For example, `["--help"]`
   * simulates `wg --help`.
   */
  readonly argv?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly devProjectRoot?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly stateDir?: string | undefined;
  readonly stderr?: NodeJS.WritableStream | undefined;
  readonly stderrIsTTY?: boolean | undefined;
  readonly stdin?: NodeJS.ReadableStream | Uint8Array | string | undefined;
  readonly stdinIsTTY?: boolean | undefined;
  readonly stdout?: NodeJS.WritableStream | undefined;
  readonly stdoutIsTTY?: boolean | undefined;
}

export interface RunWikiGraphCLIResult {
  readonly exitCode: number;
}

export interface RunWikiGraphCLICapturedResult extends RunWikiGraphCLIResult {
  readonly stderr: string;
  readonly stdout: string;
}

export interface WikiGraphCLI {
  run(
    argv?: readonly string[],
    overrides?: RunWikiGraphCLIInput,
  ): Promise<RunWikiGraphCLIResult>;
  runCaptured(
    argv?: readonly string[],
    overrides?: RunWikiGraphCLIInput,
  ): Promise<RunWikiGraphCLICapturedResult>;
}

export async function runWikiGraphCLI(
  input: RunWikiGraphCLIInput = {},
): Promise<RunWikiGraphCLIResult> {
  return await runWikiGraphCLIWithEntryPolicy(input, "production");
}

export async function runWikiGraphCLIWithEntryPolicy(
  input: RunWikiGraphCLIInput = {},
  envPolicy: WikiGraphEntryEnvPolicy,
): Promise<RunWikiGraphCLIResult> {
  throwIfAborted(input.signal);

  const stdin = createInputStream(input.stdin ?? process.stdin);
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const argv = input.argv ?? process.argv.slice(2);
  let entryContext: ReturnType<typeof createEntryRuntimeContext>;

  try {
    entryContext = createEntryRuntimeContext({
      argv,
      cwd: input.cwd ?? process.cwd(),
      devProjectRoot: input.devProjectRoot,
      env: input.env,
      envPolicy,
      stateDir: input.stateDir,
    });
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 1 };
  }

  const context: WikiGraphCLIRuntimeContext = {
    argv,
    cwd: input.cwd ?? process.cwd(),
    devProjectRoot: entryContext.devProjectRoot,
    env: entryContext.env,
    envPolicy: entryContext.envPolicy,
    exitCode: 0,
    queueAutostart: true,
    sdk: createWikiGraphSDK({
      cwd: input.cwd ?? process.cwd(),
      env: entryContext.env,
      envPolicy: entryContext.envPolicy,
      ...(entryContext.stateDir === undefined
        ? {}
        : { stateDir: entryContext.stateDir }),
    }),
    signal: input.signal,
    stateDir: entryContext.stateDir,
    stderr,
    stderrIsTTY: input.stderrIsTTY,
    stdin,
    stdinIsTTY: input.stdinIsTTY,
    stdout,
    stdoutIsTTY: input.stdoutIsTTY,
  };

  try {
    return await context.sdk!.run(async () =>
      withWikiGraphCLIRuntimeContext(context, async () => {
        const result = await dispatchWikiGraphCLI({
          argv,
          stderr,
          stdinIsTTY: context.stdinIsTTY ?? stdin.isTTY,
          stdout,
        });
        throwIfAborted(input.signal);
        const exitCode = normalizeExitCode(getCLIExitCode(), result.exitCode);

        return { exitCode };
      }),
    );
  } finally {
    context.sdk!.close();
  }
}

export async function runWikiGraphCLICaptured(
  input: RunWikiGraphCLIInput = {},
): Promise<RunWikiGraphCLICapturedResult> {
  const stdout = new CaptureWritable(input.stdoutIsTTY);
  const stderr = new CaptureWritable(input.stderrIsTTY);
  const result = await runWikiGraphCLI({
    ...input,
    stderr,
    stdout,
  });

  return {
    exitCode: result.exitCode,
    stderr: stderr.text,
    stdout: stdout.text,
  };
}

export function createWikiGraphCLI(
  defaults: RunWikiGraphCLIInput = {},
): WikiGraphCLI {
  return {
    run(argv, overrides = {}) {
      return runWikiGraphCLI(mergeCLIInputs(defaults, argv, overrides));
    },
    runCaptured(argv, overrides = {}) {
      return runWikiGraphCLICaptured(mergeCLIInputs(defaults, argv, overrides));
    },
  };
}

function mergeCLIInputs(
  defaults: RunWikiGraphCLIInput,
  argv: readonly string[] | undefined,
  overrides: RunWikiGraphCLIInput,
): RunWikiGraphCLIInput {
  return {
    ...defaults,
    ...overrides,
    argv: argv ?? overrides.argv ?? defaults.argv,
  };
}

function createInputStream(
  input: NodeJS.ReadableStream | Uint8Array | string,
): NodeJS.ReadableStream & { isTTY?: boolean | undefined } {
  if (typeof input === "string" || input instanceof Uint8Array) {
    return Readable.from([input]) as NodeJS.ReadableStream & {
      isTTY?: boolean | undefined;
    };
  }

  return input as NodeJS.ReadableStream & { isTTY?: boolean | undefined };
}

function normalizeExitCode(
  currentExitCode: NodeJS.Process["exitCode"],
  fallbackExitCode: number,
): number {
  if (currentExitCode === undefined || currentExitCode === 0) {
    return fallbackExitCode;
  }

  const numericExitCode = Number(currentExitCode);

  return Number.isFinite(numericExitCode) ? numericExitCode : 1;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("The Wiki Graph CLI run was aborted.");
}

class CaptureWritable extends Writable {
  readonly #chunks: string[] = [];

  public constructor(isTTY: boolean | undefined) {
    super();
    Object.defineProperty(this, "isTTY", {
      configurable: true,
      value: isTTY ?? false,
    });
  }

  public get text(): string {
    return this.#chunks.join("");
  }

  public override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (typeof chunk === "string") {
      this.#chunks.push(chunk);
      callback();
      return;
    }

    const normalizedEncoding = encoding as BufferEncoding | "buffer";
    this.#chunks.push(
      chunk.toString(normalizedEncoding === "buffer" ? "utf8" : encoding),
    );
    callback();
  }
}
