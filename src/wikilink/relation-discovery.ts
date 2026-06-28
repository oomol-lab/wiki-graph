import { z } from "zod";

import {
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
  type GuaranteedRequest,
} from "../guaranteed/index.js";
import type { LLMessage } from "../llm/index.js";
import {
  EvidenceResolver,
  FragmentProjection,
} from "../reader/chunk-batch/index.js";

import type { WikilinkEvidenceWindow } from "./types.js";

export interface WikilinkSentence {
  readonly text: string;
  readonly wordsCount: number;
}

export interface WikilinkDiscoveredRelation {
  readonly confidence?: number;
  readonly evidenceEnd: number;
  readonly evidenceStart: number;
  readonly note?: string;
  readonly predicate: string;
  readonly sourceMentionId: string;
  readonly targetMentionId: string;
}

export interface DiscoverWikilinkRelationsOptions {
  readonly chapterId: number;
  readonly fragmentId: number;
  readonly maxRetries?: number;
  readonly request: GuaranteedRequest;
  readonly sentences: readonly WikilinkSentence[];
  readonly window: WikilinkEvidenceWindow;
}

const evidenceAnchorSchema = z
  .object({
    head: z.string().optional(),
    mode: z.enum(["full", "head_tail"]).optional(),
    tail: z.string().optional(),
    text: z.string().optional(),
  })
  .strict();

const relationSchema = z
  .object({
    confidence: z.number().min(0).max(1).optional(),
    evidence: z
      .object({
        end_anchor: z.union([z.string(), evidenceAnchorSchema]).optional(),
        start_anchor: z.union([z.string(), evidenceAnchorSchema]),
      })
      .strict(),
    note: z.string().max(80).optional(),
    predicate: z.string().min(1).max(64),
    sourceMentionId: z.string().min(1),
    targetMentionId: z.string().min(1),
  })
  .strict();

const relationResponseSchema = z
  .object({
    relations: z.array(relationSchema),
  })
  .strict();

const SUGGESTED_PREDICATES = [
  "instance_of",
  "subclass_of",
  "part_of",
  "has_part",
  "located_in",
  "contains",
  "capital_of",
  "country",
  "place_of_birth",
  "place_of_death",
  "headquarters_location",
  "member_of",
  "owned_by",
  "operator",
  "creator",
  "author",
  "composer",
  "director",
  "producer",
  "developer",
  "manufacturer",
  "publisher",
  "founded_by",
  "leader",
  "position_held",
  "employer",
  "educated_at",
  "student_of",
  "parent",
  "child",
  "spouse",
  "sibling",
  "relative",
  "dynasty",
  "replaces",
  "replaced_by",
  "precedes",
  "follows",
  "influenced_by",
  "influences",
  "participant_in",
  "participant",
  "conflict",
  "opposes",
  "allied_with",
  "supports",
  "causes",
  "caused_by",
  "results_in",
  "has_effect",
  "uses",
  "used_by",
  "applies_to",
  "based_on",
  "derived_from",
  "depicts",
  "main_subject",
  "about",
  "named_after",
  "has_characteristic",
  "field_of_work",
  "genre",
  "language",
  "time_period",
  "start_time",
  "end_time",
  "point_in_time",
  "significant_event",
  "award_received",
  "notable_work",
] as const;

const resolver = new EvidenceResolver();

export async function discoverWikilinkRelations(
  options: DiscoverWikilinkRelationsOptions,
): Promise<readonly WikilinkDiscoveredRelation[]> {
  if (options.window.mentions.length < 2) {
    return [];
  }

  try {
    return await requestGuaranteedJson({
      messages: buildRelationMessages(options),
      parse: (response) => parseRelationResponse(options, response),
      request: options.request,
      responseIntentClassifierPrompt:
        RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
      schema: relationResponseSchema,
      ...(options.maxRetries === undefined
        ? {}
        : { maxRetries: options.maxRetries }),
    });
  } catch {
    return [];
  }
}

