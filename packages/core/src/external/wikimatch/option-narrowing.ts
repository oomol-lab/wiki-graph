import { z } from "zod";

import {
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
  type GuaranteedRequest,
} from "../guaranteed/index.js";
import type { LLMessage } from "../llm/index.js";

import {
  filterCandidateQidOptions,
  listCandidateSelectableQids,
  splitCandidateByOptionBudget,
} from "./options.js";
import { formatCandidateForPrompt } from "./policy-judge.js";
import type {
  NarrowWikimatchCandidateOptionsInput,
  WikimatchCandidate,
  WikimatchCandidateOptionNarrowingResponse,
  WikimatchCandidateOptionNarrowingResult,
} from "./types.js";

const narrowingItemSchema = z
  .object({
    decision: z.enum(["keep", "reject"]),
    qid: z.string().regex(/^Q[1-9][0-9]*$/),
  })
  .strict();

const narrowingResponseSchema = z
  .object({
    qids: z.array(narrowingItemSchema),
  })
  .strict();

export interface NarrowWikimatchCandidateOptionsOptions extends NarrowWikimatchCandidateOptionsInput {
  readonly maxRetries?: number;
  readonly optionBudget: number;
  readonly request: GuaranteedRequest;
}

export async function narrowWikimatchCandidateOptions(
  options: NarrowWikimatchCandidateOptionsOptions,
): Promise<WikimatchCandidateOptionNarrowingResult> {
  const keptQids = new Set<string>();
  const issues: string[] = [];

  for (const chunk of splitCandidateByOptionBudget(
    options.candidate,
    options.optionBudget,
  )) {
    const result = await requestNarrowedChunk({
      ...options,
      candidate: chunk,
    });

    if (result.fallback !== undefined) {
      issues.push(...result.fallback.issues);
      continue;
    }

    for (const qid of listCandidateSelectableQids(result.candidate)) {
      keptQids.add(qid);
    }
  }

  if (issues.length > 0) {
    return {
      candidate: {
        ...options.candidate,
        qidOptions: [],
      },
      fallback: {
        issues,
        reason: "guaranteed_json_failed",
      },
    };
  }

  return {
    candidate: filterCandidateQidOptions(options.candidate, keptQids),
  };
}

async function requestNarrowedChunk(
  options: NarrowWikimatchCandidateOptionsOptions,
): Promise<WikimatchCandidateOptionNarrowingResult> {
  try {
    return await requestGuaranteedJson({
      messages: buildNarrowingMessages(options),
      parse: (response) =>
        parseNarrowingResponse(
          options.candidate,
          normalizeNarrowingResponse(response),
        ),
      request: options.request,
      responseIntentClassifierPrompt:
        RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
      schema: narrowingResponseSchema,
      ...(options.maxRetries === undefined
        ? {}
        : { maxRetries: options.maxRetries }),
    });
  } catch (error) {
    return {
      candidate: {
        ...options.candidate,
        qidOptions: [],
      },
      fallback: {
        issues: [formatFallbackIssue(error)],
        reason: "guaranteed_json_failed",
      },
    };
  }
}

function normalizeNarrowingResponse(
  response: z.infer<typeof narrowingResponseSchema>,
): WikimatchCandidateOptionNarrowingResponse {
  return {
    qids: response.qids.map((item) => ({
      decision: item.decision,
      qid: item.qid,
    })),
  };
}

export function parseNarrowingResponse(
  candidate: WikimatchCandidate,
  response: WikimatchCandidateOptionNarrowingResponse,
): WikimatchCandidateOptionNarrowingResult {
  const issues = validateNarrowingResponse(candidate, response);

  if (issues.length > 0) {
    throw new ParsedJsonError(issues);
  }

  return {
    candidate: filterCandidateQidOptions(
      candidate,
      new Set(
        response.qids
          .filter((item) => item.decision === "keep")
          .map((item) => item.qid),
      ),
    ),
  };
}

export function validateNarrowingResponse(
  candidate: WikimatchCandidate,
  response: WikimatchCandidateOptionNarrowingResponse,
): readonly string[] {
  const issues: string[] = [];
  const allowedQids = new Set(listCandidateSelectableQids(candidate));
  const seenQids = new Set<string>();

  for (const item of response.qids) {
    if (!allowedQids.has(item.qid)) {
      issues.push(
        `Unknown qid "${item.qid}" for candidate ${candidate.id}. Use exactly these QIDs: ${[
          ...allowedQids,
        ].join(", ")}.`,
      );
      continue;
    }
    if (seenQids.has(item.qid)) {
      issues.push(`Duplicate narrowing result for qid ${item.qid}.`);
      continue;
    }

    seenQids.add(item.qid);
  }

  for (const qid of allowedQids) {
    if (!seenQids.has(qid)) {
      issues.push(
        `Missing narrowing result for qid ${qid}. Return exactly one keep/reject decision for every input QID.`,
      );
    }
  }

  return issues;
}

function buildNarrowingMessages(
  input: NarrowWikimatchCandidateOptionsInput,
): LLMessage[] {
  return [
    {
      role: "system",
      content: formatNarrowingSystemPrompt(input),
    },
    {
      role: "user",
      content: formatNarrowingPrompt(input),
    },
  ];
}

function formatNarrowingSystemPrompt(
  input: NarrowWikimatchCandidateOptionsInput,
): string {
  return [
    "You narrow an oversized Wikidata candidate option list before final mention grounding.",
    "",
    "Recall policy:",
    input.policyPrompt,
    "",
    "Rules:",
    "- Return JSON only.",
    "- Return exactly one keep/reject decision for every input QID.",
    "- Keep any QID that could plausibly ground this surface in the current context.",
    "- Reject QIDs that are clearly unrelated to the surface and context.",
    "- Be conservative when uncertain; keep plausible meanings so the final grounding request can decide.",
    "- Do not invent QIDs.",
  ].join("\n");
}

function formatNarrowingPrompt(
  input: NarrowWikimatchCandidateOptionsInput,
): string {
  return [
    "Context:",
    input.text,
    "",
    "Oversized candidate:",
    JSON.stringify(
      formatCandidateForPrompt(input.candidate, {
        candidateIds: [input.candidate.id],
        id: "g1",
        range: input.candidate.range,
      }),
      null,
      2,
    ),
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        qids: [
          {
            decision: "keep | reject",
            qid: "QID from the input",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
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
