import { randomBytes } from "crypto";

import { z } from "zod";

import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";

export const WIKG_FORMAT_VERSION = 1;
export const WIKG_SCHEMA_VERSION = 2;
export const WIKG_MANIFEST_CONTENT = `${JSON.stringify({
  formatVersion: WIKG_FORMAT_VERSION,
  schemaVersion: WIKG_SCHEMA_VERSION,
})}\n`;

const WIKG_MUTATION_TOKEN_MAGIC = "wikg-mutation-token:v1";
const WIKG_MUTATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const wikgManifestSchema = z.object({
  formatVersion: z.literal(WIKG_FORMAT_VERSION),
  schemaVersion: z.number().int().positive().optional(),
});

export function parseWikgManifest(content: string): {
  readonly formatVersion: number;
  readonly schemaVersion: number;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }

  const result = wikgManifestSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Unsupported WIKG format version in ${WIKG_MANIFEST_PATH}.`,
    );
  }

  return {
    formatVersion: result.data.formatVersion,
    schemaVersion: result.data.schemaVersion ?? 1,
  };
}

export function createWikgMutationTokenContent(): Buffer {
  const token = randomBytes(32).toString("base64url");

  return Buffer.from(`${WIKG_MUTATION_TOKEN_MAGIC}\n${token}\n`, "utf8");
}

export function parseWikgMutationToken(content: string): string {
  const lines = content.split(/\r?\n/u);
  const magic = lines[0];
  const token = lines[1];

  if (
    magic !== WIKG_MUTATION_TOKEN_MAGIC ||
    token === undefined ||
    !WIKG_MUTATION_TOKEN_PATTERN.test(token)
  ) {
    throw new Error(
      `Invalid WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
    );
  }

  return token;
}
