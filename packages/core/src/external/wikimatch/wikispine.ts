import type {
  WikimatchCandidate,
  WikimatchQidOption,
  WikimatchSentence,
} from "./types.js";

export interface MatchWikispineSentenceCandidatesOptions {
  readonly command?: string;
  readonly dataDir?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  readonly includeDisambiguation?: boolean;
  readonly maxCandidatesPerSurface?: number;
  readonly onProgress?: (
    progress: WikispineMatchProgress,
  ) => Promise<void> | void;
  readonly provider?: WikispineProvider;
  readonly commandRunner?: WikispineCommandRunner;
  readonly signal?: AbortSignal;
  readonly sentences: readonly WikimatchSentence[];
  readonly token?: string;
}

export type WikispineProvider = "cli" | "fetch";

export interface WikispineMatchProgress {
  readonly coveredRangeEnd: number;
}

export interface TestWikispineRuntimeOptions {
  readonly command?: string;
  readonly dataDir?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  readonly provider?: WikispineProvider;
  readonly commandRunner?: WikispineCommandRunner;
  readonly signal?: AbortSignal;
  readonly token?: string;
}

/** Host capability for invoking the optional WikiSpine command provider. */
export interface WikispineCommandRunner {
  run(input: {
    readonly args: readonly string[];
    readonly command: string;
    readonly input: string;
    readonly onStdout: (chunk: string) => Promise<void> | void;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly exitCode: number | null; readonly stderr: string }>;
}

export interface WikispineRuntimeTestResult {
  readonly durationMs: number;
  readonly metadata?: WikispineMetadata;
  readonly ok: true;
  readonly provider: WikispineProvider;
}

interface WikispineMatchEvent {
  readonly match: WikispineMatchRecord;
  readonly type: "match";
}

interface WikispineDoneEvent {
  readonly stats?: unknown;
  readonly type: "done";
}

type WikispineEvent = WikispineDoneEvent | WikispineMatchEvent;

interface WikispineMatchRecord {
  readonly end: number;
  readonly qids: readonly WikispineQidCandidate[];
  readonly start: number;
  readonly surface_id: number;
}

interface WikispineQidCandidate {
  readonly disambiguation?: boolean;
  readonly qid: string;
}

interface WikispineMetadata {
  readonly automaton_shard_count: number;
  readonly format: string;
  readonly qid_count: number;
  readonly surface_count: number;
  readonly surface_normalization: string;
}

const WIKISPINE_RUNTIME_GUIDE_URL =
  "https://raw.githubusercontent.com/oomol-lab/wiki-graph/refs/heads/main/docs/wikispine-runtime.md";
export const DEFAULT_WIKISPINE_FETCH_ENDPOINT =
  "https://api.pdfcraft.ai/v1/wikispine";

export async function* matchWikispineSentenceCandidates(
  options: MatchWikispineSentenceCandidatesOptions,
): AsyncIterable<WikimatchCandidate> {
  let candidateIndex = 1;

  for (const sentence of options.sentences) {
    options.signal?.throwIfAborted();
    for await (const matched of matchSentence(sentence, options)) {
      const surface = sentence.text.slice(matched.start, matched.end);

      await options.onProgress?.({
        coveredRangeEnd: sentence.range.start + matched.end,
      });
      yield {
        id: `c${candidateIndex}`,
        qidOptions: matched.qids.map(toQidOption),
        range: {
          end: sentence.range.start + matched.end,
          start: sentence.range.start + matched.start,
        },
        surface,
      };
      candidateIndex += 1;
    }
    await options.onProgress?.({ coveredRangeEnd: sentence.range.end });
  }
}

function matchSentence(
  sentence: WikimatchSentence,
  options: MatchWikispineSentenceCandidatesOptions,
): AsyncIterable<WikispineMatchRecord> {
  return resolveProvider(options) === "fetch"
    ? fetchWikispineMatch(options, sentence)
    : runWikispineMatch(
        options.command ?? "wikispine",
        buildMatchArgs(options),
        sentence,
        options,
      );
}

export async function testWikispineRuntime(
  options: TestWikispineRuntimeOptions,
): Promise<WikispineRuntimeTestResult> {
  const provider = resolveProvider(options);
  const startedAt = Date.now();

  if (provider === "fetch") {
    const endpoint = requireEndpoint(options.endpoint);
    const token = requireToken(options.token);
    const metadata = await fetchWikispineMetadata(
      endpoint,
      options.fetch,
      options.signal,
      token,
    );

    for await (const _ of fetchWikispineMatch(
      {
        ...options,
        endpoint,
        maxCandidatesPerSurface: 1,
        token,
      },
      {
        id: "test",
        range: { end: 7, start: 0 },
        text: "北京大学位于北京。",
      },
    )) {
      // Consume the health-check stream completely.
    }

    return {
      durationMs: Date.now() - startedAt,
      metadata,
      ok: true,
      provider,
    };
  }

  for await (const _ of runWikispineMatch(
    options.command ?? "wikispine",
    buildMatchArgs({
      ...options,
      maxCandidatesPerSurface: 1,
    }),
    {
      id: "test",
      range: { end: 7, start: 0 },
      text: "北京大学位于北京。",
    },
    options.signal === undefined ? {} : { signal: options.signal },
    options.commandRunner,
  )) {
    // Consume the health-check stream completely.
  }

  return {
    durationMs: Date.now() - startedAt,
    ok: true,
    provider,
  };
}

async function* runWikispineMatch(
  command: string,
  args: readonly string[],
  sentence: WikimatchSentence,
  options: Pick<
    MatchWikispineSentenceCandidatesOptions,
    "commandRunner" | "signal"
  >,
  commandRunner: WikispineCommandRunner | undefined = options.commandRunner,
): AsyncIterable<WikispineMatchRecord> {
  if (commandRunner === undefined) {
    throw new Error(
      formatWikispineRuntimeError(
        "The cli provider requires a host-supplied WikispineCommandRunner.",
      ),
    );
  }
  const parser = createWikispineNdjsonParser();
  const queue = createAsyncQueue<WikispineEvent>();
  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted === true) abort();
  let completed = false;
  const running = commandRunner
    .run({
      args,
      command,
      input: sentence.text,
      onStdout: async (chunk) => {
        for (const event of parser.push(chunk)) await queue.push(event);
      },
      signal: controller.signal,
    })
    .then(async (result) => {
      for (const event of parser.finish()) await queue.push(event);
      queue.end();
      return result;
    })
    .catch((error: unknown) => {
      queue.fail(error);
      throw error;
    });
  let sawDone = false;
  try {
    for await (const event of queue) {
      if (event.type === "done") {
        sawDone = true;
      } else {
        yield event.match;
      }
    }
    const result = await running;
    if (result.exitCode !== 0) {
      throw new Error(
        formatWikispineRuntimeError(
          `wikispine match failed with exit code ${result.exitCode}: ${result.stderr}`,
        ),
      );
    }
    if (!sawDone) throw incompleteWikispineStreamError();
    completed = true;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (!completed) {
      const error = new Error("WikiSpine consumer stopped");
      queue.fail(error);
      controller.abort(error);
    }
    await running.catch(() => undefined);
  }
}

