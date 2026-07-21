import type { ReadonlyDocument } from "../../../../document/index.js";

import { createNodePosition, createSnippet } from "../helpers.js";
import { parseSearchPropertyIntegerOwnerId } from "./hydration.js";
import type { ArchiveFindHit } from "../types.js";
import {
  compareMentions,
  parseEntityQid,
  selectEntityLabel,
} from "../knowledge.js";

export async function hydrateCachedObjectBucketHit(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
): Promise<ArchiveFindHit> {
  if (hit.type === "entity") {
    const qid = parseEntityQid(hit.id);

    if (qid === undefined) {
      return hit;
    }
    const mentions = await document.mentions.listByQid(qid);
    const [first] = [...mentions].sort(compareMentions);

    if (first === undefined) {
      return hit;
    }

    return {
      ...hit,
      chapter: first.chapterId,
      position: {
        chapter: first.chapterId,
        sentence: first.sentenceIndex ?? 0,
      },
      snippet: first.note ?? first.surface,
      title: selectEntityLabel(mentions),
    };
  }
  if (hit.type === "triple") {
    return hit;
  }

  return hit;
}

export async function hydrateCachedChunkBucketHit(
  document: ReadonlyDocument,
  hit: ArchiveFindHit,
): Promise<ArchiveFindHit | undefined> {
  const chunkId = parseSearchPropertyIntegerOwnerId(
    hit.id.slice("wikg://chunk/".length),
  );
  const node = await document.chunks.getById(chunkId);

  if (node === undefined) {
    return undefined;
  }
  const { position: _position, ...baseHit } = hit;
  const position = createNodePosition(node.sentenceIds);

  return {
    ...baseHit,
    chapter: node.sentenceId[0],
    field: "title",
    ...(position === undefined ? {} : { position }),
    snippet: createSnippet(node.content),
    title: node.label,
  };
}
