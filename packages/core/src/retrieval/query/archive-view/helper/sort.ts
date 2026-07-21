import type {
  ArchiveFindHit,
  ArchiveFindObjectType,
  ArchiveFindOrder,
} from "../types.js";
import {
  compareNumbers,
  getPositionChapter,
  getPositionDocumentOrder,
  getPositionFragment,
  getPositionSentence,
  getTypeOrder,
} from "./position.js";

export function compareSearchHits(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
  order: ArchiveFindOrder,
): number {
  const direction = order === "doc-asc" ? 1 : -1;
  const relevance =
    compareNumbers(getSearchBucket(left.type), getSearchBucket(right.type)) ||
    compareNumbers(right.score ?? 0, left.score ?? 0) ||
    compareNumbers(right.matchCount ?? 0, left.matchCount ?? 0);
  const position =
    compareNumbers(
      getPositionDocumentOrder(left),
      getPositionDocumentOrder(right),
    ) ||
    compareNumbers(getPositionChapter(left), getPositionChapter(right)) ||
    compareNumbers(getPositionFragment(left), getPositionFragment(right)) ||
    compareNumbers(getPositionSentence(left), getPositionSentence(right)) ||
    compareNumbers(getTypeOrder(left.type), getTypeOrder(right.type)) ||
    left.id.localeCompare(right.id);

  return relevance || position * direction;
}

export function compareListHits(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
  order: ArchiveFindOrder,
): number {
  const direction = order === "doc-asc" ? 1 : -1;
  const bucketComparison =
    compareNumbers(getListBucket(left.type), getListBucket(right.type)) ||
    compareListBucketItems(left, right);

  if (bucketComparison !== 0) {
    return bucketComparison;
  }

  return compareListPosition(left, right) * direction;
}

export function compareListBucketItems(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
): number {
  const leftBucket = getListBucket(left.type);

  if (leftBucket !== getListBucket(right.type)) {
    return 0;
  }
  if (leftBucket === 0) {
    return compareNumbers(right.score ?? 0, left.score ?? 0);
  }

  return 0;
}

export function compareListPosition(
  left: ArchiveFindHit,
  right: ArchiveFindHit,
): number {
  return (
    compareNumbers(
      getPositionDocumentOrder(left),
      getPositionDocumentOrder(right),
    ) ||
    compareNumbers(getPositionChapter(left), getPositionChapter(right)) ||
    compareNumbers(getPositionFragment(left), getPositionFragment(right)) ||
    compareNumbers(getPositionSentence(left), getPositionSentence(right)) ||
    compareNumbers(getTypeOrder(left.type), getTypeOrder(right.type)) ||
    left.id.localeCompare(right.id)
  );
}

export function getListBucket(type: ArchiveFindObjectType): number {
  switch (type) {
    case "entity":
    case "triple":
      return 0;
    case "node":
      return 1;
    case "summary":
      return 2;
    case "source":
    case "fragment":
      return 3;
    case "chapter-title":
    case "chapter":
    case "chapter-tree":
    case "meta":
      return 4;
  }
}

export function getSearchBucket(type: ArchiveFindObjectType): number {
  switch (type) {
    case "chapter-title":
      return 0;
    case "entity":
    case "triple":
      return 1;
    case "node":
      return 2;
    case "source":
    case "summary":
      return 3;
    case "chapter":
    case "chapter-tree":
    case "meta":
    case "fragment":
      throw new Error(`Unsupported search result bucket type: ${type}`);
  }
}