function buildMatchArgs(
  options: Pick<
    MatchWikispineSentenceCandidatesOptions,
    "dataDir" | "includeDisambiguation" | "maxCandidatesPerSurface"
  >,
): string[] {
  const args = ["match"];

  if (options.dataDir !== undefined) {
    args.push("--data-dir", options.dataDir);
  }
  if (options.includeDisambiguation === false) {
    args.push("--exclude-disambiguation");
  }
  if (options.maxCandidatesPerSurface !== undefined) {
    args.push(
      "--max-candidates-per-surface",
      String(options.maxCandidatesPerSurface),
    );
  }

  return args;
}

async function* fetchWikispineMatch(
  options: Pick<
    MatchWikispineSentenceCandidatesOptions,
    | "endpoint"
    | "fetch"
    | "includeDisambiguation"
    | "maxCandidatesPerSurface"
    | "signal"
    | "token"
  >,
  sentence: WikimatchSentence,
): AsyncIterable<WikispineMatchRecord> {
  const endpoint = requireEndpoint(options.endpoint);
  const token = requireToken(options.token);
  const response = await (options.fetch ?? fetch)(`${endpoint}/match`, {
    body: JSON.stringify({
      options: {
        ...(options.includeDisambiguation === undefined
          ? {}
          : { include_disambiguation: options.includeDisambiguation }),
        ...(options.maxCandidatesPerSurface === undefined
          ? {}
          : {
              max_candidates_per_surface: options.maxCandidatesPerSurface,
            }),
      },
      text: sentence.text,
    }),
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    method: "POST",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (!response.ok) {
    throw new Error(
      formatWikispineRuntimeError(
        `WikiSpine fetch provider failed with HTTP ${response.status}: ${await response.text()}`,
      ),
    );
  }

  const parser = createWikispineNdjsonParser();
  let sawDone = false;

  if (response.body === null) {
    for (const event of [
      ...parser.push(await response.text()),
      ...parser.finish(),
    ]) {
      if (event.type === "done") sawDone = true;
      else yield event.match;
    }
    if (!sawDone) throw incompleteWikispineStreamError();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      for (const event of parser.push(
        decoder.decode(value, { stream: true }),
      )) {
        if (event.type === "done") sawDone = true;
        else yield event.match;
      }
    }
    for (const event of [
      ...parser.push(decoder.decode()),
      ...parser.finish(),
    ]) {
      if (event.type === "done") sawDone = true;
      else yield event.match;
    }
  } finally {
    if (!completed) await reader.cancel();
    reader.releaseLock();
  }
  if (!sawDone) throw incompleteWikispineStreamError();
}

async function fetchWikispineMetadata(
  endpoint: string,
  fetchFn: typeof fetch | undefined,
  signal: AbortSignal | undefined,
  token: string,
): Promise<WikispineMetadata> {
  const request = fetchFn ?? fetch;
  const headers = { authorization: `Bearer ${token}` };
  const ready = await request(`${endpoint}/readyz`, {
    headers,
    ...(signal === undefined ? {} : { signal }),
  });

  if (!ready.ok) {
    throw new Error(
      formatWikispineRuntimeError(
        `WikiSpine fetch provider is not ready: HTTP ${ready.status}.`,
      ),
    );
  }

  const response = await request(`${endpoint}/metadata`, {
    headers,
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    throw new Error(
      formatWikispineRuntimeError(
        `WikiSpine metadata request failed with HTTP ${response.status}.`,
      ),
    );
  }

  try {
    return parseWikispineMetadata(await response.json());
  } catch (error) {
    if (error instanceof Error && error.message.includes("setup guide")) {
      throw error;
    }

    throw new Error(
      formatWikispineRuntimeError(
        `Invalid WikiSpine metadata response: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

function createWikispineNdjsonParser(): {
  readonly finish: () => readonly WikispineEvent[];
  readonly push: (chunk: string) => readonly WikispineEvent[];
} {
  let buffer = "";

  function parseLine(line: string): WikispineEvent | undefined {
    if (line.trim() === "") {
      return undefined;
    }
    return parseWikispineEvent(JSON.parse(line));
  }

  function wrapParseError(error: unknown): Error {
    return new Error(
      formatWikispineRuntimeError(
        `Invalid WikiSpine match response: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  return {
    finish: () => {
      try {
        const event = parseLine(buffer);
        buffer = "";
        return event === undefined ? [] : [event];
      } catch (error) {
        throw wrapParseError(error);
      }
    },
    push: (chunk) => {
      try {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";

        return lines.flatMap((line) => {
          const event = parseLine(line);
          return event === undefined ? [] : [event];
        });
      } catch (error) {
        throw wrapParseError(error);
      }
    },
  };
}

function incompleteWikispineStreamError(): Error {
  return new Error(
    formatWikispineRuntimeError(
      "WikiSpine stream ended before the done event.",
    ),
  );
}

function createAsyncQueue<T>(): {
  readonly [Symbol.asyncIterator]: () => AsyncIterator<T>;
  readonly end: () => void;
  readonly fail: (error: unknown) => void;
  readonly push: (value: T) => Promise<void>;
} {
  const values: T[] = [];
  const readers: Array<{
    readonly reject: (error: Error) => void;
    readonly resolve: (result: IteratorResult<T>) => void;
  }> = [];
  const writers: Array<() => void> = [];
  let ended = false;
  let failure: Error | undefined;

  function settleReader(): void {
    const reader = readers.shift();
    if (reader === undefined) return;
    if (failure !== undefined) reader.reject(failure);
    else if (values.length > 0) {
      const value = values.shift()!;
      writers.shift()?.();
      reader.resolve({ done: false, value });
    } else if (ended) reader.resolve({ done: true, value: undefined });
    else readers.unshift(reader);
  }

  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (failure !== undefined) throw failure;
        if (values.length > 0) {
          const value = values.shift()!;
          writers.shift()?.();
          return { done: false, value };
        }
        if (ended) return { done: true, value: undefined };
        return await new Promise<IteratorResult<T>>((resolve, reject) => {
          readers.push({ reject, resolve });
        });
      },
    }),
    end: () => {
      ended = true;
      while (readers.length > 0) settleReader();
    },
    fail: (error) => {
      failure = toError(error);
      while (readers.length > 0) settleReader();
      while (writers.length > 0) writers.shift()?.();
    },
    push: async (value) => {
      if (ended || failure !== undefined) return;
      if (readers.length > 0) {
        values.push(value);
        settleReader();
        return;
      }
      values.push(value);
      if (values.length > 1) {
        await new Promise<void>((resolve) => writers.push(resolve));
      }
    },
  };
}

function parseWikispineEvent(value: unknown): WikispineEvent {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected wikispine event to be an object.");
  }

  const record = value as Record<string, unknown>;

  if (record.type === "done") {
    return { type: "done" };
  }
  if (record.type === "match" && isWikispineMatchRecord(record.match)) {
    return {
      match: record.match,
      type: "match",
    };
  }

  throw new Error(`Unexpected wikispine event: ${JSON.stringify(value)}`);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function parseWikispineMetadata(value: unknown): WikispineMetadata {
  if (typeof value !== "object" || value === null) {
    throw new Error(
      formatWikispineRuntimeError("Expected WikiSpine metadata."),
    );
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.automaton_shard_count !== "number" ||
    typeof record.format !== "string" ||
    typeof record.qid_count !== "number" ||
    typeof record.surface_count !== "number" ||
    typeof record.surface_normalization !== "string"
  ) {
    throw new Error(formatWikispineRuntimeError("Invalid WikiSpine metadata."));
  }

  return {
    automaton_shard_count: record.automaton_shard_count,
    format: record.format,
    qid_count: record.qid_count,
    surface_count: record.surface_count,
    surface_normalization: record.surface_normalization,
  };
}

function isWikispineMatchRecord(value: unknown): value is WikispineMatchRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.end === "number" &&
    Array.isArray(record.qids) &&
    record.qids.every(isWikispineQidCandidate) &&
    typeof record.start === "number" &&
    typeof record.surface_id === "number"
  );
}

