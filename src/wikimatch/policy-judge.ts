import { z } from "zod";

import {
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
  type GuaranteedRequest,
} from "../guaranteed/index.js";
import type { LLMessage } from "../llm/index.js";

import { listCandidateSelectableQids } from "./options.js";
import type {
  WikimatchAcceptedMention,
  WikimatchCandidate,
  WikimatchConflictGroup,
  WikimatchPolicyContinuation,
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
    decision: z.enum(["continue", "recall", "skip_this_time", "never_recall"]),
    qid: z.string().optional(),
  })
  .strict();

const policyGroupSchema = z
  .object({
    decisions: z.array(policyDecisionSchema),
    groupId: z.string().min(1),
    note: z.string().max(24).optional(),
  })
  .strict();

const policyResponseSchema = z
  .object({
    groups: z.array(policyGroupSchema),
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
          options.window.groups,
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
      continuations: [],
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
    groups: response.groups.map((group) => ({
      decisions: group.decisions.map((decision) => ({
        candidateId: decision.candidateId,
        ...(decision.confidence === undefined
          ? {}
          : { confidence: decision.confidence }),
        decision: decision.decision,
        ...normalizeDecisionQid(decision.qid),
      })),
      groupId: group.groupId,
      ...(group.note === undefined ? {} : { note: group.note }),
    })),
  };
}

function normalizeDecisionQid(qid: string | undefined): {
  readonly qid?: string;
} {
  const normalized = qid?.trim();

  return normalized === undefined || normalized === ""
    ? {}
    : { qid: normalized };
}

export function parsePolicyResponse(
  candidates: readonly WikimatchCandidate[],
  response: WikimatchPolicyResponse,
  groups: readonly WikimatchConflictGroup[] = inferGroups(candidates),
): WikimatchPolicyJudgeResult {
  const issues = validatePolicyResponse(candidates, response, groups);

  if (issues.length > 0) {
    throw new ParsedJsonError(issues);
  }

  const candidatesById = createCandidateMap(candidates);
  const continuations: WikimatchPolicyContinuation[] = [];
  const mentions: WikimatchAcceptedMention[] = [];
  const policyUpdates: WikimatchPolicyUpdate[] = [];

  for (const group of response.groups) {
    const continuedCandidateIds: string[] = [];

    for (const decision of group.decisions) {
      const candidate = candidatesById.get(decision.candidateId)!;

      if (decision.decision === "continue") {
        continuedCandidateIds.push(candidate.id);
        continue;
      }

      if (decision.decision === "recall") {
        mentions.push({
          candidateId: candidate.id,
          ...(decision.confidence === undefined
            ? {}
            : { confidence: decision.confidence }),
          ...(group.note === undefined ? {} : { note: group.note }),
          qid: decision.qid!,
          range: candidate.range,
          surface: candidate.surface,
        });
        continue;
      }

      policyUpdates.push({
        candidateId: candidate.id,
        decision: decision.decision,
        ...(group.note === undefined ? {} : { note: group.note }),
        ...(decision.qid === undefined ? {} : { qid: decision.qid }),
        surface: candidate.surface,
      });
    }

    if (continuedCandidateIds.length > 0) {
      continuations.push({
        candidateIds: continuedCandidateIds,
        groupId: group.groupId,
      });
    }
  }

  return {
    continuations,
    mentions,
    policyUpdates,
  };
}

