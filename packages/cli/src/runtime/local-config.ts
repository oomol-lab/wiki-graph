import { resolveWikiGraphCoreDatabasePath } from "wiki-graph-core";
import { openSharedStateDatabase } from "wiki-graph-core";
import type { Database } from "wiki-graph-core";

export const LOCAL_CONFIG_SECTIONS = [
  "concurrent",
  "llm",
  "wikispine",
] as const;

export type LocalConfigSection = (typeof LOCAL_CONFIG_SECTIONS)[number];

export type LocalConfigObject = Readonly<Record<string, unknown>>;

const LOCAL_CONFIG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS config_sections (
  section TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export async function readLocalConfigSection(
  section: LocalConfigSection,
): Promise<LocalConfigObject> {
  return await withLocalConfigDatabase(async (database) => {
    return await readLocalConfigSectionInDatabase(database, section);
  });
}

export async function replaceLocalConfigSection(
  section: LocalConfigSection,
  value: LocalConfigObject,
): Promise<LocalConfigObject> {
  const normalized = validateLocalConfigSection(section, value);

  return await withLocalConfigDatabase(async (database) => {
    await writeLocalConfigSectionInDatabase(database, section, normalized);
    return normalized;
  });
}

export async function putLocalConfigValue(
  section: LocalConfigSection,
  key: string,
  value: unknown,
): Promise<LocalConfigObject> {
  return await withLocalConfigDatabase(async (database) => {
    const current = await readLocalConfigSectionInDatabase(database, section);
    const next = validateLocalConfigSection(section, {
      ...current,
      [normalizeLocalConfigKey(section, key)]: value,
    });

    await writeLocalConfigSectionInDatabase(database, section, next);
    return next;
  });
}

export async function deleteLocalConfigValue(
  section: LocalConfigSection,
  key: string,
): Promise<LocalConfigObject> {
  return await withLocalConfigDatabase(async (database) => {
    const current = await readLocalConfigSectionInDatabase(database, section);
    const normalizedKey = normalizeLocalConfigKey(section, key);
    const { [normalizedKey]: _removed, ...nextInput } = current;
    const next = validateLocalConfigSection(section, nextInput);

    await writeLocalConfigSectionInDatabase(database, section, next);
    return next;
  });
}

export async function clearLocalConfigSection(
  section: LocalConfigSection,
): Promise<LocalConfigObject> {
  return await replaceLocalConfigSection(section, {});
}

export function parseLocalConfigSection(
  value: string | undefined,
): LocalConfigSection | undefined {
  return LOCAL_CONFIG_SECTIONS.find((section) => section === value);
}

export function maskLocalConfigSection(
  section: LocalConfigSection,
  value: LocalConfigObject,
): LocalConfigObject {
  if (section !== "llm" || value.apiKey === undefined) {
    return value;
  }

  return {
    ...value,
    apiKey: "****",
  };
}

export function normalizeLocalConfigKey(
  section: LocalConfigSection,
  key: string,
): string {
  const normalized = key.trim();

  if (normalized === "") {
    throw new Error("Config key cannot be empty.");
  }

  if (section === "llm") {
    switch (normalized) {
      case "api-key":
        return "apiKey";
      case "base-url":
        return "baseURL";
      default:
        return normalized;
    }
  }
  return normalized;
}

export function validateLocalConfigSection(
  section: LocalConfigSection,
  value: LocalConfigObject,
): LocalConfigObject {
  switch (section) {
    case "llm":
      return validateLLMConfig(value);
    case "concurrent":
      return validateConcurrentConfig(value);
    case "wikispine":
      return validateWikispineConfig(value);
  }
}

async function withLocalConfigDatabase<T>(
  operation: (database: Database) => Promise<T>,
): Promise<T> {
  const database = await openSharedStateDatabase(
    resolveWikiGraphCoreDatabasePath(),
    LOCAL_CONFIG_SCHEMA_SQL,
  );

  try {
    return await operation(database);
  } finally {
    await database.close();
  }
}

async function readLocalConfigSectionInDatabase(
  database: Database,
  section: LocalConfigSection,
): Promise<LocalConfigObject> {
  const value = await database.queryOne(
    "SELECT value_json FROM config_sections WHERE section = ?",
    [section],
    (row) => String(row.value_json),
  );

  return value === undefined ? {} : parseSectionJSON(section, value);
}

async function writeLocalConfigSectionInDatabase(
  database: Database,
  section: LocalConfigSection,
  value: LocalConfigObject,
): Promise<void> {
  await database.run(
    `
INSERT INTO config_sections (section, value_json, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(section) DO UPDATE SET
  value_json = excluded.value_json,
  updated_at = excluded.updated_at
`,
    [section, JSON.stringify(value), Date.now()],
  );
}

function parseSectionJSON(
  section: LocalConfigSection,
  value: string,
): LocalConfigObject {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid local config JSON for ${section}: ${formatError(error)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid local config section ${section}: expected object.`,
    );
  }

  return validateLocalConfigSection(section, parsed as LocalConfigObject);
}

function validateLLMConfig(value: LocalConfigObject): LocalConfigObject {
  const allowedKeys = new Set([
    "apiKey",
    "baseURL",
    "model",
    "name",
    "provider",
  ]);
  const allowedProviders = new Set([
    "anthropic",
    "google",
    "openai",
    "openai-compatible",
  ]);
  const next: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown llm config key: ${key}`);
    }
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`llm.${key} must be a non-empty string.`);
    }
    const normalized = entry.trim();

    if (key === "provider" && !allowedProviders.has(normalized)) {
      throw new Error(`Unknown llm.provider: ${normalized}`);
    }

    next[key] = normalized;
  }

  return next;
}

function validateConcurrentConfig(value: LocalConfigObject): LocalConfigObject {
  const allowedKeys = new Set(["job", "request"]);
  const next: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown concurrent config key: ${key}`);
    }
    const parsed =
      typeof entry === "number"
        ? entry
        : typeof entry === "string"
          ? Number(entry)
          : NaN;

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`concurrent.${key} must be a positive integer.`);
    }
    next[key] = parsed;
  }

  return next;
}

function validateWikispineConfig(value: LocalConfigObject): LocalConfigObject {
  const allowedKeys = new Set(["provider"]);
  const allowedProviders = new Set(["cli", "fetch"]);
  const next: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown wikispine config key: ${key}`);
    }
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`wikispine.${key} must be a non-empty string.`);
    }
    const normalized = entry.trim();

    if (key === "provider" && !allowedProviders.has(normalized)) {
      throw new Error(`Unknown wikispine.provider: ${normalized}`);
    }

    next[key] = normalized;
  }

  return next;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
