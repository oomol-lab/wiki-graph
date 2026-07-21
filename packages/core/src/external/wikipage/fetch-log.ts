import { createHash } from "crypto";
import { appendFile } from "fs/promises";

import {
  getLogger,
  resolveArtifactPath,
} from "../../runtime/common/logging.js";
import { formatError } from "../../utils/node-error.js";

const MAX_RESPONSE_TEXT_LENGTH = 16_384;

export interface WikipageFetchLog {
  readonly filePath: string | undefined;
  append(entry: WikipageFetchLogEntry): Promise<void>;
  warnFailed(): void;
}

interface WikipageFetchLogEntry {
  readonly attempt: number;
  readonly durationMs: number;
  readonly error?: unknown;
  readonly response?: Response;
  readonly responseText?: string;
  readonly startedAt: number;
  readonly url: URL;
}

class SilentWikipageFetchLog implements WikipageFetchLog {
  public readonly filePath = undefined;

  public append(): Promise<void> {
    return Promise.resolve();
  }

  public warnFailed(): void {
    return undefined;
  }
}

class FileWikipageFetchLog implements WikipageFetchLog {
  readonly #filePath: string;
  #failedWarned = false;

  public constructor(filePath: string) {
    this.#filePath = filePath;
  }

  public get filePath(): string {
    return this.#filePath;
  }

  public async append(entry: WikipageFetchLogEntry): Promise<void> {
    await appendFile(
      this.#filePath,
      `${JSON.stringify(formatEntry(entry))}\n`,
      "utf8",
    );
  }

  public warnFailed(): void {
    if (this.#failedWarned) {
      return;
    }
    this.#failedWarned = true;

    getLogger({ component: "wikipage" }).warn(
      `\n[Wikipage] Failed with fetch log: ${this.#filePath}`,
    );
  }
}

export function createWikipageFetchLog(logDirPath?: string): WikipageFetchLog {
  if (logDirPath === undefined) {
    return new SilentWikipageFetchLog();
  }

  const filePath = resolveArtifactPath({
    category: "wikipage",
    fileName: "wikipage-fetch.jsonl",
    logDirPath,
  });

  return filePath === undefined
    ? new SilentWikipageFetchLog()
    : new FileWikipageFetchLog(filePath);
}

function formatEntry(entry: WikipageFetchLogEntry): Record<string, unknown> {
  return {
    action: entry.url.searchParams.get("action") ?? null,
    attempt: entry.attempt,
    batch: summarizeBatch(entry.url),
    durationMs: entry.durationMs,
    endpoint: `${entry.url.origin}${entry.url.pathname}`,
    host: entry.url.host,
    ok: entry.response?.ok ?? false,
    startedAt: new Date(entry.startedAt).toISOString(),
    ...(entry.response === undefined
      ? {}
      : {
          retryAfter: entry.response.headers.get("retry-after"),
          status: entry.response.status,
        }),
    ...(entry.error === undefined
      ? {}
      : { error: formatLogError(entry.error) }),
    ...(entry.responseText === undefined
      ? {}
      : { responseText: truncateResponseText(entry.responseText) }),
  };
}

function summarizeBatch(url: URL): Record<string, unknown> | undefined {
  const ids = url.searchParams.get("ids");
  if (ids !== null) {
    return summarizeList("qid", ids.split("|"));
  }

  const titles = url.searchParams.get("titles");
  if (titles !== null) {
    return summarizeList("title", titles.split("|"));
  }

  const page = url.searchParams.get("page");
  if (page !== null) {
    return summarizeList("page", [page]);
  }

  return undefined;
}

function summarizeList(
  kind: "page" | "qid" | "title",
  values: readonly string[],
): Record<string, unknown> {
  const joined = values.join("|");

  return {
    count: values.length,
    hash: createHash("sha256").update(joined).digest("hex").slice(0, 16),
    kind,
    sample: values.slice(0, 5),
  };
}

function formatLogError(error: unknown): Record<string, unknown> {
  return {
    message: formatError(error),
    name: error instanceof Error ? error.name : typeof error,
    ...formatErrorCause(error),
  };
}

function formatErrorCause(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error) || error.cause === undefined) {
    return {};
  }

  const cause = error.cause;

  return {
    cause:
      cause instanceof Error
        ? {
            message: formatError(cause),
            name: cause.name,
            ...formatNodeErrorCode(cause),
          }
        : stringifyUnknown(cause),
  };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return value.toString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "unserializable error cause";
  }
}

function formatNodeErrorCode(error: Error): Record<string, unknown> {
  const code = (error as { readonly code?: unknown }).code;

  return typeof code === "string" ? { code } : {};
}

function truncateResponseText(text: string): string {
  if (text.length <= MAX_RESPONSE_TEXT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_RESPONSE_TEXT_LENGTH)}\n[truncated ${text.length - MAX_RESPONSE_TEXT_LENGTH} chars]`;
}
