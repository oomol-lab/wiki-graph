import type {
  MentionRecord,
  ReadonlyDocument,
} from "../../../../document/index.js";

import { SEARCH_EVIDENCE_KIND } from "../../search-cache/index.js";
import type {
  SearchChunkHitInput,
  SearchEntityHitInput,
  SearchEvidenceHitEventInput,
  SearchTripleHitInput,
} from "../../search-cache/types.js";
import {
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  TEXT_SENTENCE_KIND,
  type SearchIndexQueryResult,
} from "../../../search-index/search/index.js";
import { isTextOnlySearch } from "./hydration.js";
import type { ArchiveFindHit, ArchiveFindOptions } from "../types.js";
import {
  formatTripleUri,
  getMentionForTripleSearch,
  parseEntityQid,
} from "../knowledge.js";

export function isEntityOnlySearch(options: ArchiveFindOptions): boolean {
  return isEntitySearchTypes(options.types ?? null);
}

export function isEntitySearchTypes(types: readonly string[] | null): boolean {
  return types !== null && types.length === 1 && types[0] === "entity";
}

export function assertSearchCursorTypesMatch(
  requestedTypes: readonly string[] | undefined,
  sessionTypes: readonly string[] | null,
): void {
  if (requestedTypes === undefined) {
    return;
  }
  if (requestedTypes.length !== (sessionTypes?.length ?? 0)) {
    throw new Error("Search cursor does not match the requested result types.");
  }
  const sessionTypeSet = new Set(sessionTypes ?? []);

  if (requestedTypes.some((type) => !sessionTypeSet.has(type))) {
    throw new Error("Search cursor does not match the requested result types.");
  }
}

export function createEntitySearchCacheInput(
  hits: readonly ArchiveFindHit[],
  indexResult?: SearchIndexQueryResult,
): {
  readonly entityHits: readonly SearchEntityHitInput[];
  readonly evidenceEvents: readonly SearchEvidenceHitEventInput[];
} {
  const evidenceEvents: SearchEvidenceHitEventInput[] = [];
  const evidenceScoresByQid = new Map<string, number[]>();
  const propertyScoresByQid = new Map<string, number[]>();

  for (const hit of indexResult?.objectHits ?? []) {
    if (hit.ownerKind !== SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity) {
      continue;
    }

    const scores = propertyScoresByQid.get(hit.ownerId) ?? [];

    scores.push(hit.score);
    propertyScoresByQid.set(hit.ownerId, scores);
  }

  for (const hit of hits) {
    if (hit.type !== "entity" || hit.evidenceMentions === undefined) {
      continue;
    }

    const qid = parseEntityQid(hit.id);

    if (qid === undefined) {
      continue;
    }

    const scores = evidenceScoresByQid.get(qid) ?? [];

    for (const evidenceMention of hit.evidenceMentions) {
      const sentenceIndex = evidenceMention.mention.sentenceIndex;

      if (sentenceIndex === undefined) {
        continue;
      }

      const score = evidenceMention.match.score ?? hit.score ?? 0;

      evidenceEvents.push({
        chapterId: evidenceMention.mention.chapterId,
        evidenceId: evidenceMention.mention.id,
        evidenceKind: SEARCH_EVIDENCE_KIND.mention,
        score,
        sentenceIndex,
      });
      scores.push(score);
    }

    evidenceScoresByQid.set(qid, scores);
  }

  const qids = new Set([
    ...evidenceScoresByQid.keys(),
    ...propertyScoresByQid.keys(),
  ]);

  return {
    entityHits: [...qids].map((qid) => ({
      evidenceTopScores: evidenceScoresByQid.get(qid) ?? [],
      propertyTopScores: propertyScoresByQid.get(qid) ?? [],
      qid,
    })),
    evidenceEvents,
  };
}

