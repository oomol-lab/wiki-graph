import type { SentenceId } from "../../../../document/index.js";
import type {
  ArchiveFindHit,
  ArchiveFindObjectType,
  ArchiveFindPosition,
} from "../types.js";

export function getPositionChapter(hit: ArchiveFindHit): number {
  return hit.position?.chapter ?? Number.MAX_SAFE_INTEGER;
}

export function getPositionDocumentOrder(hit: ArchiveFindHit): number {
  return (
    hit.position?.documentOrder ??
    hit.position?.chapter ??
    Number.MAX_SAFE_INTEGER
  );
}

export function getPositionFragment(hit: ArchiveFindHit): number {
  return hit.position?.fragment ?? 0;
}

export function getPositionSentence(hit: ArchiveFindHit): number {
  return hit.position?.sentence ?? 0;
}

export function getTypeOrder(type: ArchiveFindObjectType): number {
  switch (type) {
    case "chapter-title":
    case "chapter":
      return 0;
    case "chapter-tree":
      return 1;
    case "entity":
      return 2;
    case "triple":
      return 3;
    case "summary":
      return 4;
    case "node":
      return 5;
    case "source":
      return 6;
    case "fragment":
      return 6;
    case "meta":
      return 7;
  }
}

export function createNodePosition(
  sentenceIds: readonly SentenceId[],
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindPosition | undefined {
  const [first] = [...sentenceIds].sort(compareSentenceIds);

  return first === undefined
    ? undefined
    : createSentencePosition(first, documentOrders);
}

export function createSentencePosition(
  sentenceId: SentenceId,
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindPosition {
  return {
    chapter: sentenceId[0],
    documentOrder: documentOrders?.get(sentenceId[0]) ?? sentenceId[0],
    fragment: sentenceId[1],
    sentence: sentenceId[1],
  };
}

export function compareSentenceIds(
  left: SentenceId,
  right: SentenceId,
  documentOrders?: ReadonlyMap<number, number>,
): number {
  return (
    compareNumbers(
      documentOrders?.get(left[0]) ?? left[0],
      documentOrders?.get(right[0]) ?? right[0],
    ) ||
    compareNumbers(left[0], right[0]) ||
    compareNumbers(left[1], right[1])
  );
}

export function compareArchivePositions(
  left: ArchiveFindPosition,
  right: ArchiveFindPosition,
): number {
  return (
    compareNumbers(
      left.documentOrder ?? left.chapter,
      right.documentOrder ?? right.chapter,
    ) ||
    compareNumbers(left.chapter, right.chapter) ||
    compareNumbers(left.fragment ?? 0, right.fragment ?? 0) ||
    compareNumbers(left.sentence ?? 0, right.sentence ?? 0)
  );
}

export function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
