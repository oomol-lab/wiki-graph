import type { LanguageModelUsage } from "ai";

import { formatError } from "../../../utils/node-error.js";
import type { LLMessage, TemperatureSetting } from "../types.js";

export function hasVisibleNonSystemContent(
  messages: readonly LLMessage[],
): boolean {
  return messages.some(
    (message) =>
      message.role !== "system" &&
      (typeof message.content !== "string" || message.content.trim() !== ""),
  );
}

export function formatRequestParameters(input: {
  cacheKey?: string | undefined;
  modelId: string;
  modelIdentity: string;
  modelProvider?: string | undefined;
  resolvedTemperature: number | undefined;
  resolvedTopP: number | undefined;
  retryIndex?: number | undefined;
  retryMax?: number | undefined;
  scope?: string | undefined;
  sessionId?: number | undefined;
  temperature: TemperatureSetting;
  topP: TemperatureSetting;
}): string {
  const lines = [
    "[[Parameters]]:",
    `\tmodel=${input.modelIdentity}`,
    `\ttemperature=${String(input.resolvedTemperature)}`,
    `\ttop_p=${String(input.resolvedTopP)}`,
  ];

  if (input.modelProvider !== undefined) {
    lines.push(`\tprovider=${input.modelProvider}`);
  }

  lines.push(`\tmodel_id=${input.modelId}`);

  if (input.scope !== undefined) {
    lines.push(`\tscope=${input.scope}`);
  }

  if (Array.isArray(input.temperature)) {
    lines.push(`\ttemperature_schedule=${JSON.stringify(input.temperature)}`);
  }

  if (Array.isArray(input.topP)) {
    lines.push(`\ttop_p_schedule=${JSON.stringify(input.topP)}`);
  }

  if (input.retryIndex !== undefined && input.retryMax !== undefined) {
    lines.push(`\tretry_progress=${input.retryIndex}/${input.retryMax}`);
  }

  if (input.cacheKey !== undefined) {
    lines.push(`\tcache_key=${input.cacheKey}`);
  }

  if (input.sessionId !== undefined) {
    lines.push(`\tsession_id=${input.sessionId}`);
  }

  return `${lines.join("\n")}\n\n`;
}

export function formatRequestMessages(messages: readonly LLMessage[]): string {
  const body = messages
    .map(
      (message) =>
        `${capitalize(message.role)}:\n${formatMessageContent(message.content)}`,
    )
    .join("\n\n");

  return `[[Request]]:\n${body}\n\n`;
}

export function formatRequestResultLog(
  usage: LanguageModelUsage | "cache-hit" | undefined,
  error?: unknown,
): string {
  return [
    formatRequestUsageLog(usage),
    ...(error === undefined ? [] : [formatRequestErrorStackLog(error)]),
  ].join("");
}

function formatRequestUsageLog(
  usage: LanguageModelUsage | "cache-hit" | undefined,
): string {
  if (usage === "cache-hit") {
    return "[[Usage]]:\ncache-hit\n\n";
  }

  return [
    "[[Usage]]:",
    `input: ${formatTokenCount(usage?.inputTokens)}`,
    `cache: ${formatTokenCount(usage?.inputTokenDetails.cacheReadTokens)}`,
    `output: ${formatTokenCount(usage?.outputTokens)}`,
    "",
    "",
  ].join("\n");
}

function formatTokenCount(value: number | undefined): string {
  return value === undefined ? "unavailable" : String(value);
}

function formatRequestErrorStackLog(error: unknown): string {
  return `[[Error Stack]]:\n${formatErrorStack(error)}\n\n`;
}

function formatErrorStack(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? formatError(error);
  }

  return formatError(error);
}

function formatMessageContent(content: LLMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  const serializedContent = JSON.stringify(content, null, 2);

  if (typeof serializedContent === "string") {
    return serializedContent;
  }

  return "";
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
