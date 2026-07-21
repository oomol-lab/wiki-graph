import {
  GuaranteedParseValidationError,
  ParsedJsonError,
} from "../../../../external/guaranteed/index.js";
import type { SentenceId } from "../../../../document/index.js";
import type { RankedSentenceCandidate } from "../../../../graph/evidence-selection/index.js";
import type { ChunkExtractionSentence, ChunkLink } from "../types.js";
import type { FragmentProjection, TextSpan } from "../fragment-projection.js";
import type { ChoiceFieldName, RawChunkLink } from "./schema.js";

export function createWordsCountRecord(
  sentences: readonly Pick<
    ChunkExtractionSentence,
    "sentenceId" | "wordsCount"
  >[],
): Readonly<Record<string, number>> {
  const wordsCountByKey = createEmptyRecord<number>();

  for (const sentence of sentences) {
    const sentenceKey = createSentenceKey(sentence.sentenceId);
    wordsCountByKey[sentenceKey] = sentence.wordsCount;
  }

  return wordsCountByKey;
}

export function createSentenceTextRecord(
  projection: FragmentProjection,
): Readonly<Record<string, string>> {
  const record = createEmptyRecord<string>();

  for (const sentence of projection.sentences) {
    record[createSentenceKey(sentence.sentenceId)] = sentence.rawText;
  }

  return record;
}

export function normalizeChunkLinks(
  links: readonly RawChunkLink[],
): ChunkLink[] {
  return links.map((link) => {
    if (link.strength === undefined) {
      return {
        from: link.from,
        to: link.to,
      };
    }

    return {
      from: link.from,
      strength: link.strength,
      to: link.to,
    };
  });
}

export function formatChoiceCandidate(
  candidate: RankedSentenceCandidate,
): string {
  return [
    candidate.occurrenceId,
    `prev: ${formatChoiceText(candidate.prevText)}`,
    `text: ${formatChoiceText(candidate.text)}`,
    `next: ${formatChoiceText(candidate.nextText)}`,
  ].join("\n");
}

function formatChoiceText(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();

  return collapsed === "" ? "(none)" : collapsed;
}

export function toChoiceFieldName(value: string): ChoiceFieldName | undefined {
  return value === "evidence" ||
    value === "start_anchor" ||
    value === "end_anchor"
    ? value
    : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isParsedJsonValidationFailure(error: unknown): boolean {
  return (
    error instanceof GuaranteedParseValidationError &&
    error.cause instanceof ParsedJsonError
  );
}

export function createSentenceKey(sentenceId: SentenceId): string {
  return sentenceId.join(":");
}

export function createMembershipRecord(
  values: readonly (number | string)[],
): Readonly<Record<string, true>> {
  const record = createEmptyRecord<true>();

  for (const value of values) {
    record[String(value)] = true;
  }

  return record;
}

export function hasMembership(
  record: Readonly<Record<string, true>>,
  value: number | string,
): boolean {
  return hasIndexedValue(record, String(value));
}

function hasIndexedValue<TValue>(
  record: Readonly<Record<string, TValue>>,
  key: string,
): boolean {
  return Object.hasOwn(record, key);
}

function createEmptyRecord<TValue>(): Record<string, TValue> {
  return Object.create(null) as Record<string, TValue>;
}

export function expectSingleSpan(
  spans: readonly TextSpan[],
): TextSpan | undefined {
  return spans.length === 1 ? spans[0] : undefined;
}
