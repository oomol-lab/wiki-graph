import { z } from "zod";

import {
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
  type GuaranteedRequest,
} from "../../guaranteed/index.js";
import type { LLMessage } from "../../llm/index.js";

import type {
  WikimatchProtectedSurface,
  WikimatchSurface,
  WikimatchSurfaceProtectionInput,
  WikimatchSurfaceProtectionResponse,
  WikimatchSurfaceProtectionResult,
} from "../types.js";

const protectedSurfaceSchema = z
  .object({
    note: z.string().max(24).optional(),
    surfaceId: z.string().min(1),
  })
  .strict();

const protectionResponseSchema = z
  .object({
    protectedSurfaces: z.array(protectedSurfaceSchema),
  })
  .strict();

export interface JudgeWikimatchSurfaceProtectionOptions extends WikimatchSurfaceProtectionInput {
  readonly maxRetries?: number;
  readonly request: GuaranteedRequest;
}

export async function judgeWikimatchSurfaceProtection(
  options: JudgeWikimatchSurfaceProtectionOptions,
): Promise<WikimatchSurfaceProtectionResult> {
  if (options.suspiciousSurfaces.length === 0) {
    return { protectedSurfaces: [] };
  }

  try {
    return await requestGuaranteedJson({
      messages: buildProtectionMessages(options),
      parse: (response) =>
        parseSurfaceProtectionResponse(
          options.suspiciousSurfaces,
          normalizeProtectionResponse(response),
        ),
      request: options.request,
      responseIntentClassifierPrompt:
        RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
      schema: protectionResponseSchema,
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
      protectedSurfaces: [],
    };
  }
}

function normalizeProtectionResponse(
  response: z.infer<typeof protectionResponseSchema>,
): WikimatchSurfaceProtectionResponse {
  return {
    protectedSurfaces: response.protectedSurfaces.map((surface) => ({
      ...(surface.note === undefined ? {} : { note: surface.note }),
      surfaceId: surface.surfaceId,
    })),
  };
}

export function parseSurfaceProtectionResponse(
  surfaces: readonly WikimatchSurface[],
  response: WikimatchSurfaceProtectionResponse,
): WikimatchSurfaceProtectionResult {
  const issues = validateSurfaceProtectionResponse(surfaces, response);

  if (issues.length > 0) {
    throw new ParsedJsonError(issues);
  }

  const surfacesById = createSurfaceMap(surfaces);
  const protectedSurfaces: WikimatchProtectedSurface[] = [];

  for (const surface of response.protectedSurfaces) {
    const source = surfacesById.get(surface.surfaceId)!;

    protectedSurfaces.push({
      ...(surface.note === undefined ? {} : { note: surface.note }),
      surfaceId: surface.surfaceId,
      text: source.text,
    });
  }

  return { protectedSurfaces };
}

export function validateSurfaceProtectionResponse(
  surfaces: readonly WikimatchSurface[],
  response: WikimatchSurfaceProtectionResponse,
): readonly string[] {
  const issues: string[] = [];
  const surfacesById = createSurfaceMap(surfaces);
  const seenIds = new Set<string>();

  for (const surface of response.protectedSurfaces) {
    if (!surfacesById.has(surface.surfaceId)) {
      issues.push(
        `Unknown surfaceId "${surface.surfaceId}". Use only these surface IDs: ${[
          ...surfacesById.keys(),
        ].join(", ")}.`,
      );
      continue;
    }
    if (seenIds.has(surface.surfaceId)) {
      issues.push(`Duplicate protected surface ${surface.surfaceId}.`);
      continue;
    }

    seenIds.add(surface.surfaceId);
  }

  return issues;
}

function buildProtectionMessages(
  input: WikimatchSurfaceProtectionInput,
): LLMessage[] {
  return [
    {
      role: "system",
      content: formatProtectionSystemPrompt(input),
    },
    {
      role: "user",
      content: formatProtectionPrompt(input),
    },
  ];
}

function formatProtectionSystemPrompt(
  input: WikimatchSurfaceProtectionInput,
): string {
  return [
    "You protect useful high-frequency surface strings before Wikidata grounding.",
    "",
    "The input surfaces are suspicious only because they are frequent after range suppression.",
    "Most high-frequency function words, fragments, punctuation, generic words, and discourse words should NOT be protected.",
    "A surface that is not protected will be removed before grounding.",
    "",
    "User recall policy:",
    input.policyPrompt,
    "",
    "Protect a surface only when it is likely to be a meaningful entity, named concept, named event, place, person, organization, work, or domain term under the policy.",
    "",
    "Rules:",
    "- Return JSON only.",
    "- Return only protected surface IDs.",
    "- Do not return a result for every input surface.",
    "- Do not protect generic grammar words merely because they appear often.",
    "- Do not infer or choose Wikidata QIDs in this stage.",
  ].join("\n");
}

function formatProtectionPrompt(
  input: WikimatchSurfaceProtectionInput,
): string {
  return [
    "Suspicious high-frequency surfaces:",
    JSON.stringify(
      input.suspiciousSurfaces.map((surface) => ({
        count: surface.count,
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
        protectedSurfaces: [
          {
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
