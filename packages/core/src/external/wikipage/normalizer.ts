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
    qid: z.union([z.string(), z.null()]),
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
): NormalizedDisambiguationProfile {
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
  profile: NormalizedDisambiguationProfile,
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
    if (meaning.qid === null || meaning.qid === "") {
      continue;
    }
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
    meanings.push({
      ...(meaning.category === undefined ? {} : { category: meaning.category }),
      information: meaning.information,
      name: meaning.name,
      priority: meaning.priority,
      qid: meaning.qid,
    });
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
        "Only include meanings whose target has a QID in pageQidLinks.",
        "Omit disambiguation bullets or page items that have no QID link.",
        "Never use null, empty strings, placeholder QIDs, or made-up QIDs.",
        "The information field must only copy or summarize text present on the disambiguation page itself.",
        "Do not use Wikidata descriptions or external knowledge to fill information.",
        "When a bullet contains multiple links, treat administrative divisions, parent locations, categories, and locator/explanatory links as context only.",
        "Do not include context-only links as meanings unless the link itself is the disambiguated target.",
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
        "Structured disambiguation pages:",
        JSON.stringify(input.pages.map(formatStructuredPage), null, 2),
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

interface NormalizedDisambiguationProfile {
  readonly meanings: readonly NormalizedDisambiguationProfileMeaning[];
  readonly sourceQid: string;
  readonly surface?: string;
}

interface NormalizedDisambiguationProfileMeaning extends Omit<
  DisambiguationProfileMeaning,
  "qid"
> {
  readonly qid: string | null;
}

function formatPageQidLink(item: DisambiguationLinkedQid): object {
  return {
    qid: item.qid,
    title: item.title,
  };
}

function formatStructuredPage(
  page: DisambiguationProfileNormalizerInput["pages"][number],
): object {
  return {
    ...(page.pageId === undefined ? {} : { pageid: page.pageId }),
    items: extractPageItems(page.text),
    title: page.title,
    wiki: page.wiki,
  };
}

function extractPageItems(text: string): readonly object[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("* "))
    .map((line) => ({
      links: extractWikgLinks(line),
      text: stripWikiLinks(line.slice(2).trim()),
    }));
}

const WIKG_QID_LINK_PATTERN = /\[\[([^\]|]+)\|wikg:\/\/qid=(Q[1-9]\d*)\]\]/gu;

function extractWikgLinks(text: string): readonly object[] {
  return [...text.matchAll(WIKG_QID_LINK_PATTERN)].map((match) => ({
    label: match[1]!,
    qid: match[2]!,
  }));
}

function stripWikiLinks(text: string): string {
  return text.replace(WIKG_QID_LINK_PATTERN, "$1");
}

function truncatePageText(text: string): string {
  const maxLength = 16000;

  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}\n\n[truncated]`;
}
