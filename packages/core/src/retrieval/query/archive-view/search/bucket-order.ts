import { compareNumbers } from "../helpers.js";
import { parseSearchPropertyIntegerOwnerId } from "./hydration.js";
import type {
  SearchChapterTitleCursorKey,
  SearchTextCursorKey,
} from "../../search-cache/types.js";
import type {
  SearchIndexObjectHit,
  SearchIndexTextHit,
} from "../../../search-index/search/index.js";
import type { ArchiveFindHit } from "../types.js";

export function compareChapterTitleIndexHits(
  left: SearchIndexObjectHit,
  right: SearchIndexObjectHit,
): number {
  return (
    compareNumbers(right.score, left.score) ||
    compareNumbers(
      parseSearchPropertyIntegerOwnerId(left.ownerId),
      parseSearchPropertyIntegerOwnerId(right.ownerId),
    )
  );
}

export function compareTextIndexHits(
  left: SearchIndexTextHit,
  right: SearchIndexTextHit,
): number {
  return (
    compareNumbers(left.rank, right.rank) ||
    compareNumbers(left.chapterId, right.chapterId) ||
    compareNumbers(left.sentenceIndex, right.sentenceIndex) ||
    compareNumbers(left.kind, right.kind)
  );
}

export function isAfterChapterTitleKey(
  hit: SearchIndexObjectHit,
  key: SearchChapterTitleCursorKey | undefined,
): boolean {
  if (key === undefined) {
    return true;
  }

  return (
    compareChapterTitleIndexHits(
      {
        ...hit,
        ownerId: String(key.chapterId),
        score: key.score,
      },
      hit,
    ) < 0
  );
}

export function isAfterTextKey(
  hit: SearchIndexTextHit,
  key: SearchTextCursorKey | undefined,
): boolean {
  if (key === undefined) {
    return true;
  }

  return (
    compareTextIndexHits(
      {
        archiveId: 0,
        chapterId: key.chapterId,
        kind: key.kind as SearchIndexTextHit["kind"],
        rank: key.rank,
        score: 0,
        sentenceIndex: key.sentenceIndex,
        wordsCount: 0,
      },
      hit,
    ) < 0
  );
}

export function getObjectBucketCursorId(hit: ArchiveFindHit): string {
  if (hit.type !== "triple") {
    return hit.id.replace(/^wikg:\/\/entity\//u, "");
  }

  const triple = parseTripleCursorId(hit.id);

  return triple ?? hit.id;
}

function parseTripleCursorId(id: string): string | undefined {
  const match = /^wikg:\/\/triple\/([^/]+)\/([^/]+)\/([^/]+)$/u.exec(id);

  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return undefined;
  }

  return `${match[1]}\u001f${decodeURIComponent(match[2])}\u001f${match[3]}`;
}
