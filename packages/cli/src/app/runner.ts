import { Readable, Writable } from "stream";

import { dispatchWikiGraphCLI } from "./dispatch.js";

export interface RunWikiGraphCLIInput {
  /**
   * CLI arguments without the executable name. For example, `["--help"]`
   * simulates `wg --help`.
   */
  readonly argv?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly signal?: AbortSignal | undefined;
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

let activeRunner = false;

export async function runWikiGraphCLI(
  input: RunWikiGraphCLIInput = {},
): Promise<RunWikiGraphCLIResult> {
  throwIfAborted(input.signal);

  if (activeRunner) {
    throw new Error(
      "runWikiGraphCLI cannot run concurrently because it adapts process-global CLI state.",
    );
  }

  activeRunner = true;

  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  const stdin = createInputStream(input.stdin ?? process.stdin);
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const restore = installProcessAdapters({
    argv: input.argv ?? process.argv.slice(2),
    env: input.env,
    stderr,
    stderrIsTTY: input.stderrIsTTY,
    stdin,
    stdinIsTTY: input.stdinIsTTY,
    stdout,
    stdoutIsTTY: input.stdoutIsTTY,
  });

  try {
    if (input.cwd !== undefined && input.cwd !== originalCwd) {
      process.chdir(input.cwd);
    }

    process.exitCode = 0;

    const result = await dispatchWikiGraphCLI({
      argv: input.argv ?? process.argv.slice(2),
      stderr,
      stdinIsTTY: stdin.isTTY,
      stdout,
    });
    const exitCode = normalizeExitCode(process.exitCode, result.exitCode);

    return { exitCode };
  } finally {
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
    process.exitCode = originalExitCode;
    restore();
    activeRunner = false;
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

function installProcessAdapters(input: {
  readonly argv: readonly string[];
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly stderr: NodeJS.WritableStream;
  readonly stderrIsTTY?: boolean | undefined;
  readonly stdin: NodeJS.ReadableStream & { isTTY?: boolean | undefined };
  readonly stdinIsTTY?: boolean | undefined;
  readonly stdout: NodeJS.WritableStream;
  readonly stdoutIsTTY?: boolean | undefined;
}): () => void {
  const processDescriptors = {
    argv: Object.getOwnPropertyDescriptor(process, "argv"),
    env: Object.getOwnPropertyDescriptor(process, "env"),
    stderr: Object.getOwnPropertyDescriptor(process, "stderr"),
    stdin: Object.getOwnPropertyDescriptor(process, "stdin"),
    stdout: Object.getOwnPropertyDescriptor(process, "stdout"),
  };
  const streamDescriptors = {
    stderrIsTTY: Object.getOwnPropertyDescriptor(input.stderr, "isTTY"),
    stdinIsTTY: Object.getOwnPropertyDescriptor(input.stdin, "isTTY"),
    stdoutIsTTY: Object.getOwnPropertyDescriptor(input.stdout, "isTTY"),
  };

  Object.defineProperty(input.stdin, "isTTY", {
    configurable: true,
    value: input.stdinIsTTY ?? input.stdin.isTTY,
  });
  Object.defineProperty(input.stdout, "isTTY", {
    configurable: true,
    value: input.stdoutIsTTY ?? getWritableIsTTY(input.stdout),
  });
  Object.defineProperty(input.stderr, "isTTY", {
    configurable: true,
    value: input.stderrIsTTY ?? getWritableIsTTY(input.stderr),
  });
  Object.defineProperty(process, "argv", {
    configurable: true,
    value: ["node", "wg", ...input.argv],
  });
  Object.defineProperty(process, "env", {
    configurable: true,
    value:
      input.env === undefined
        ? process.env
        : {
            ...process.env,
            ...input.env,
          },
  });
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: input.stdin,
  });
  Object.defineProperty(process, "stdout", {
    configurable: true,
    value: input.stdout,
  });
  Object.defineProperty(process, "stderr", {
    configurable: true,
    value: input.stderr,
  });

  return () => {
    restoreDescriptor(process, "stderr", processDescriptors.stderr);
    restoreDescriptor(process, "stdout", processDescriptors.stdout);
    restoreDescriptor(process, "stdin", processDescriptors.stdin);
    restoreDescriptor(process, "env", processDescriptors.env);
    restoreDescriptor(process, "argv", processDescriptors.argv);
    restoreDescriptor(input.stderr, "isTTY", streamDescriptors.stderrIsTTY);
    restoreDescriptor(input.stdout, "isTTY", streamDescriptors.stdoutIsTTY);
    restoreDescriptor(input.stdin, "isTTY", streamDescriptors.stdinIsTTY);
  };
}

function restoreDescriptor(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, property);
    return;
  }

  Object.defineProperty(target, property, descriptor);
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

function getWritableIsTTY(stream: NodeJS.WritableStream): boolean | undefined {
  return (stream as NodeJS.WritableStream & { isTTY?: boolean | undefined })
    .isTTY;
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
