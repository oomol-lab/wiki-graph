import type { LanguageModel, ModelMessage, SystemModelMessage } from "ai";

export function normalizeGenerationInput(input: {
  maxRetries: number;
  messages: ModelMessage[];
  model: LanguageModel;
  timeout: number;
}): {
  maxRetries: number;
  messages: ModelMessage[];
  model: LanguageModel;
  system?: string | SystemModelMessage | SystemModelMessage[];
  timeout: number;
} {
  const systemMessages: SystemModelMessage[] = [];
  let firstNonSystemIndex = 0;

  while (firstNonSystemIndex < input.messages.length) {
    const message = input.messages[firstNonSystemIndex];

    if (message === undefined || message.role !== "system") {
      break;
    }

    systemMessages.push(message);
    firstNonSystemIndex += 1;
  }

  if (systemMessages.length === 0) {
    return input;
  }

  if (systemMessages.length === 1) {
    const [systemMessage] = systemMessages;

    if (systemMessage === undefined) {
      return input;
    }

    return {
      ...input,
      messages: input.messages.slice(firstNonSystemIndex),
      system: systemMessage,
    };
  }

  return {
    ...input,
    messages: input.messages.slice(firstNonSystemIndex),
    system: systemMessages,
  };
}
