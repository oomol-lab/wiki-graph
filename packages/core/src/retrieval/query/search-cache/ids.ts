import { createHash } from "crypto";

import { SEARCH_RANKING_VERSION } from "./schema.js";
import type {
  EntitySearchSessionCacheInput,
  SearchSessionCacheInput,
} from "./types.js";

export function createEntitySearchSessionId(
  input: EntitySearchSessionCacheInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        archiveKey: input.archiveKey,
        entity: true,
        lens: input.lens,
        match: input.match,
        order: input.order,
        rankingVersion: SEARCH_RANKING_VERSION,
        revisionScope: input.revisionScope,
        scope: normalizeSearchSessionScope(input.chapters),
        terms: input.terms,
        types: normalizeSearchSessionTypes(input.types),
      }),
    )
    .digest("hex");
}

export function createSearchSessionId(input: SearchSessionCacheInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        archiveKey: input.archiveKey,
        entity: false,
        lens: input.lens,
        match: input.match,
        order: input.order,
        rankingVersion: SEARCH_RANKING_VERSION,
        revisionScope: input.revisionScope,
        scope: normalizeSearchSessionScope(input.chapters),
        terms: input.terms,
        types: normalizeSearchSessionTypes(input.types),
      }),
    )
    .digest("hex");
}

function normalizeSearchSessionScope(
  chapters: readonly number[] | null,
): readonly number[] | null {
  return chapters === null ? null : [...new Set(chapters)].sort(compareNumbers);
}

function normalizeSearchSessionTypes(
  types: readonly string[] | null,
): readonly string[] | null {
  return types === null ? null : [...new Set(types)].sort();
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
