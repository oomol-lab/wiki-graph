import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";

import pino, {
  multistream,
  type Logger as PinoLogger,
  type StreamEntry,
} from "pino";
import pretty from "pino-pretty";
import type { PrettyOptions } from "pino-pretty";

interface LoggingContext {
  readonly artifactCounters: Map<string, number>;
  readonly artifactRootDirPath?: string;
  readonly logger: PinoLogger;
  readonly rootLogDirPath?: string;
  readonly runId: string;
}

const loggingContext = new AsyncLocalStorage<LoggingContext>();
const artifactCounters = new Map<string, number>();
const silentLogger = pino({ enabled: false });

export async function withLoggingContext<T>(
  input: {
    readonly operation: string;
    readonly logDirPath?: string;
    readonly verbose?: boolean;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const rootLogDirPath =
    input.logDirPath === undefined ? undefined : resolve(input.logDirPath);
  const runId = createRunId();
  const runDirPath =
    rootLogDirPath === undefined ? undefined : join(rootLogDirPath, runId);
  const artifactRootDirPath =
    runDirPath === undefined ? undefined : join(runDirPath, "artifacts");

  if (runDirPath !== undefined) {
    mkdirSync(runDirPath, { recursive: true });
  }

  const logger = createLogger({
    operation: input.operation,
    runId,
    verbose: input.verbose ?? false,
    ...(runDirPath === undefined
      ? {}
      : { eventLogPath: join(runDirPath, "run.log") }),
  });

  return await loggingContext.run(
    {
      artifactCounters: new Map(),
      logger,
      runId,
      ...(artifactRootDirPath === undefined ? {} : { artifactRootDirPath }),
      ...(rootLogDirPath === undefined ? {} : { rootLogDirPath }),
    },
    operation,
  );
}

export function getLogger(bindings?: Record<string, unknown>): PinoLogger {
  const logger = loggingContext.getStore()?.logger ?? silentLogger;

  return bindings === undefined ? logger : logger.child(bindings);
}

export function resolveArtifactPath(input: {
  readonly category: string;
  readonly fileName: string;
  readonly logDirPath?: string;
}): string | undefined {
  if (input.logDirPath === undefined) {
    return undefined;
  }

  const rootLogDirPath = resolve(input.logDirPath);
  const context = loggingContext.getStore();

  if (
    context?.rootLogDirPath === rootLogDirPath &&
    context.artifactRootDirPath !== undefined
  ) {
    const categoryDirPath = join(context.artifactRootDirPath, input.category);

    mkdirSync(categoryDirPath, { recursive: true });

    return join(categoryDirPath, input.fileName);
  }

  mkdirSync(rootLogDirPath, { recursive: true });

  return join(rootLogDirPath, input.fileName);
}

export function allocateArtifactPath(input: {
  readonly alwaysNumbered?: boolean;
  readonly category: string;
  readonly extension?: string;
  readonly logDirPath?: string;
  readonly prefix: string;
}): string | undefined {
  if (input.logDirPath === undefined) {
    return undefined;
  }

  const rootLogDirPath = resolve(input.logDirPath);
  const context = loggingContext.getStore();
  const extension = input.extension ?? ".log";
  const counterStore = context?.artifactCounters ?? artifactCounters;
  const counterKey = `${rootLogDirPath}:${input.category}:${input.prefix}:${extension}`;
  const nextIndex = counterStore.get(counterKey);
  const startIndex = nextIndex === undefined ? 1 : nextIndex + 1;

  for (let index = startIndex; ; index += 1) {
    const fileName =
      input.alwaysNumbered === true
        ? `${input.prefix}-${index}${extension}`
        : index === 1
          ? `${input.prefix}${extension}`
          : `${input.prefix}-${index}${extension}`;
    const resolvedPath = resolveArtifactPath({
      category: input.category,
      fileName,
      logDirPath: input.logDirPath,
    });

    if (resolvedPath === undefined) {
      return undefined;
    }

    if (!existsSync(resolvedPath)) {
      counterStore.set(counterKey, index);
      return resolvedPath;
    }
  }
}

function createLogger(input: {
  readonly eventLogPath?: string;
  readonly operation: string;
  readonly runId: string;
  readonly verbose: boolean;
}): PinoLogger {
  const streams: StreamEntry[] = [];

  if (input.eventLogPath !== undefined) {
    mkdirSync(dirname(input.eventLogPath), { recursive: true });
    streams.push({
      level: "info",
      stream: pretty(createPrettyOptions(input.eventLogPath)),
    });
  }

  if (input.verbose) {
    streams.push({
      level: "info",
      stream: pretty(createPrettyOptions(process.stderr)),
    });
  }

  if (streams.length === 0) {
    return silentLogger;
  }

  return pino(
    {
      base: null,
      level: "info",
    },
    multistream(streams),
  ).child({
    operation: input.operation,
    runId: input.runId,
  });
}

function createPrettyOptions(
  destination: string | NodeJS.WritableStream,
): PrettyOptions {
  return {
    colorize: false,
    destination,
    ignore: "pid,hostname,operation,runId,component,scope,sessionId",
    mkdir: typeof destination === "string",
    singleLine: true,
    sync: true,
    translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
  };
}

function createRunId(): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hours = pad(now.getUTCHours());
  const minutes = pad(now.getUTCMinutes());
  const seconds = pad(now.getUTCSeconds());

  return `${year}${month}${day}-${hours}${minutes}${seconds}-${randomUUID().slice(0, 8)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
