import { z } from "zod";

import {
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
  type GuaranteedRequest,
} from "../guaranteed/index.js";
import type { LLMessage } from "../llm/index.js";

import type {
  WikimatchAcceptedMention,
  WikimatchCandidate,
  WikimatchConflictGroup,
  WikimatchQidOption,
  WikimatchPolicyDecisionOutput,
  WikimatchPolicyJudgeInput,
  WikimatchPolicyJudgeResult,
  WikimatchPolicyResponse,
  WikimatchPolicyUpdate,
} from "./types.js";

const policyDecisionSchema = z
  .object({
    candidateId: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    decision: z.enum(["recall", "skip_this_time", "never_recall"]),
    qid: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

const policyResponseSchema = z
  .object({
    decisions: z.array(policyDecisionSchema),
  })
  .strict();

export interface JudgeWikimatchPolicyOptions extends WikimatchPolicyJudgeInput {
  readonly maxRetries?: number;
  readonly request: GuaranteedRequest;
}

export async function judgeWikimatchPolicy(
  options: JudgeWikimatchPolicyOptions,
): Promise<WikimatchPolicyJudgeResult> {
  try {
    return await requestGuaranteedJson({
      messages: buildPolicyMessages(options),
      parse: (response) =>
        parsePolicyResponse(
          options.candidates,
          normalizePolicyResponse(response),
        ),
      request: options.request,
      responseIntentClassifierPrompt:
        RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
      schema: policyResponseSchema,
      ...(options.maxRetries === undefined
        ? {}
        : { maxRetries: options.maxRetries }),
    });
  } catch (error) {
    return {
      fallback: {
        issues: [formatFallbackIssue(error)],
        reason: "guaranteed_json_failed",
      },
      mentions: [],
      policyUpdates: [],
    };
  }
}

function normalizePolicyResponse(
  response: z.infer<typeof policyResponseSchema>,
): WikimatchPolicyResponse {
  return {
    decisions: response.decisions.map((decision) => ({
      candidateId: decision.candidateId,
      ...(decision.confidence === undefined
        ? {}
        : { confidence: decision.confidence }),
      decision: decision.decision,
      ...(decision.qid === undefined ? {} : { qid: decision.qid }),
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    })),
  };
}

export function parsePolicyResponse(
  candidates: readonly WikimatchCandidate[],
  response: WikimatchPolicyResponse,
): WikimatchPolicyJudgeResult {
  const issues = validatePolicyResponse(candidates, response);

  if (issues.length > 0) {
    throw new ParsedJsonError(issues);
  }

  const candidatesById = createCandidateMap(candidates);
  const mentions: WikimatchAcceptedMention[] = [];
  const policyUpdates: WikimatchPolicyUpdate[] = [];

  for (const decision of response.decisions) {
    const candidate = candidatesById.get(decision.candidateId)!;

    if (decision.decision === "recall") {
      mentions.push({
        candidateId: candidate.id,
        ...(decision.confidence === undefined
          ? {}
          : { confidence: decision.confidence }),
        qid: decision.qid!,
        range: candidate.range,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        surface: candidate.surface,
      });
      continue;
    }

    policyUpdates.push({
      candidateId: candidate.id,
      decision: decision.decision,
      ...(decision.qid === undefined ? {} : { qid: decision.qid }),
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      surface: candidate.surface,
    });
  }

  return {
    mentions,
    policyUpdates,
  };
}

export function validatePolicyResponse(
  candidates: readonly WikimatchCandidate[],
  response: WikimatchPolicyResponse,
): readonly string[] {
  const issues: string[] = [];
  const candidatesById = createCandidateMap(candidates);
  const seenCandidateIds = new Set<string>();
  const recalled: Array<{
    readonly candidate: WikimatchCandidate;
    readonly decision: WikimatchPolicyDecisionOutput;
  }> = [];

  for (const decision of response.decisions) {
    const candidate = candidatesById.get(decision.candidateId);

    if (candidate === undefined) {
      issues.push(
        `Unknown candidateId "${decision.candidateId}". Use only one of: ${[
          ...candidatesById.keys(),
        ].join(", ")}.`,
      );
      continue;
    }
    if (seenCandidateIds.has(decision.candidateId)) {
      issues.push(
        `Duplicate decision for candidate ${decision.candidateId}. Return exactly one decision per candidate at most.`,
      );
      continue;
    }

    seenCandidateIds.add(decision.candidateId);

    if (decision.decision === "recall") {
      validateRecallDecision(issues, candidate, decision);
      recalled.push({ candidate, decision });
      continue;
    }

    if (decision.qid !== undefined && !isAllowedQid(candidate, decision.qid)) {
      issues.push(formatIllegalQidIssue(candidate, decision.qid));
    }
  }

  for (let leftIndex = 0; leftIndex < recalled.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < recalled.length;
      rightIndex += 1
    ) {
      const left = recalled[leftIndex]!;
      const right = recalled[rightIndex]!;

      if (rangesOverlap(left.candidate.range, right.candidate.range)) {
        issues.push(
          `Decision conflict: candidates ${left.candidate.id} and ${right.candidate.id} both use decision "recall", but their ranges overlap.\n` +
            `- ${left.candidate.id}: "${left.candidate.surface}" [${left.candidate.range.start}, ${left.candidate.range.end})\n` +
            `- ${right.candidate.id}: "${right.candidate.surface}" [${right.candidate.range.start}, ${right.candidate.range.end})\n` +
            "Only one recalled mention may occupy an overlapping text range. Choose the most specific valid mention, or mark the others as skip_this_time / never_recall.",
        );
      }
    }
  }

  return issues;
}

function validateRecallDecision(
  issues: string[],
  candidate: WikimatchCandidate,
  decision: WikimatchPolicyDecisionOutput,
): void {
  if (decision.qid === undefined) {
    issues.push(
      `Candidate ${candidate.id} uses decision "recall" but does not provide qid. A recalled mention must choose one concrete QID from the candidate options.`,
    );
    return;
  }
  if (isDisambiguationQid(candidate, decision.qid)) {
    issues.push(
      `Candidate ${candidate.id} selected source disambiguation QID ${decision.qid}. Source disambiguation QIDs are hidden behind DIS references and cannot be final mention groundings. Choose a QID from entityOptions or disambiguationOptions.meanings instead.`,
    );
    return;
  }
  if (!isAllowedQid(candidate, decision.qid)) {
    issues.push(formatIllegalQidIssue(candidate, decision.qid));
  }
}

function isAllowedQid(candidate: WikimatchCandidate, qid: string): boolean {
  return listAllowedQids(candidate).includes(qid);
}

function isDisambiguationQid(
  candidate: WikimatchCandidate,
  qid: string,
): boolean {
  return candidate.qidOptions.some(
    (option) => option.disambiguation !== undefined && option.qid === qid,
  );
}

function listAllowedQids(candidate: WikimatchCandidate): readonly string[] {
  return [
    ...new Set(
      candidate.qidOptions.flatMap((option) => [
        ...(option.disambiguation === undefined ? [option.qid] : []),
        ...(option.disambiguation?.linkedQids.map((item) => item.qid) ?? []),
      ]),
    ),
  ];
}

function formatIllegalQidIssue(
  candidate: WikimatchCandidate,
  qid: string,
): string {
  return (
    `Candidate ${candidate.id} selected qid ${qid}, but that QID is not available for this candidate. ` +
    `Allowed QIDs for "${candidate.surface}" are: ${listAllowedQids(candidate).join(", ")}.`
  );
}

function rangesOverlap(
  left: { readonly end: number; readonly start: number },
  right: { readonly end: number; readonly start: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function createCandidateMap(
  candidates: readonly WikimatchCandidate[],
): ReadonlyMap<string, WikimatchCandidate> {
  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

function buildPolicyMessages(input: WikimatchPolicyJudgeInput): LLMessage[] {
  return [
    {
      role: "system",
      content: [
        "You judge which precomputed Wikidata mention candidates should be recalled.",
        "Return JSON only.",
        "Do not invent candidates, ranges, surfaces, or QIDs.",
        "A recalled mention must choose a QID from entityOptions or disambiguationOptions.meanings.",
        "Never return DIS identifiers as qid values; DIS identifiers are only disambiguation references.",
        "Overlapping recalled ranges are illegal; choose the most specific valid mention.",
      ].join("\n"),
    },
    {
      role: "user",
      content: formatPolicyPrompt(input),
    },
  ];
}

function formatPolicyPrompt(input: WikimatchPolicyJudgeInput): string {
  return [
    "Recall policy:",
    input.policyPrompt,
    "",
    "Tagged context:",
    formatTaggedContext(input),
    "",
    "Candidate groups:",
    JSON.stringify(formatGroupsForPrompt(input), null, 2),
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        decisions: [
          {
            candidateId: "candidate id from the input",
            confidence: 0.9,
            decision: "recall | skip_this_time | never_recall",
            qid: "required only for recall; optional for non-recall",
            reason: "brief reason",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
}

function formatTaggedContext(input: WikimatchPolicyJudgeInput): string {
  const groups = [...input.window.groups].sort(
    (left, right) => left.range.start - right.range.start,
  );
  const parts: string[] = [];
  let cursor = input.window.baseOffset;

  for (const group of groups) {
    parts.push(
      input.window.text.slice(
        cursor - input.window.baseOffset,
        group.range.start - input.window.baseOffset,
      ),
    );
    parts.push(
      `<group id="${escapeXmlAttribute(group.id)}">${escapeXmlText(
        input.window.text.slice(
          group.range.start - input.window.baseOffset,
          group.range.end - input.window.baseOffset,
        ),
      )}</group>`,
    );
    cursor = group.range.end;
  }

  parts.push(input.window.text.slice(cursor - input.window.baseOffset));

  return parts.join("");
}

function formatGroupsForPrompt(input: WikimatchPolicyJudgeInput): object[] {
  const candidatesById = createCandidateMap(input.window.candidates);

  return input.window.groups.map((group) => ({
    candidates: group.candidateIds.flatMap((candidateId) => {
      const candidate = candidatesById.get(candidateId);

      return candidate === undefined
        ? []
        : [formatCandidateForPrompt(candidate, group, input.window.baseOffset)];
    }),
    groupId: group.id,
    text: input.window.text.slice(
      group.range.start - input.window.baseOffset,
      group.range.end - input.window.baseOffset,
    ),
  }));
}

function formatCandidateForPrompt(
  candidate: WikimatchCandidate,
  group: WikimatchConflictGroup,
  baseOffset: number,
): object {
  const formattedOptions = formatQidOptions(candidate.qidOptions);

  return {
    candidateId: candidate.id,
    ...(formattedOptions.disambiguationOptions.length === 0
      ? {}
      : { disambiguationOptions: formattedOptions.disambiguationOptions }),
    ...(formattedOptions.entityOptions.length === 0
      ? {}
      : { entityOptions: formattedOptions.entityOptions }),
    offset: candidate.range.start - group.range.start,
    surface: candidate.surface,
  };
}

function formatQidOptions(
  options: readonly WikimatchQidOption[],
): {
  readonly disambiguationOptions: readonly object[];
  readonly entityOptions: readonly object[];
} {
  const disambiguationOptions: object[] = [];
  const entityOptions: object[] = [];

  for (const option of options) {
    if (option.disambiguation !== undefined) {
      disambiguationOptions.push({
        id: `DIS${disambiguationOptions.length + 1}`,
        ...(option.label === undefined ? {} : { label: option.label }),
        meanings:
          option.disambiguation.profile?.meanings ??
          option.disambiguation.linkedQids.map((item) => ({
            information: "",
            name: item.title,
            priority: "other",
            qid: item.qid,
          })),
      });
      continue;
    }

    entityOptions.push({
      ...(option.description === undefined
        ? {}
        : { description: option.description }),
      ...(option.label === undefined ? {} : { label: option.label }),
      qid: option.qid,
    });
  }

  return {
    disambiguationOptions,
    entityOptions,
  };
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

function formatFallbackIssue(error: unknown): string {
  if (error instanceof ParsedJsonError) {
    return error.issues.join("\n");
  }
  if (error instanceof Error) {
    const issues = (error as { readonly issues?: unknown }).issues;

    if (
      Array.isArray(issues) &&
      issues.every((issue) => typeof issue === "string")
    ) {
      return issues.join("\n");
    }

    return error.message;
  }

  return String(error);
}