function isWikispineQidCandidate(
  value: unknown,
): value is WikispineQidCandidate {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    (!("disambiguation" in record) ||
      typeof record.disambiguation === "boolean") &&
    typeof record.qid === "string" &&
    /^Q[1-9]\d*$/u.test(record.qid)
  );
}

function toQidOption(candidate: WikispineQidCandidate): WikimatchQidOption {
  return {
    isDisambiguation: candidate.disambiguation === true,
    qid: candidate.qid,
  };
}

function resolveProvider(options: {
  readonly provider?: WikispineProvider;
}): WikispineProvider {
  return options.provider ?? "cli";
}

function requireEndpoint(endpoint: string | undefined): string {
  const normalized = (endpoint ?? DEFAULT_WIKISPINE_FETCH_ENDPOINT)
    .trim()
    .replace(/\/+$/u, "");

  if (normalized === "") {
    throw new Error(
      formatWikispineRuntimeError(
        "WikiSpine fetch provider has no default endpoint.",
      ),
    );
  }

  return normalized;
}

function requireToken(token: string | undefined): string {
  const normalized = token?.trim();
  if (normalized === undefined || normalized === "") {
    throw new Error(
      formatWikispineRuntimeError(
        "WikiSpine fetch provider requires a Bearer API key.",
      ),
    );
  }
  return normalized;
}

function formatWikispineRuntimeError(message: string): string {
  return `${message}\nWikiSpine setup guide: ${WIKISPINE_RUNTIME_GUIDE_URL}`;
}
