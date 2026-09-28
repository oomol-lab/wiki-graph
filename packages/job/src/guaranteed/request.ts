import {
  buildResponseIntentClassificationMessages,
  classifyResponseIntentLocally,
  parseResponseIntentClassification,
  type GuaranteedResponseIntent,
} from "./classifier.js";
import {
  GuaranteedEmptyResponseError,
  GuaranteedParseValidationError,
  GuaranteedSchemaValidationError,
  ParsedJsonError,
  SuspectedModelRefusalError,
} from "./errors.js";
import {
  buildBusinessErrorMessage,
  buildMalformedJsonMessage,
  buildNaturalLanguageMessage,
  buildSchemaErrorMessage,
  buildSyntaxErrorMessage,
  extractJsonText,
  listSchemaIssues,
  repairJsonText,
} from "./response.js";
import type { GuaranteedRequestOptions } from "./types.js";
import type { JobLlmMessage } from "../ports.js";

const DEFAULT_MAX_RETRIES = 12;
const MAX_MALFORMED_JSON_REPAIR_HISTORY_ATTEMPTS = 3;

export async function requestGuaranteedJson<TData, TResult>(
  options: GuaranteedRequestOptions<TData, TResult>,
): Promise<TResult> {
  const initialMessages = [...options.messages];
  let currentMessages = [...options.messages];
  let consecutiveProtocolDerailments = 0;
  let consecutiveMalformedJsonFailures = 0;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let index = 0; index <= maxRetries; index += 1) {
    const response = await options.request(currentMessages, index, maxRetries);
    if (response === undefined || response.trim() === "") {
      if (index >= maxRetries) {
        throw new GuaranteedEmptyResponseError(index + 1, maxRetries);
      }
      continue;
    }
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(repairJsonText(extractJsonText(response)));
    } catch (error) {
      const intent = await classifyResponseIntent(options, response, index);
      if (intent === "natural_language") {
        consecutiveProtocolDerailments += 1;
        consecutiveMalformedJsonFailures = 0;
        if (consecutiveProtocolDerailments >= 2 || index >= maxRetries) {
          throw new SuspectedModelRefusalError(index + 1, maxRetries, {
            reason:
              index >= maxRetries
                ? "last retry still returned natural-language content"
                : "two consecutive retries returned natural-language content",
            response,
          });
        }
        currentMessages = buildRetryMessages(
          initialMessages,
          response,
          buildNaturalLanguageMessage(),
          false,
        );
        continue;
      }
      consecutiveProtocolDerailments = 0;
      consecutiveMalformedJsonFailures += 1;
      currentMessages = buildRetryMessages(
        initialMessages,
        response,
        intent === "malformed_json"
          ? buildMalformedJsonMessage(asSyntaxError(error))
          : buildSyntaxErrorMessage(asSyntaxError(error)),
        consecutiveMalformedJsonFailures <
          MAX_MALFORMED_JSON_REPAIR_HISTORY_ATTEMPTS,
      );
      continue;
    }
    consecutiveProtocolDerailments = 0;
    consecutiveMalformedJsonFailures = 0;

    const validation = await options.schema.safeParseAsync(parsedData);
    if (!validation.success) {
      if (
        shouldTreatSchemaFailureAsNaturalLanguage(
          validation.error,
          parsedData,
        ) &&
        (await classifyResponseIntent(options, response, index)) ===
          "natural_language"
      ) {
        consecutiveProtocolDerailments += 1;
        if (consecutiveProtocolDerailments >= 2 || index >= maxRetries) {
          throw new SuspectedModelRefusalError(index + 1, maxRetries, {
            reason:
              index >= maxRetries
                ? "last retry still returned natural-language content"
                : "two consecutive retries returned natural-language content",
            response,
          });
        }
        currentMessages = buildRetryMessages(
          initialMessages,
          response,
          buildNaturalLanguageMessage(),
          false,
        );
        continue;
      }
      const feedback = buildSchemaErrorMessage(validation.error);
      if (index >= maxRetries) {
        throw new GuaranteedSchemaValidationError(
          index + 1,
          maxRetries,
          { issues: listSchemaIssues(validation.error), response },
          validation.error,
        );
      }
      currentMessages = buildRetryMessages(
        initialMessages,
        response,
        feedback,
        true,
      );
      continue;
    }

    try {
      return await options.parse(validation.data, index, maxRetries);
    } catch (error) {
      if (!(error instanceof ParsedJsonError)) throw error;
      const feedback = buildBusinessErrorMessage(error.issues);
      if (index >= maxRetries) {
        throw new GuaranteedParseValidationError(
          index + 1,
          maxRetries,
          { issues: error.issues, response },
          error,
        );
      }
      currentMessages = buildRetryMessages(
        initialMessages,
        response,
        feedback,
        true,
      );
    }
  }
  throw new Error("requestGuaranteedJson failed unexpectedly");
}

function buildRetryMessages(
  initialMessages: readonly JobLlmMessage[],
  response: string,
  feedback: string,
  includeAssistantResponse: boolean,
): JobLlmMessage[] {
  return [
    ...initialMessages,
    ...(includeAssistantResponse
      ? [{ content: response, role: "assistant" as const }]
      : []),
    { content: feedback, role: "user" },
  ];
}

function asSyntaxError(error: unknown): SyntaxError {
  return error instanceof SyntaxError ? error : new SyntaxError(String(error));
}

async function classifyResponseIntent<TData, TResult>(
  options: GuaranteedRequestOptions<TData, TResult>,
  response: string,
  index: number,
): Promise<GuaranteedResponseIntent> {
  const localIntent = classifyResponseIntentLocally(response);
  if (localIntent !== "ambiguous") return localIntent;
  try {
    const classifierResponse = await options.request(
      buildResponseIntentClassificationMessages(
        options.responseIntentClassifierPrompt,
        response,
      ),
      index,
      options.maxRetries ?? DEFAULT_MAX_RETRIES,
    );
    if (classifierResponse === undefined || classifierResponse.trim() === "") {
      return "natural_language";
    }
    const classifierIntent =
      parseResponseIntentClassification(classifierResponse);
    return classifierIntent === "ambiguous"
      ? "natural_language"
      : classifierIntent;
  } catch {
    return "natural_language";
  }
}

function shouldTreatSchemaFailureAsNaturalLanguage(
  error: {
    readonly issues: readonly {
      readonly code?: string;
      readonly expected?: unknown;
      readonly path: readonly PropertyKey[];
    }[];
  },
  parsedData: unknown,
): boolean {
  if (!isPrimitiveJsonValue(parsedData)) return false;
  return error.issues.some(
    (issue) =>
      issue.path.length === 0 &&
      issue.code === "invalid_type" &&
      (issue.expected === "object" || issue.expected === "array"),
  );
}

function isPrimitiveJsonValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
