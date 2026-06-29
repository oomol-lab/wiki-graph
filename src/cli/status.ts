import type { CLIStatusArguments } from "./args.js";
import { loadCLIConfig } from "./config.js";
import { writeTextToStdout } from "./io.js";
import { formatCLIJSON } from "./json.js";

export async function runStatusCommand(
  args: CLIStatusArguments,
): Promise<void> {
  const masked = maskConfigSecrets(
    await loadCLIConfig({
      ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
    }),
  );

  await writeTextToStdout(formatCLIJSON(masked));
}

type JSONLike =
  | Record<string, unknown>
  | readonly unknown[]
  | string
  | number
  | boolean
  | null;

function maskConfigSecrets(value: unknown): JSONLike {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item): JSONLike => maskConfigSecrets(item));
  }

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const maskedRecord: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(record)) {
    maskedRecord[key] =
      key === "apiKey" ? maskAPIKey(entryValue) : maskConfigSecrets(entryValue);
  }

  return maskedRecord;
}

function maskAPIKey(value: unknown): string | number | boolean | null {
  if (typeof value !== "string") {
    return value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
      ? value
      : null;
  }

  if (value.length <= 8) {
    return `${value.slice(0, Math.min(3, value.length))}***`;
  }

  const visiblePrefixLength = Math.min(4, value.length);
  const visibleSuffixLength = value.length > 8 ? 4 : 0;
  const maskedLength = Math.max(
    0,
    value.length - visiblePrefixLength - visibleSuffixLength,
  );

  return `${value.slice(0, visiblePrefixLength)}${"*".repeat(maskedLength)}${visibleSuffixLength === 0 ? "" : value.slice(-visibleSuffixLength)}`;
}
