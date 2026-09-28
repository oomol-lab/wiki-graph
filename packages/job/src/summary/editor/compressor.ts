import type { JobLlmMessage, ReadingLlm } from "../../reading/model.js";
import { TEXT_COMPRESSOR_PROMPT_TEMPLATE } from "./prompt-templates.js";

const MAX_RETRIES = 2;

export class CompressionRequester<S extends string> {
  readonly #compressionRatio: number;
  readonly #llm: ReadingLlm<S>;
  readonly #scope: S;
  readonly #userLanguage: string | undefined;

  public constructor(
    llm: ReadingLlm<S>,
    scope: S,
    compressionRatio: number,
    userLanguage?: string,
  ) {
    this.#compressionRatio = compressionRatio;
    this.#llm = llm;
    this.#scope = scope;
    this.#userLanguage = userLanguage;
  }

  public async request(input: {
    markedText: string;
    previousCompressedText?: string;
    revisionFeedback?: string;
    targetLength: number;
  }): Promise<string> {
    const acceptableMin = Math.floor(input.targetLength * 0.85);
    const acceptableMax = Math.floor(input.targetLength * 1.15);
    const systemPrompt = this.#llm.loadSystemPrompt(
      TEXT_COMPRESSOR_PROMPT_TEMPLATE,
      {
        acceptable_max: acceptableMax,
        acceptable_min: acceptableMin,
        compression_ratio: Math.floor(this.#compressionRatio * 100),
        original_length: input.markedText.length,
        target_length: input.targetLength,
        user_language: this.#userLanguage,
      },
    );
    const messages = buildCompressionMessages(
      {
        markedText: input.markedText,
        systemPrompt,
      },
      input.previousCompressedText,
      input.revisionFeedback,
    );

    return await this.#llm.withContext(async (context) => {
      let currentMessages = messages;

      for (let retryIndex = 0; retryIndex <= MAX_RETRIES; retryIndex += 1) {
        const response = await context.request(currentMessages, {
          retryIndex,
          retryMax: MAX_RETRIES,
          scope: this.#scope,
          ...(retryIndex === 0 ? {} : { useCache: false }),
        });

        try {
          return extractFinalCompressedText(response);
        } catch (error) {
          if (retryIndex >= MAX_RETRIES) {
            throw error;
          }

          currentMessages = [
            ...currentMessages,
            {
              content: response,
              role: "assistant",
            },
            {
              content: buildCompressionRetryFeedback(error),
              role: "user",
            },
          ];
        }
      }

      throw new Error("Compression request failed unexpectedly");
    });
  }
}

function buildCompressionMessages(
  input: {
    markedText: string;
    systemPrompt: string;
  },
  previousCompressedText?: string,
  revisionFeedback?: string,
): JobLlmMessage[] {
  const messages: JobLlmMessage[] = [
    {
      content: input.systemPrompt,
      role: "system",
    },
    {
      content: input.markedText,
      role: "user",
    },
  ];

  if (previousCompressedText !== undefined && revisionFeedback !== undefined) {
    messages.push(
      {
        content: `<final>${previousCompressedText}</final>`,
        role: "assistant",
      },
      {
        content: revisionFeedback,
        role: "user",
      },
    );
  }

  return messages;
}

export function extractFinalCompressedText(response: string): string {
  const trimmedResponse = response.trim();
  const match = /^<final>([\s\S]*)<\/final>$/.exec(trimmedResponse);

  if (match === null) {
    throw new Error(
      "Compression response must be exactly one <final>...</final> block.",
    );
  }

  const compressedText = match[1]?.trim();

  if (compressedText === undefined || compressedText === "") {
    throw new Error("Compression response contained an empty <final> block.");
  }

  if (/<\/?[A-Za-z][^>]*>/.test(compressedText)) {
    throw new Error("Compressed text must not contain XML or HTML tags.");
  }

  return compressedText;
}

function buildCompressionRetryFeedback(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);

  return [
    "Your previous response was invalid.",
    reason,
    "Return exactly one <final>...</final> block and nothing else.",
    "The content inside <final> must be plain text only, with no tags, headings, fences, or explanatory text.",
  ].join(" ");
}
