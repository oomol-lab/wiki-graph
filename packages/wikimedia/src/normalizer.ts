import { z } from "zod";

import type {
  DisambiguationNormalizer,
  DisambiguationProfile,
  WikimediaDisambiguationItem,
  WikimediaLlmMessage,
  WikimediaLlmRequest,
} from "./types.js";

const NORMALIZER_VERSION = "v1";

const responseSchema = z
  .object({
    meanings: z.array(
      z
        .object({
          information: z.string(),
          qid: z.string().regex(/^Q[1-9][0-9]*$/u),
        })
        .strict(),
    ),
  })
  .strict();

export class LlmDisambiguationNormalizer implements DisambiguationNormalizer {
  public readonly identity;
  readonly #maxRetries: number;
  readonly #request: WikimediaLlmRequest;

  public constructor(
    request: WikimediaLlmRequest,
    options: { readonly maxRetries?: number; readonly modelId?: string } = {},
  ) {
    this.#request = request;
    this.#maxRetries = options.maxRetries ?? 3;
    this.identity = {
      modelId: options.modelId ?? "unconfigured",
      normalizerVersion: NORMALIZER_VERSION,
    };
  }

  public async normalize(
    input: Parameters<DisambiguationNormalizer["normalize"]>[0],
    options?: { readonly signal?: AbortSignal },
  ): Promise<DisambiguationProfile> {
    const allowedQids = new Set(input.page.links.map((link) => link.qid));
    const messages = buildMessages(input);
    let feedback: WikimediaLlmMessage | undefined;

    for (let index = 0; index <= this.#maxRetries; index += 1) {
      options?.signal?.throwIfAborted();
      const response = await this.#request(
        feedback === undefined ? messages : [...messages, feedback],
        index,
        this.#maxRetries,
        options,
      );
      const parsed = parseResponse(response, allowedQids);
      if (parsed.ok) return { meanings: parsed.meanings };
      feedback = {
        content: `The previous response was invalid: ${parsed.error}. Return only valid JSON using QIDs from the supplied page links.`,
        role: "user",
      };
    }
    throw new Error("Could not normalize Wikimedia disambiguation page");
  }
}

function buildMessages(
  input: Parameters<DisambiguationNormalizer["normalize"]>[0],
): readonly WikimediaLlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You normalize a Wikipedia disambiguation page for entity grounding.",
        'Return JSON only in the shape {"meanings":[{"qid":"Q1","information":"..."}]}',
        "Use only QIDs present in the supplied page links.",
        "Every meaning must be the disambiguated target of its list item.",
        "Do not select administrative divisions, parent locations, categories, or explanatory links that only provide context.",
        "The information must only copy or briefly summarize information present in that list item.",
        "Do not add facts from Wikidata or external knowledge.",
        "Omit list items for which no target QID can be identified.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        page: {
          items: input.page.items,
          links: input.page.links,
          title: input.page.title,
        },
        sourceQid: input.sourceQid,
        wiki: input.wiki,
      }),
    },
  ];
}

function parseResponse(
  response: string | undefined,
  allowedQids: ReadonlySet<string>,
):
  | {
      readonly ok: true;
      readonly meanings: readonly WikimediaDisambiguationItem[];
    }
  | { readonly error: string; readonly ok: false } {
  if (response === undefined || response.trim() === "") {
    return { error: "empty response", ok: false };
  }
  let value: unknown;
  try {
    value = JSON.parse(extractJson(response));
  } catch {
    return { error: "malformed JSON", ok: false };
  }
  const result = responseSchema.safeParse(value);
  if (!result.success) return { error: result.error.message, ok: false };
  const seen = new Set<string>();
  const meanings: WikimediaDisambiguationItem[] = [];
  for (const meaning of result.data.meanings) {
    if (!allowedQids.has(meaning.qid)) {
      return { error: `${meaning.qid} is not linked from the page`, ok: false };
    }
    if (seen.has(meaning.qid)) continue;
    seen.add(meaning.qid);
    meanings.push(meaning);
  }
  return { meanings, ok: true };
}

function extractJson(value: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(value);
  return fenced?.[1]?.trim() ?? value.trim();
}