export async function createSentenceEvidenceSearchCacheInput(
  document: ReadonlyDocument,
  indexResult: SearchIndexQueryResult | undefined,
  options: ArchiveFindOptions,
): Promise<{
  readonly chunkHits: readonly SearchChunkHitInput[];
  readonly entityHits: readonly SearchEntityHitInput[];
  readonly evidenceEvents: readonly SearchEvidenceHitEventInput[];
  readonly tripleHits: readonly SearchTripleHitInput[];
}> {
  if (indexResult === undefined || isTextOnlySearch(options)) {
    return {
      chunkHits: [],
      entityHits: [],
      evidenceEvents: [],
      tripleHits: [],
    };
  }

  const sourceHits = indexResult.textHits.filter(
    (hit) => hit.kind === TEXT_SENTENCE_KIND.source,
  );

  if (sourceHits.length === 0) {
    return {
      chunkHits: [],
      entityHits: [],
      evidenceEvents: [],
      tripleHits: [],
    };
  }

  const sourceHitScores = new Map<string, number>();
  const chapterIds = new Set<number>();

  for (const hit of sourceHits) {
    sourceHitScores.set(
      createSentenceHitKey(hit.chapterId, hit.sentenceIndex),
      hit.score,
    );
    chapterIds.add(hit.chapterId);
  }

  const evidenceEvents: SearchEvidenceHitEventInput[] = [];
  const entityEvidenceScoresByQid = new Map<string, number[]>();
  const chunkEvidenceScoresById = new Map<number, number[]>();
  const tripleEvidenceScoresByKey = new Map<
    string,
    {
      readonly objectQid: string;
      readonly predicate: string;
      readonly scores: number[];
      readonly subjectQid: string;
    }
  >();

  for (const chapterId of chapterIds) {
    for (const mention of await document.mentions.listByChapter(chapterId)) {
      if (mention.sentenceIndex === undefined) {
        continue;
      }

      const score = sourceHitScores.get(
        createSentenceHitKey(chapterId, mention.sentenceIndex),
      );

      if (score === undefined) {
        continue;
      }

      evidenceEvents.push({
        chapterId,
        evidenceId: mention.id,
        evidenceKind: SEARCH_EVIDENCE_KIND.mention,
        score,
        sentenceIndex: mention.sentenceIndex,
      });
      const scores = entityEvidenceScoresByQid.get(mention.qid) ?? [];

      scores.push(score);
      entityEvidenceScoresByQid.set(mention.qid, scores);
    }

    for (const chunk of await document.chunks.listBySerial(chapterId)) {
      for (const [, sentenceIndex] of chunk.sentenceIds) {
        const score = sourceHitScores.get(
          createSentenceHitKey(chapterId, sentenceIndex),
        );

        if (score === undefined) {
          continue;
        }

        evidenceEvents.push({
          chapterId,
          evidenceId: String(chunk.id),
          evidenceKind: SEARCH_EVIDENCE_KIND.chunk,
          score,
          sentenceIndex,
        });
        const scores = chunkEvidenceScoresById.get(chunk.id) ?? [];

        scores.push(score);
        chunkEvidenceScoresById.set(chunk.id, scores);
      }
    }

    const mentionCache = new Map<string, MentionRecord>();

    for (const link of await document.mentionLinks.listByChapter(chapterId)) {
      const [source, target] = await Promise.all([
        getMentionForTripleSearch(document, mentionCache, link.sourceMentionId),
        getMentionForTripleSearch(document, mentionCache, link.targetMentionId),
      ]);

      if (source === undefined || target === undefined) {
        continue;
      }

      for (const [
        evidenceChapterId,
        sentenceIndex,
      ] of link.evidenceSentenceIds) {
        const score = sourceHitScores.get(
          createSentenceHitKey(evidenceChapterId, sentenceIndex),
        );

        if (score === undefined) {
          continue;
        }

        evidenceEvents.push({
          chapterId: evidenceChapterId,
          evidenceId: link.id,
          evidenceKind: SEARCH_EVIDENCE_KIND.mentionLink,
          score,
          sentenceIndex,
        });

        const key = formatTripleUri(source.qid, link.predicate, target.qid);
        const current = tripleEvidenceScoresByKey.get(key) ?? {
          objectQid: target.qid,
          predicate: link.predicate,
          scores: [],
          subjectQid: source.qid,
        };

        current.scores.push(score);
        tripleEvidenceScoresByKey.set(key, current);
      }
    }
  }

  return {
    chunkHits: [...chunkEvidenceScoresById.entries()].map(
      ([chunkId, scores]) => ({
        chunkId,
        evidenceTopScores: scores,
      }),
    ),
    entityHits: [...entityEvidenceScoresByQid.entries()].map(
      ([qid, scores]) => ({
        evidenceTopScores: scores,
        qid,
      }),
    ),
    evidenceEvents,
    tripleHits: [...tripleEvidenceScoresByKey.values()].map((hit) => ({
      evidenceTopScores: hit.scores,
      objectQid: hit.objectQid,
      predicate: hit.predicate,
      subjectQid: hit.subjectQid,
    })),
  };
}

export function createSentenceHitKey(
  chapterId: number,
  sentenceIndex: number,
): string {
  return `${chapterId}:${sentenceIndex}`;
}
