import { spawn } from "child_process";

import type {
  WikimatchCandidate,
  WikimatchQidOption,
  WikimatchSentence,
} from "./types.js";

export interface MatchWikispineSentenceCandidatesOptions {
  readonly command?: string;
  readonly dataDir?: string;
  readonly includeDisambiguation?: boolean;
  readonly maxCandidatesPerSurface?: number;
  readonly sentences: readonly WikimatchSentence[];
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
  const stdout = await runWikispineMatch(
    options.command ?? "wikispine",
    buildMatchArgs(options),
    text,
  );

  return parseWikispineNdjson(stdout);
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
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `wikispine match failed with exit code ${code}: ${Buffer.concat(stderr).toString("utf8")}`,
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
  options: MatchWikispineSentenceCandidatesOptions,
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
