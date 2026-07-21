import { z } from "zod";

import {
  ParsedJsonError,
  RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
  requestGuaranteedJson,
  type GuaranteedRequest,
} from "../guaranteed/index.js";
import type { LLMessage } from "../llm/index.js";

import type {
  DisambiguationLinkedQid,
  DisambiguationProfile,
  DisambiguationProfileMeaning,
  DisambiguationProfileNormalizer,
  DisambiguationProfileNormalizerInput,
} from "./types.js";

const profileMeaningSchema = z
  .object({
    category: z.string().min(1).optional(),
    information: z.string(),
    name: z.string().min(1),
    priority: z.enum(["primary", "secondary", "other"]),
    qid: z.string().regex(/^Q[1-9]\d*$/u),
  })
  .strict();

const profileSchema = z
  .object({
    meanings: z.array(profileMeaningSchema),
    sourceQid: z.string().regex(/^Q[1-9]\d*$/u),
    surface: z.string().min(1).optional(),
  })
  .strict();

export interface CreateDisambiguationProfileNormalizerOptions {
  readonly maxMeanings?: number;
  readonly maxRetries?: number;
  readonly request: GuaranteedRequest;
}

export function createDisambiguationProfileNormalizer(
  options: CreateDisambiguationProfileNormalizerOptions,
): DisambiguationProfileNormalizer {
  return async (input) =>
    await requestGuaranteedJson({
      messages: buildNormalizerMessages(input, options.maxMeanings ?? 24),
      parse: (profile) =>
        parseDisambiguationProfile(input, normalizeProfile(profile)),
      request: options.request,
      responseIntentClassifierPrompt:
        RESPONSE_INTENT_CLASSIFIER_PROMPT_TEMPLATE,
      schema: profileSchema,
      ...(options.maxRetries === undefined
        ? {}
        : { maxRetries: options.maxRetries }),
    });
}

function normalizeProfile(
  profile: z.infer<typeof profileSchema>,
): DisambiguationProfile {
  return {
    meanings: profile.meanings.map((meaning) => ({
      ...(meaning.category === undefined ? {} : { category: meaning.category }),
      information: meaning.information,
      name: meaning.name,
      priority: meaning.priority,
      qid: meaning.qid,
    })),
    sourceQid: profile.sourceQid,
    ...(profile.surface === undefined ? {} : { surface: profile.surface }),
  };
}

function parseDisambiguationProfile(
  input: DisambiguationProfileNormalizerInput,
  profile: DisambiguationProfile,
): DisambiguationProfile {
  const pageQidLinks = new Set(input.pageQidLinks.map((item) => item.qid));
  const issues: string[] = [];
  const seen = new Set<string>();
  const meanings: DisambiguationProfileMeaning[] = [];

  if (profile.sourceQid !== input.sourceQid) {
    issues.push(
      `sourceQid must be ${input.sourceQid}, but got ${profile.sourceQid}.`,
    );
  }

  for (const meaning of profile.meanings) {
    if (!pageQidLinks.has(meaning.qid)) {
      issues.push(
        `Meaning "${meaning.name}" selected qid ${meaning.qid}, but it is not present in the input disambiguation page links.`,
      );
      continue;
    }
    if (seen.has(meaning.qid)) {
      issues.push(
        `Duplicate meaning qid ${meaning.qid}. Return each QID once.`,
      );
      continue;
    }

    seen.add(meaning.qid);
    meanings.push(meaning);
  }

  if (meanings.length === 0) {
    issues.push("Return at least one meaning from the pageQidLinks list.");
  }
  if (issues.length > 0) {
    throw new ParsedJsonError(issues);
  }

  return {
    meanings,
    sourceQid: input.sourceQid,
    ...(profile.surface === undefined ? {} : { surface: profile.surface }),
  };
}

function buildNormalizerMessages(
  input: DisambiguationProfileNormalizerInput,
  maxMeanings: number,
): LLMessage[] {
  return [
    {
      role: "system",
      content: [
        "You normalize Wikipedia disambiguation pages for entity grounding.",
        "Return JSON only.",
        "Do not invent QIDs, pages, people, places, works, or meanings.",
        "Only use QIDs from the pageQidLinks list.",
        "The information field must only copy or summarize text present on the disambiguation page itself.",
        "Do not use Wikidata descriptions or external knowledge to fill information.",
        "Prefer common and context-independent meanings over exhaustive long-tail lists.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Source QID: ${input.sourceQid}`,
        input.surface === undefined ? "" : `Surface: ${input.surface}`,
        `Maximum meanings: ${maxMeanings}`,
        "",
        "Page QID links:",
        JSON.stringify(input.pageQidLinks.map(formatPageQidLink), null, 2),
        "",
        "Disambiguation page text:",
        input.pages
          .map(
            (page) =>
              `--- ${page.wiki}:${page.title} ---\n${truncatePageText(page.text)}`,
          )
          .join("\n\n"),
        "",
        "Return this JSON shape:",
        JSON.stringify(
          {
            meanings: [
              {
                category:
                  "person | place | organization | work | concept | event | other",
                information:
                  "short information copied or summarized from the disambiguation page; empty string if no information is present",
                name: "display name",
                priority: "primary | secondary | other",
                qid: "QID from pageQidLinks",
              },
            ],
            sourceQid: input.sourceQid,
            ...(input.surface === undefined ? {} : { surface: input.surface }),
          },
          null,
          2,
        ),
      ]
        .filter((line) => line !== "")
        .join("\n"),
    },
  ];
}

function formatPageQidLink(item: DisambiguationLinkedQid): object {
  return {
    qid: item.qid,
    title: item.title,
  };
}

function truncatePageText(text: string): string {
  const maxLength = 16000;

  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}\n\n[truncated]`;
}
