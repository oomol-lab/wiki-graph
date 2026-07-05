import { spawn } from "child_process";

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
  readonly provider?: WikispineProvider;
  readonly sentences: readonly WikimatchSentence[];
}

export type WikispineProvider = "cli" | "fetch";

export interface TestWikispineRuntimeOptions {
  readonly command?: string;
  readonly dataDir?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  readonly provider?: WikispineProvider;
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
  "https://raw.githubusercontent.com/oomol-lab/spinedigest/main/docs/wikispine-runtime.md";

export async function matchWikispineSentenceCandidates(
  options: MatchWikispineSentenceCandidatesOptions,
): Promise<readonly WikimatchCandidate[]> {
  const candidates: WikimatchCandidate[] = [];
  let candidateIndex = 1;

  for (const sentence of options.sentences) {
    for (const matched of await matchSentence(sentence.text, options)) {
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
  }

  return candidates;
}

async function matchSentence(
  text: string,
  options: MatchWikispineSentenceCandidatesOptions,
): Promise<readonly WikispineMatchRecord[]> {
  const stdout =
    resolveProvider(options) === "fetch"
      ? await fetchWikispineMatch(options, text)
      : await runWikispineMatch(
          options.command ?? "wikispine",
          buildMatchArgs(options),
          text,
        );

  return parseWikispineMatchOutput(stdout);
}

export async function testWikispineRuntime(
  options: TestWikispineRuntimeOptions,
): Promise<WikispineRuntimeTestResult> {
  const provider = resolveProvider(options);
  const startedAt = Date.now();

  if (provider === "fetch") {
    const endpoint = requireEndpoint(options.endpoint);
    const metadata = await fetchWikispineMetadata(endpoint, options.fetch);

    parseWikispineMatchOutput(
      await fetchWikispineMatch(
        {
          ...options,
          endpoint,
          maxCandidatesPerSurface: 1,
        },
        "北京大学位于北京。",
      ),
    );

    return {
      durationMs: Date.now() - startedAt,
      metadata,
      ok: true,
      provider,
    };
  }

  parseWikispineMatchOutput(
    await runWikispineMatch(
      options.command ?? "wikispine",
      buildMatchArgs({
        ...options,
        maxCandidatesPerSurface: 1,
      }),
      "北京大学位于北京。",
    ),
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
  input: string,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      reject(
        new Error(
          formatWikispineRuntimeError(
            `Failed to start wikispine command: ${error.message}`,
          ),
        ),
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            formatWikispineRuntimeError(
              `wikispine match failed with exit code ${code}: ${Buffer.concat(stderr).toString("utf8")}`,
            ),
          ),
        );
        return;
      }

      resolve(Buffer.concat(stdout).toString("utf8"));
    });

    child.stdin.end(input);
  });
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
    "endpoint" | "fetch" | "includeDisambiguation" | "maxCandidatesPerSurface"
  >,
  text: string,
): Promise<string> {
  const endpoint = requireEndpoint(options.endpoint);
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
      text,
    }),
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      formatWikispineRuntimeError(
        `WikiSpine fetch provider failed with HTTP ${response.status}: ${await response.text()}`,
      ),
    );
  }

  return await response.text();
}

async function fetchWikispineMetadata(
  endpoint: string,
  fetchFn: typeof fetch = fetch,
): Promise<WikispineMetadata> {
  const ready = await fetchFn(`${endpoint}/readyz`);

  if (!ready.ok) {
    throw new Error(
      formatWikispineRuntimeError(
        `WikiSpine fetch provider is not ready: HTTP ${ready.status}.`,
      ),
    );
  }

  const response = await fetchFn(`${endpoint}/metadata`);

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

function parseWikispineNdjson(value: string): readonly WikispineMatchRecord[] {
  const matches: WikispineMatchRecord[] = [];

  for (const line of value.split(/\r?\n/u)) {
    if (line.trim() === "") {
      continue;
    }

    const event = parseWikispineEvent(JSON.parse(line));

    if (event.type === "match") {
      matches.push(event.match);
    }
  }

  return matches;
}

function parseWikispineMatchOutput(
  value: string,
): readonly WikispineMatchRecord[] {
  try {
    return parseWikispineNdjson(value);
  } catch (error) {
    throw new Error(
      formatWikispineRuntimeError(
        `Invalid WikiSpine match response: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
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
  const normalized = endpoint?.trim().replace(/\/+$/u, "");

  if (normalized === undefined || normalized === "") {
    throw new Error(
      formatWikispineRuntimeError(
        "WikiSpine fetch provider requires wikispine.endpoint.",
      ),
    );
  }

  return normalized;
}

function formatWikispineRuntimeError(message: string): string {
  return `${message}\nWikiSpine setup guide: ${WIKISPINE_RUNTIME_GUIDE_URL}`;
}
