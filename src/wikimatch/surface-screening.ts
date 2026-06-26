import { z } from "zod";

import {
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
  type GuaranteedRequest,
} from "../guaranteed/index.js";
import type { LLMessage } from "../llm/index.js";

import type {
  WikimatchSurface,
  WikimatchSurfaceScreeningInput,
  WikimatchSurfaceScreeningItem,
  WikimatchSurfaceScreeningResponse,
  WikimatchSurfaceScreeningResult,
} from "./types.js";

const surfaceScreeningItemSchema = z
  .object({
    decision: z.enum(["allow", "skip_this_time", "global_blocklist_candidate"]),
    note: z.string().max(24).optional(),
    surfaceId: z.string().min(1),
  })
  .strict();

const surfaceScreeningResponseSchema = z
  .object({
    surfaces: z.array(surfaceScreeningItemSchema),
  })
  .strict();

export interface JudgeWikimatchSurfaceScreeningOptions extends WikimatchSurfaceScreeningInput {
  readonly maxRetries?: number;
  readonly request: GuaranteedRequest;
}

export async function judgeWikimatchSurfaceScreening(
  options: JudgeWikimatchSurfaceScreeningOptions,
): Promise<WikimatchSurfaceScreeningResult> {
  try {
    return await requestGuaranteedJson({
      messages: buildSurfaceScreeningMessages(options),
      parse: (response) =>
        parseSurfaceScreeningResponse(
          options.window.surfaces,
          normalizeSurfaceScreeningResponse(response),
        ),
      request: options.request,
      responseIntentClassifierPrompt:
        RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
      schema: surfaceScreeningResponseSchema,
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
      surfaces: [],
    };
  }
}

function normalizeSurfaceScreeningResponse(
  response: z.infer<typeof surfaceScreeningResponseSchema>,
): WikimatchSurfaceScreeningResponse {
  return {
    surfaces: response.surfaces.map((surface) => ({
      decision: surface.decision,
      ...(surface.note === undefined ? {} : { note: surface.note }),
      surfaceId: surface.surfaceId,
    })),
  };
}

export function parseSurfaceScreeningResponse(
  surfaces: readonly WikimatchSurface[],
  response: WikimatchSurfaceScreeningResponse,
): WikimatchSurfaceScreeningResult {
  const issues = validateSurfaceScreeningResponse(surfaces, response);

  if (issues.length > 0) {
    throw new ParsedJsonError(issues);
  }

  const surfacesById = createSurfaceMap(surfaces);

  return {
    surfaces: response.surfaces.map((surface) => {
      const source = surfacesById.get(surface.surfaceId)!;

      return {
        decision: surface.decision,
        ...(surface.note === undefined ? {} : { note: surface.note }),
        surfaceId: surface.surfaceId,
        text: source.text,
      };
    }),
  };
}

export function validateSurfaceScreeningResponse(
  surfaces: readonly WikimatchSurface[],
  response: WikimatchSurfaceScreeningResponse,
): readonly string[] {
  const issues: string[] = [];
  const surfacesById = createSurfaceMap(surfaces);
  const seenIds = new Set<string>();

  for (const surface of response.surfaces) {
    if (!surfacesById.has(surface.surfaceId)) {
      issues.push(
        `Unknown surfaceId "${surface.surfaceId}". Use exactly these surface IDs: ${[
          ...surfacesById.keys(),
        ].join(", ")}.`,
      );
      continue;
    }
    if (seenIds.has(surface.surfaceId)) {
      issues.push(`Duplicate result for surface ${surface.surfaceId}.`);
      continue;
    }

    seenIds.add(surface.surfaceId);
  }

  for (const surface of surfaces) {
    if (!seenIds.has(surface.id)) {
      issues.push(
        `Missing result for ${surface.id}. Return exactly one result for every input surface.`,
      );
    }
  }

  return issues;
}

function buildSurfaceScreeningMessages(
  input: WikimatchSurfaceScreeningInput,
): LLMessage[] {
  return [
    {
      role: "system",
      content: formatSurfaceScreeningSystemPrompt(input),
    },
    {
      role: "user",
      content: formatSurfaceScreeningPrompt(input),
    },
  ];
}

function formatSurfaceScreeningSystemPrompt(
  input: WikimatchSurfaceScreeningInput,
): string {
  return [
    "You screen raw surface strings before Wikidata grounding.",
    "",
    "User recall policy:",
    input.policyPrompt,
    "",
    "Decision meanings:",
    "- allow: this surface is worth sending to the grounding stage under the user recall policy and current context.",
    "- skip_this_time: this surface should not be grounded in this context, but it may be useful in another context.",
    "- global_blocklist_candidate: this exact string is useless as an entity mention in any context, such as punctuation, pure numbers, isolated letters, or function words.",
    "",
    "Rules:",
    "- Return JSON only.",
    "- Return exactly one result for every input surface.",
    "- The user recall policy decides allow vs skip_this_time only.",
    "- Use global_blocklist_candidate only for strings that are context-independent noise.",
    "- Do not use global_blocklist_candidate for meaningful words that are merely irrelevant to this context.",
    "- Do not infer or choose Wikidata QIDs in this stage.",
  ].join("\n");
}

function formatSurfaceScreeningPrompt(
  input: WikimatchSurfaceScreeningInput,
): string {
  return [
    "Context:",
    input.window.text,
    "",
    "Surfaces:",
    JSON.stringify(
      input.window.surfaces.map((surface) => ({
        surfaceId: surface.id,
        text: surface.text,
      })),
      null,
      2,
    ),
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        surfaces: [
          {
            decision: "allow | skip_this_time | global_blocklist_candidate",
            note: "optional, <= 12 Chinese chars or 6 English words",
            surfaceId: "surface id from the input",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
}

function createSurfaceMap(
  surfaces: readonly WikimatchSurface[],
): ReadonlyMap<string, WikimatchSurface> {
  return new Map(surfaces.map((surface) => [surface.id, surface]));
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
