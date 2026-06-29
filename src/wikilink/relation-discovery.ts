import { z } from "zod";

import {
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
  type GuaranteedRequest,
} from "../guaranteed/index.js";
import type { LLMessage } from "../llm/index.js";
import {
  EVIDENCE_SELECTION_JSON_SHAPE,
  EVIDENCE_SELECTION_PROMPT_FRAGMENT,
  EvidenceResolver,
  normalizeEvidenceDisplayText,
  resolveEvidenceSelectionList,
  type EvidenceSelectionCandidate,
  type EvidenceSelectionList,
  type EvidenceSelectionSentence,
  type EvidenceResolutionFailure,
} from "../evidence-selection/index.js";
import { FragmentProjection } from "../reader/chunk-batch/index.js";

import type { WikilinkEvidenceWindow } from "./types.js";

export interface WikilinkSentence {
  readonly text: string;
  readonly wordsCount: number;
}

export interface WikilinkDiscoveredRelation {
  readonly confidence?: number;
  readonly evidenceEnd: number;
  readonly evidenceStart: number;
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
const evidenceSelectionItemSchema = z
  .object({
    quote: z.string().optional(),
    sentence_id: z.string().optional(),
  })
  .strict();
const relationEvidenceSchema = z.union([
  z
    .object({
      end_anchor: z.union([z.string(), evidenceAnchorSchema]).optional(),
      quote: z.string().optional(),
      sentence_id: z.string().optional(),
      start_anchor: z.union([z.string(), evidenceAnchorSchema]).optional(),
    })
    .strict(),
  z.array(evidenceSelectionItemSchema),
]);

const relationSchema = z
  .object({
    confidence: z.number().min(0).max(1).optional(),
    evidence: relationEvidenceSchema,
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

type RelationEvidenceData = z.infer<typeof relationEvidenceSchema>;

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

    const sentenceIds = projection.sentences.map(
      (sentence) => sentence.sentenceId,
    );
    const sentenceTexts = projection.sentences.map(
      (sentence) => sentence.projectedText,
    );
    const selectionSentences = projection.sentences.map(
      (sentence, sentenceIndex) => ({
        id: `S${sentenceIndex + 1}`,
        sentenceId: sentence.sentenceId,
        text: sentence.projectedText,
      }),
    );
    const [selectionResolution, selectionFailure] = resolveRelationEvidence({
      evidence: createRelationEvidenceSelection(relation.evidence),
      sentences: selectionSentences,
    });
    const [anchorResolution, anchorFailure] =
      !Array.isArray(relation.evidence) &&
      selectionResolution === undefined &&
      selectionFailure === undefined
        ? resolver.resolve(relation.evidence, sentenceIds, sentenceTexts)
        : [undefined, undefined];
    const effectiveResolution = selectionResolution ?? anchorResolution;
    const effectiveFailure =
      selectionFailure === undefined
        ? anchorFailure
        : toEvidenceResolutionFailure(selectionFailure);

    if (effectiveResolution === undefined) {
      issues.push(
        `${prefix}.evidence could not be resolved: ${
          effectiveFailure?.message ?? "unknown failure"
        }`,
      );
      continue;
    }

    const firstSentence = effectiveResolution.sentenceIds[0];
    const lastSentence = effectiveResolution.sentenceIds.at(-1);

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
    '- Every relation must connect two mention IDs from the <mention id="..." qid="..."> tags.',
    "- Do not create a relation just because two mentions are nearby.",
    "- Prefer the suggested predicates when one fits.",
    "- If none fits, create one short snake_case predicate.",
    "- Never use mentions as a predicate.",
    EVIDENCE_SELECTION_PROMPT_FRAGMENT,
    "- Do not use offsets or invented paraphrases as evidence.",
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
    "Untagged source sentences for evidence quotes:",
    formatEvidenceSentences(input),
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        relations: [
          {
            confidence: 0.86,
            evidence: EVIDENCE_SELECTION_JSON_SHAPE,
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

function formatEvidenceSentences(
  input: DiscoverWikilinkRelationsOptions,
): string {
  return input.sentences
    .map(
      (sentence, index) =>
        `S${index + 1}: ${normalizeEvidenceDisplayText(
          stripXmlLikeTags(sentence.text),
        )}`,
    )
    .join("\n");
}

function resolveRelationEvidence(input: {
  readonly evidence: EvidenceSelectionList | undefined;
  readonly sentences: readonly EvidenceSelectionSentence[];
}): readonly [
  resolution:
    | {
        readonly sentenceIds: readonly (readonly [number, number, number])[];
      }
    | undefined,
  failure:
    | {
        readonly candidates: readonly EvidenceSelectionCandidate[];
        readonly code: string;
        readonly message: string;
      }
    | undefined,
] {
  if (input.evidence === undefined) {
    return [undefined, undefined];
  }

  return resolveEvidenceSelectionList({
    evidence: input.evidence,
    sentences: input.sentences,
  });
}

function createRelationEvidenceSelection(
  evidence: RelationEvidenceData,
): EvidenceSelectionList | undefined {
  if (Array.isArray(evidence)) {
    return evidence.map(createRelationEvidenceSelectionItem);
  }

  const hasSelectionEvidence =
    typeof evidence.quote === "string" ||
    typeof evidence.sentence_id === "string";

  return hasSelectionEvidence
    ? createRelationEvidenceSelectionItem(evidence)
    : undefined;
}

function createRelationEvidenceSelectionItem(evidence: {
  readonly quote?: unknown;
  readonly sentence_id?: unknown;
}): {
  readonly quote?: string;
  readonly sentence_id?: string;
} {
  return {
    ...(typeof evidence.quote === "string" ? { quote: evidence.quote } : {}),
    ...(typeof evidence.sentence_id === "string"
      ? { sentence_id: evidence.sentence_id }
      : {}),
  };
}

function toEvidenceResolutionFailure(failure: {
  readonly candidates: readonly EvidenceSelectionCandidate[];
  readonly code: string;
  readonly message: string;
}): EvidenceResolutionFailure {
  return {
    candidates: failure.candidates.map((candidate) => ({
      exactNormalized: candidate.exactNormalized,
      exactRaw: candidate.exactRaw,
      exactSubstring: candidate.exactSubstring,
      index: candidate.index,
      nextText: candidate.nextText,
      occurrenceId: candidate.occurrenceId,
      prevText: candidate.prevText,
      score: candidate.score,
      sentenceId: candidate.sentence.sentenceId,
      text: candidate.sentence.text,
    })),
    code: failure.code,
    fieldName: "evidence",
    message: failure.message,
  };
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

function stripXmlLikeTags(value: string): string {
  return value.replace(/<[^>]*>/gu, "");
}
