import { existsSync } from "fs";
import { readFile } from "fs/promises";

import { readCLIConfigFile, resolveCLIConfigFilePath } from "./config.js";
import { writeTextToStdout } from "./io.js";

export async function runStatusCommand(): Promise<void> {
  const configFilePath = resolveCLIConfigFilePath();

  await readCLIConfigFile(configFilePath);

  if (!existsSync(configFilePath)) {
    await writeTextToStdout("{}\n");
    return;
  }

  const content = await readFile(configFilePath, "utf8");
  const parsedJson = JSON.parse(content) as Record<string, unknown>;
  const masked = maskConfigSecrets(parsedJson);

  await writeTextToStdout(`${JSON.stringify(masked, null, 2)}\n`);
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
  const maskedEntries = Object.entries(record).map(([key, entryValue]) => [
    key,
    key === "apiKey" ? maskAPIKey(entryValue) : maskConfigSecrets(entryValue),
  ]);

  const maskedRecord: Record<string, unknown> = Object.fromEntries(maskedEntries);

  return maskedRecord;
}

function maskAPIKey(value: unknown): string | number | boolean | null {
  if (typeof value !== "string") {
    return value === null || typeof value === "number" || typeof value === "boolean"
      ? value
      : null;
  }

  const visiblePrefixLength = Math.min(4, value.length);
  const visibleSuffixLength = value.length > 8 ? 4 : 0;
  const maskedLength = Math.max(
    0,
    value.length - visiblePrefixLength - visibleSuffixLength,
  );

  return `${value.slice(0, visiblePrefixLength)}${"*".repeat(maskedLength)}${visibleSuffixLength === 0 ? "" : value.slice(-visibleSuffixLength)}`;
}
