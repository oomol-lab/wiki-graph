import type { MentionLinkRecord, SentenceId } from "../../../document/index.js";
import type { GraphNeighbor, GraphNode } from "../../../facade/graph.js";

import {
  compareListHits,
  compareSentenceIds,
  createSentencePosition,
} from "./helpers.js";
import type {
  ArchiveFindHit,
  ArchiveFindObjectType,
  ArchiveFindOrder,
  ArchiveFindPosition,
  ArchiveListItem,
} from "./types.js";

export function compareRelatedQueryItems(
  left: ArchiveListItem,
  right: ArchiveListItem,
): number {
  const scoreComparison = (right.score ?? 0) - (left.score ?? 0);

  if (scoreComparison !== 0) {
    return scoreComparison;
  }

  return compareListHits(
    createFindHitFromListItem(left),
    createFindHitFromListItem(right),
    "doc-asc",
  );
}

export function sortRelatedItemsByListMode(
  items: readonly ArchiveListItem[],
  order: ArchiveFindOrder = "doc-asc",
  documentOrders?: ReadonlyMap<number, number>,
): readonly ArchiveListItem[] {
  return [...items].sort((left, right) =>
    compareListHits(
      createFindHitFromListItem(left, documentOrders),
      createFindHitFromListItem(right, documentOrders),
      order,
    ),
  );
}

export function sortGraphNeighborsByListMode(
  neighbors: readonly GraphNeighbor[],
  documentOrders: ReadonlyMap<number, number>,
  order: ArchiveFindOrder,
): readonly GraphNeighbor[] {
  const direction = order === "doc-asc" ? 1 : -1;

  return [...neighbors].sort(
    (left, right) =>
      compareSentenceIds(
        getFirstGraphNodeSentenceId(left.node),
        getFirstGraphNodeSentenceId(right.node),
        documentOrders,
      ) * direction,
  );
}

function createFindHitFromListItem(
  item: ArchiveListItem,
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindHit {
  const position = createListItemPosition(item, documentOrders);
  const score =
    item.type === "triple" ? (item.evidenceLinks?.length ?? 0) : undefined;

  return {
    field: "title",
    id: item.id,
    ...(position === undefined ? {} : { position }),
    ...(score === undefined ? {} : { score }),
    snippet: item.summary,
    title: item.label,
    type: toFindObjectType(item.type),
  };
}

function toFindObjectType(
  type: ArchiveListItem["type"],
): ArchiveFindObjectType {
  switch (type) {
    case "edge":
    case "state":
      return "meta";
    default:
      return type;
  }
}

function createListItemPosition(
  item: ArchiveListItem,
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindPosition | undefined {
  if (item.type === "triple") {
    return createFirstMentionLinkPosition(
      item.evidenceLinks ?? [],
      documentOrders,
    );
  }

  return undefined;
}

function createFirstMentionLinkPosition(
  links: readonly MentionLinkRecord[],
  documentOrders?: ReadonlyMap<number, number>,
): ArchiveFindPosition | undefined {
  const sentenceIds = links.flatMap((link) => link.evidenceSentenceIds);
  const [first] = sentenceIds.sort((left, right) =>
    compareSentenceIds(left, right, documentOrders),
  );

  return first === undefined
    ? undefined
    : createSentencePosition(first, documentOrders);
}

function getFirstGraphNodeSentenceId(node: GraphNode): SentenceId {
  return (
    [...node.sentenceIds].sort(compareSentenceIds)[0] ?? [
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ]
  );
}