function parseRelationResponse(
  options: DiscoverWikilinkRelationsOptions,
  response: z.infer<typeof relationResponseSchema>,
): readonly WikilinkDiscoveredRelation[] {
  const mentionsById = new Map(
    options.window.mentions.map((mention) => [mention.id, mention]),
  );
  const projection = new FragmentProjection(
    options.sentences.map((sentence, index) => ({
      sentenceId: [options.chapterId, options.fragmentId, index],
      text: sentence.text,
      wordsCount: sentence.wordsCount,
    })),
  );
  const sentenceOffsets = buildSentenceOffsets(options.sentences);
  const issues: string[] = [];
  const links: WikilinkDiscoveredRelation[] = [];
  const seenKeys = new Set<string>();

  for (const [index, relation] of response.relations.entries()) {
    const prefix = `relations[${index}]`;
    const source = mentionsById.get(relation.sourceMentionId);
    const target = mentionsById.get(relation.targetMentionId);

    if (source === undefined) {
      issues.push(`${prefix}.sourceMentionId references an unknown mention.`);
      continue;
    }
    if (target === undefined) {
      issues.push(`${prefix}.targetMentionId references an unknown mention.`);
      continue;
    }
    if (source.id === target.id) {
      issues.push(`${prefix} links a mention to itself.`);
      continue;
    }
    if (source.qid !== undefined && source.qid === target.qid) {
      issues.push(`${prefix} links two mentions grounded to the same QID.`);
      continue;
    }

    const predicate = normalizePredicate(relation.predicate);

    if (predicate === "") {
      issues.push(`${prefix}.predicate normalizes to an empty label.`);
      continue;
    }

    if (predicate === "mentions") {
      issues.push(
        `${prefix}.predicate must be semantic; "mentions" is not a relation predicate.`,
      );
      continue;
    }

    const [resolution, failure] = resolver.resolve(
      relation.evidence,
      projection.sentences.map((sentence) => sentence.sentenceId),
      projection.sentences.map((sentence) => sentence.projectedText),
    );

    if (resolution === undefined) {
      issues.push(
        `${prefix}.evidence could not be resolved: ${
          failure?.message ?? "unknown failure"
        }`,
      );
      continue;
    }

    const firstSentence = resolution.sentenceIds[0];
    const lastSentence = resolution.sentenceIds.at(-1);

    if (firstSentence === undefined || lastSentence === undefined) {
      issues.push(`${prefix}.evidence resolved to no sentences.`);
      continue;
    }

    const startIndex = firstSentence[2];
    const endIndex = lastSentence[2];
    const startOffset = sentenceOffsets[startIndex]?.start;
    const endOffset = sentenceOffsets[endIndex]?.end;

    if (startOffset === undefined || endOffset === undefined) {
      issues.push(`${prefix}.evidence resolved outside this fragment.`);
      continue;
    }

    const key = `${source.id}\0${target.id}\0${predicate}\0${startOffset}\0${endOffset}`;

    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    links.push({
      ...(relation.confidence === undefined
        ? {}
        : { confidence: relation.confidence }),
      evidenceEnd: endOffset,
      evidenceStart: startOffset,
      ...(relation.note === undefined ? {} : { note: relation.note }),
      predicate,
      sourceMentionId: source.id,
      targetMentionId: target.id,
    });
  }

  if (issues.length > 0) {
    throw new ParsedJsonError(issues);
  }

  return links;
}

function buildRelationMessages(
  input: DiscoverWikilinkRelationsOptions,
): LLMessage[] {
  return [
    {
      content: formatRelationSystemPrompt(),
      role: "system",
    },
    {
      content: formatRelationUserPrompt(input),
      role: "user",
    },
  ];
}

function formatRelationSystemPrompt(): string {
  return [
    "You discover semantic relations between grounded entity mentions in source text.",
    "",
    "Rules:",
    "- Return JSON only.",
    "- Return only relations that are directly supported by the source text.",
    "- Every relation must connect two provided mention IDs from this window.",
    "- Do not create a relation just because two mentions are nearby.",
    "- Prefer the suggested predicates when one fits.",
    "- If none fits, create one short snake_case predicate.",
    "- Never use mentions as a predicate.",
    "- Evidence must quote exact original-language source text with start_anchor.",
    "- Use end_anchor only when evidence spans multiple consecutive sentences.",
    "- Do not use sentence numbers, offsets, or invented paraphrases as evidence.",
    "",
    "Suggested predicates:",
    SUGGESTED_PREDICATES.join(", "),
  ].join("\n");
}

function formatRelationUserPrompt(
  input: DiscoverWikilinkRelationsOptions,
): string {
  return [
    "Tagged source context:",
    formatTaggedContext(input.window),
    "",
    "Mentions:",
    JSON.stringify(
      input.window.mentions.map((mention) => ({
        id: mention.id,
        qid: mention.qid,
        surface: mention.surface,
      })),
      null,
      2,
    ),
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        relations: [
          {
            confidence: 0.86,
            evidence: {
              start_anchor: {
                mode: "full",
                text: "exact original source quote",
              },
            },
            note: "optional short reason",
            predicate: "predicate_name",
            sourceMentionId: "source mention id",
            targetMentionId: "target mention id",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "If the source text does not support any semantic relation, return:",
    JSON.stringify({ relations: [] }),
  ].join("\n");
}

function formatTaggedContext(window: WikilinkEvidenceWindow): string {
  const mentions = [...window.mentions].sort(
    (left, right) => left.range.start - right.range.start,
  );
  const parts: string[] = [];
  let cursor = window.range.start;

  for (const mention of mentions) {
    parts.push(
      escapeXmlText(
        window.text.slice(
          cursor - window.range.start,
          mention.range.start - window.range.start,
        ),
      ),
    );
    parts.push(
      `<mention id="${escapeXmlAttribute(mention.id)}" qid="${escapeXmlAttribute(
        mention.qid ?? "",
      )}">${escapeXmlText(
        window.text.slice(
          mention.range.start - window.range.start,
          mention.range.end - window.range.start,
        ),
      )}</mention>`,
    );
    cursor = mention.range.end;
  }

  parts.push(escapeXmlText(window.text.slice(cursor - window.range.start)));

  return parts.join("");
}

function buildSentenceOffsets(
  sentences: readonly WikilinkSentence[],
): ReadonlyArray<{ readonly end: number; readonly start: number }> {
  const offsets: Array<{ readonly end: number; readonly start: number }> = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const start = cursor;
    const end = start + sentence.text.length;

    offsets.push({ end, start });
    cursor = end + 1;
  }

  return offsets;
}

function normalizePredicate(predicate: string): string {
  return predicate
    .trim()
    .replace(/[\s-]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
