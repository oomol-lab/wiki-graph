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
    readonly onStdout: (chunk: string) => void;
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

export async function matchWikispineSentenceCandidates(
  options: MatchWikispineSentenceCandidatesOptions,
): Promise<readonly WikimatchCandidate[]> {
  const candidates: WikimatchCandidate[] = [];
  let candidateIndex = 1;

  for (const sentence of options.sentences) {
    options.signal?.throwIfAborted();
    for (const matched of await matchSentence(sentence, options)) {
      const surface = sentence.text.slice(matched.start, matched.end);

      candidates.push({
        id: `c${candidateIndex}`,
        qidOptions: matched.qids.map(toQidOption),
        range: {
          end: sentence.range.start + matched.end,
          start: sentence.range.start + matched.start,
        },
        surface,
      });
      candidateIndex += 1;
    }
    await options.onProgress?.({ coveredRangeEnd: sentence.range.end });
  }

  return candidates;
}

async function matchSentence(
  sentence: WikimatchSentence,
  options: MatchWikispineSentenceCandidatesOptions,
): Promise<readonly WikispineMatchRecord[]> {
  return resolveProvider(options) === "fetch"
    ? await fetchWikispineMatch(options, sentence)
    : await runWikispineMatch(
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

    await fetchWikispineMatch(
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
    );

    return {
      durationMs: Date.now() - startedAt,
      metadata,
      ok: true,
      provider,
    };
  }

  await runWikispineMatch(
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
  );

  return {
    durationMs: Date.now() - startedAt,
    ok: true,
    provider,
  };
}

async function runWikispineMatch(
  command: string,
  args: readonly string[],
  sentence: WikimatchSentence,
  options: Pick<
    MatchWikispineSentenceCandidatesOptions,
    "commandRunner" | "onProgress" | "signal"
  >,
  commandRunner: WikispineCommandRunner | undefined = options.commandRunner,
): Promise<readonly WikispineMatchRecord[]> {
  if (commandRunner === undefined) {
    throw new Error(
      formatWikispineRuntimeError(
        "The cli provider requires a host-supplied WikispineCommandRunner.",
      ),
    );
  }
  const progress = createWikispineProgressReporter(options.onProgress);
  const parser = createWikispineNdjsonParser({
    onMatch: (match) => {
      progress.report({
        coveredRangeEnd: sentence.range.start + match.end,
      });
    },
  });
  const result = await commandRunner.run({
    args,
    command,
    input: sentence.text,
    onStdout: (chunk) => parser.push(chunk),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (result.exitCode !== 0) {
    throw new Error(
      formatWikispineRuntimeError(
        `wikispine match failed with exit code ${result.exitCode}: ${result.stderr}`,
      ),
    );
  }
  const matches = parser.finish();
  await progress.wait();
  return matches;
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

async function fetchWikispineMatch(
  options: Pick<
    MatchWikispineSentenceCandidatesOptions,
    | "endpoint"
    | "fetch"
    | "includeDisambiguation"
    | "maxCandidatesPerSurface"
    | "onProgress"
    | "signal"
    | "token"
  >,
  sentence: WikimatchSentence,
): Promise<readonly WikispineMatchRecord[]> {
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

  const progress = createWikispineProgressReporter(options.onProgress);
  const parser = createWikispineNdjsonParser({
    onMatch: (match) => {
      progress.report({
        coveredRangeEnd: sentence.range.start + match.end,
      });
    },
  });

  if (response.body === null) {
    parser.push(await response.text());
    const matches = parser.finish();
    await progress.wait();
    return matches;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parser.push(decoder.decode(value, { stream: true }));
    progress.throwIfFailed();
  }

  parser.push(decoder.decode());
  const matches = parser.finish();
  await progress.wait();
  return matches;
}

function createWikispineProgressReporter(
  onProgress:
    | ((progress: WikispineMatchProgress) => Promise<void> | void)
    | undefined,
  options?: {
    readonly onFailure?: (error: Error) => void;
  },
): {
  readonly report: (progress: WikispineMatchProgress) => void;
  readonly throwIfFailed: () => void;
  readonly wait: () => Promise<void>;
} {
  const tasks: Promise<void>[] = [];
  let failure: Error | undefined;

  function fail(error: unknown): void {
    if (failure !== undefined) {
      return;
    }
    failure = toError(error);
    options?.onFailure?.(failure);
  }

  return {
    report: (progress) => {
      if (onProgress === undefined || failure !== undefined) {
        return;
      }

      try {
        tasks.push(Promise.resolve(onProgress(progress)).catch(fail));
      } catch (error) {
        fail(error);
      }
    },
    throwIfFailed: () => {
      if (failure !== undefined) {
        throw failure;
      }
    },
    wait: async () => {
      await Promise.all(tasks);
      if (failure !== undefined) {
        throw failure;
      }
    },
  };
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

function createWikispineNdjsonParser(input?: {
  readonly onMatch?: (match: WikispineMatchRecord) => void;
}): {
  readonly finish: () => readonly WikispineMatchRecord[];
  readonly push: (chunk: string) => void;
} {
  const matches: WikispineMatchRecord[] = [];
  let buffer = "";

  function parseLine(line: string): void {
    if (line.trim() === "") {
      return;
    }

    const event = parseWikispineEvent(JSON.parse(line));

    if (event.type === "match") {
      matches.push(event.match);
      input?.onMatch?.(event.match);
    }
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
        parseLine(buffer);
        buffer = "";
        return matches;
      } catch (error) {
        throw wrapParseError(error);
      }
    },
    push: (chunk) => {
      try {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          parseLine(line);
        }
      } catch (error) {
        throw wrapParseError(error);
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