export function validatePolicyResponse(
  candidates: readonly WikimatchCandidate[],
  response: WikimatchPolicyResponse,
  groups: readonly WikimatchConflictGroup[] = inferGroups(candidates),
): readonly string[] {
  const issues: string[] = [];
  const candidatesById = createCandidateMap(candidates);
  const groupsById = createGroupMap(groups);
  const seenGroupIds = new Set<string>();
  const seenCandidateIds = new Set<string>();
  const recalled: Array<{
    readonly candidate: WikimatchCandidate;
    readonly decision: WikimatchPolicyDecisionOutput;
  }> = [];

  for (const group of response.groups) {
    const expectedCandidateIds = groupsById.get(group.groupId);

    if (expectedCandidateIds === undefined) {
      issues.push(
        `Unknown groupId "${group.groupId}". Use exactly these group IDs: ${[
          ...groupsById.keys(),
        ].join(", ")}.`,
      );
      continue;
    }
    if (seenGroupIds.has(group.groupId)) {
      issues.push(`Duplicate group result for ${group.groupId}.`);
      continue;
    }
    seenGroupIds.add(group.groupId);

    for (const decision of group.decisions) {
      const candidate = candidatesById.get(decision.candidateId);

      if (candidate === undefined) {
        issues.push(
          `Unknown candidateId "${decision.candidateId}". Use only one of: ${[
            ...candidatesById.keys(),
          ].join(", ")}.`,
        );
        continue;
      }
      if (!expectedCandidateIds.has(decision.candidateId)) {
        issues.push(
          `Candidate ${decision.candidateId} does not belong to group ${group.groupId}. Use only candidates from that group: ${[
            ...expectedCandidateIds,
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

      if (decision.decision === "continue") {
        if (decision.qid !== undefined) {
          issues.push(
            `Candidate ${candidate.id} uses decision "continue" but includes qid. Continue means this candidate page has no final choice yet.`,
          );
        }
        if (candidate.hasMoreOptions !== true) {
          issues.push(
            `Candidate ${candidate.id} uses decision "continue", but there are no more candidate pages for "${candidate.surface}". Use recall, skip_this_time, or never_recall.`,
          );
        }
        continue;
      }

      if (decision.qid !== undefined) {
        issues.push(
          `Candidate ${candidate.id} uses decision "${decision.decision}" but includes qid. Include qid only when decision is "recall".`,
        );
      }
    }
  }

  for (const groupId of groupsById.keys()) {
    if (!seenGroupIds.has(groupId)) {
      issues.push(
        `Missing group result for ${groupId}. Return exactly one result for every input group; use decisions: [] when nothing should be recalled.`,
      );
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
  return listCandidateSelectableQids(candidate);
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

function createGroupMap(
  groups: readonly WikimatchConflictGroup[],
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    groups.map((group) => [group.id, new Set(group.candidateIds)]),
  );
}

function inferGroups(
  candidates: readonly WikimatchCandidate[],
): readonly WikimatchConflictGroup[] {
  if (candidates.length === 0) {
    return [];
  }

  return [
    {
      candidateIds: candidates.map((candidate) => candidate.id),
      id: "g1",
      range: {
        end: Math.max(...candidates.map((candidate) => candidate.range.end)),
        start: Math.min(
          ...candidates.map((candidate) => candidate.range.start),
        ),
      },
    },
  ];
}

function buildPolicyMessages(input: WikimatchPolicyJudgeInput): LLMessage[] {
  return [
    {
      role: "system",
      content: formatPolicySystemPrompt(input),
    },
    {
      role: "user",
      content: formatPolicyPrompt(input),
    },
  ];
}

function formatPolicySystemPrompt(input: WikimatchPolicyJudgeInput): string {
  return [
    "You judge which precomputed Wikidata mention candidates should be recalled.",
    "",
    "Recall policy:",
    input.policyPrompt,
    "",
    "Rules:",
    "- Return JSON only.",
    "- Return exactly one group result for every input group.",
    "- Use decisions: [] only when this group has no selected mention and no policy update.",
    "- First judge whether each candidate mention is worth recalling in this exact tagged context, before choosing among QID candidates.",
    '- If the mention is not worth recalling in context, use "never_recall" immediately; do not inspect later pages just because more QIDs might exist.',
    '- Use "never_recall" when this exact candidate span is not a standalone knowledge graph object in context.',
    "- Candidate lists may be incomplete when a candidate has more pages.",
    '- Use decision "continue" only after the mention has passed the context-worthiness test and the current candidate page has no good QID but more pages are available.',
    '- "continue" is not a rejection. It asks to inspect the next candidate page for that candidate.',
    '- If a surface should be recalled but the current incomplete page lacks a suitable QID, use "continue" instead of skip_this_time.',
    '- Do not use "continue" for single-character surnames, abbreviations, side labels, generic words, fragments, roles, quantities, attributes, or discourse words that are not useful standalone knowledge graph objects in context.',
    "- Do not invent candidates, ranges, surfaces, or QIDs.",
    "- A recalled mention must choose a QID from entityOptions or disambiguationOptions.meanings.",
    '- Include qid only when decision is "recall"; do not include qid for continue, skip_this_time, or never_recall.',
    "- Never return DIS identifiers as qid values; DIS identifiers are only disambiguation references.",
    "- Overlapping recalled ranges are illegal; choose the most specific valid mention.",
  ].join("\n");
}

function formatPolicyPrompt(input: WikimatchPolicyJudgeInput): string {
  return [
    "Tagged context:",
    formatTaggedContext(input),
    "",
    "Candidate groups:",
    JSON.stringify(formatGroupsForPrompt(input), null, 2),
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        groups: [
          {
            decisions: [
              {
                candidateId: "candidate id from this group",
                confidence: 0.9,
                decision: "recall | continue | skip_this_time | never_recall",
                qid: "required only when decision is recall",
              },
            ],
            groupId: "group id from the input",
            note: "optional, <= 12 Chinese chars or 6 English words",
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
        : [formatCandidateForPrompt(candidate, group)];
    }),
    groupId: group.id,
    text: input.window.text.slice(
      group.range.start - input.window.baseOffset,
      group.range.end - input.window.baseOffset,
    ),
  }));
}

export function formatCandidateForPrompt(
  candidate: WikimatchCandidate,
  group: WikimatchConflictGroup,
): object {
  const formattedOptions = formatQidOptions(candidate.qidOptions);

  return {
    candidateId: candidate.id,
    ...(candidate.hasMoreOptions === true ? { hasMoreOptions: true } : {}),
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

function formatQidOptions(options: readonly WikimatchQidOption[]): {
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
