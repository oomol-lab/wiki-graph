import type {
  MentionRecord,
  ReadonlyDocument,
} from "../../../../document/index.js";

import { aggregateEvidenceScores } from "../helpers.js";
import { parseArchiveReference } from "../references.js";
import { queryRequiredSearchIndex } from "../search/hydration.js";
import { createSentenceHitKey } from "../search/cache-input.js";
import {
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  TEXT_SENTENCE_KIND,
} from "../../../search-index/search/index.js";
import type { ArchiveListItem } from "../types.js";
import { compareRelatedQueryItems } from "./sort.js";

export async function filterAndSortChunkRelatedItemsByQuery(
  document: ReadonlyDocument,
  items: readonly ArchiveListItem[],
  query: string | undefined,
): Promise<readonly ArchiveListItem[]> {
  if (query === undefined) {
    return items;
  }

  const indexResult = await queryRequiredSearchIndex(document, query, {
    types: ["node"],
  });

  if (indexResult === undefined) {
    return [];
  }

  const scoresByChunkId = new Map<number, number[]>();
  const allowedChunkIds = new Set(
    items.flatMap((item) => {
      if (item.type !== "node") {
        return [];
      }
      const reference = parseArchiveReference(item.id);

      return reference.type === "node" ? [reference.id] : [];
    }),
  );

  for (const hit of indexResult.objectHits) {
    if (
      hit.ownerKind !== SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk ||
      !allowedChunkIds.has(Number(hit.ownerId))
    ) {
      continue;
    }

    const chunkId = Number(hit.ownerId);
    const scores = scoresByChunkId.get(chunkId) ?? [];

    scores.push(hit.score);
    scoresByChunkId.set(chunkId, scores);
  }

  return items
    .flatMap((item) => {
      if (item.type !== "node") {
        return [];
      }
      const reference = parseArchiveReference(item.id);

      if (reference.type !== "node") {
        return [];
      }
      const scores = scoresByChunkId.get(reference.id);

      return scores === undefined
        ? []
        : [{ ...item, score: aggregateEvidenceScores(scores) }];
    })
    .sort(compareRelatedQueryItems);
}

export async function filterAndSortEntityRelatedTriplesByQuery(
  document: ReadonlyDocument,
  items: readonly ArchiveListItem[],
  anchorQid: string,
  query: string | undefined,
): Promise<readonly ArchiveListItem[]> {
  if (query === undefined) {
    return items;
  }
  const scope = await createEntityRelatedQueryScope(document, items, anchorQid);

  const indexResult = await queryRequiredSearchIndex(document, query, {
    chapters: [...scope.chapterIds],
    types: ["entity", "source"],
  });

  if (indexResult === undefined) {
    return [];
  }

  const sentenceScores = new Map(
    indexResult.textHits
      .filter((hit) => hit.kind === TEXT_SENTENCE_KIND.source)
      .map(
        (hit) =>
          [
            createSentenceHitKey(hit.chapterId, hit.sentenceIndex),
            hit.score,
          ] as const,
      ),
  );
  const endpointScoresByKey = new Map<string, number[]>();

  for (const hit of indexResult.objectHits) {
    if (
      hit.ownerKind !== SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity ||
      hit.ownerId === anchorQid ||
      hit.chapterId === undefined
    ) {
      continue;
    }

    const key = createEntityRelatedEndpointKey(hit.ownerId, hit.chapterId);
    const scores = endpointScoresByKey.get(key) ?? [];

    scores.push(hit.score);
    endpointScoresByKey.set(key, scores);
  }

  return items
    .flatMap((item) => {
      if (item.type !== "triple") {
        return [];
      }

      const scores = [
        ...[...(scope.endpointKeysByTripleId.get(item.id) ?? [])].flatMap(
          (key) => endpointScoresByKey.get(key) ?? [],
        ),
        ...(item.evidenceLinks ?? []).flatMap((link) =>
          link.evidenceSentenceIds.flatMap(([chapterId, sentenceIndex]) => {
            const score = sentenceScores.get(
              createSentenceHitKey(chapterId, sentenceIndex),
            );

            return score === undefined ? [] : [score];
          }),
        ),
      ];

      return scores.length === 0
        ? []
        : [{ ...item, score: aggregateEvidenceScores(scores) }];
    })
    .sort(compareRelatedQueryItems);
}

async function createEntityRelatedQueryScope(
  document: ReadonlyDocument,
  items: readonly ArchiveListItem[],
  anchorQid: string,
): Promise<{
  readonly chapterIds: ReadonlySet<number>;
  readonly endpointKeysByTripleId: ReadonlyMap<string, ReadonlySet<string>>;
}> {
  const chapterIds = new Set<number>();
  const endpointKeysByTripleId = new Map<string, Set<string>>();
  const mentionCache = new Map<string, MentionRecord | undefined>();

  for (const item of items) {
    if (item.type !== "triple") {
      continue;
    }

    const endpointKeys = new Set<string>();

    for (const link of item.evidenceLinks ?? []) {
      for (const [chapterId] of link.evidenceSentenceIds) {
        chapterIds.add(chapterId);
      }

      const [source, target] = await Promise.all([
        getCachedMention(document, mentionCache, link.sourceMentionId),
        getCachedMention(document, mentionCache, link.targetMentionId),
      ]);

      for (const mention of [source, target]) {
        if (mention === undefined || mention.qid === anchorQid) {
          continue;
        }

        chapterIds.add(mention.chapterId);
        endpointKeys.add(
          createEntityRelatedEndpointKey(mention.qid, mention.chapterId),
        );
      }
    }

    endpointKeysByTripleId.set(item.id, endpointKeys);
  }

  return { chapterIds, endpointKeysByTripleId };
}

async function getCachedMention(
  document: ReadonlyDocument,
  cache: Map<string, MentionRecord | undefined>,
  mentionId: string,
): Promise<MentionRecord | undefined> {
  if (!cache.has(mentionId)) {
    cache.set(mentionId, await document.mentions.getById(mentionId));
  }

  return cache.get(mentionId);
}

function createEntityRelatedEndpointKey(
  qid: string,
  chapterId: number,
): string {
  return `${qid}:${chapterId}`;
}
