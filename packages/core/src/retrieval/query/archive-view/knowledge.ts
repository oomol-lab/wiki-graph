import type {
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
} from "../../../document/index.js";
import { WIKI_GRAPH_URI_PREFIX } from "../../../runtime/common/wiki-graph/uri.js";

import { compareNumbers, normalizeWikiGraphObjectUri } from "./helpers.js";
import type { WikiGraphReference } from "./references.js";
import type { EntityEvidenceMention } from "./types.js";

export function compareMentions(
  left: MentionRecord,
  right: MentionRecord,
): number {
  return (
    compareNumbers(left.chapterId, right.chapterId) ||
    compareNumbers(left.sentenceIndex ?? 0, right.sentenceIndex ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

export async function getMentionForTripleSearch(
  document: ReadonlyDocument,
  cache: Map<string, MentionRecord>,
  mentionId: string,
): Promise<MentionRecord | undefined> {
  const cached = cache.get(mentionId);

  if (cached !== undefined) {
    return cached;
  }

  const mention = await document.mentions.getById(mentionId);

  if (mention !== undefined) {
    cache.set(mentionId, mention);
  }

  return mention;
}

export async function listAllMentions(
  document: ReadonlyDocument,
): Promise<readonly MentionRecord[]> {
  return await document.mentions.listAll();
}

export function createUnscoredEntityEvidenceMention(
  mention: MentionRecord,
): EntityEvidenceMention {
  return {
    match: {
      matchCount: 0,
      matchedTerms: [],
      missingTerms: [],
      score: 0,
    },
    mention,
  };
}

export function formatTripleUri(
  subjectQid: string,
  predicate: string,
  objectQid: string,
): string {
  return `wikg://triple/${subjectQid}/${encodeURIComponent(predicate)}/${objectQid}`;
}

export function formatEntityUri(qid: string): string {
  return `wikg://entity/${qid}`;
}

export function parseEntityQid(id: string): string | undefined {
  const normalized = normalizeWikiGraphObjectUri(id);
  const prefix = `${WIKI_GRAPH_URI_PREFIX}entity/`;

  return normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : undefined;
}

export function selectEntityLabel(mentions: readonly MentionRecord[]): string {
  return selectEntityLabels(mentions)[0] ?? mentions[0]?.qid ?? "[entity]";
}

export function selectEntityLabels(
  mentions: readonly MentionRecord[],
): readonly string[] {
  const counts = new Map<string, number>();

  for (const mention of mentions) {
    counts.set(mention.surface, (counts.get(mention.surface) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => {
      const countComparison = right[1] - left[1];

      return countComparison === 0
        ? left[0].localeCompare(right[0])
        : countComparison;
    })
    .map(([label]) => label);
}

export async function createTriplePageLabel(
  document: ReadonlyDocument,
  reference: Extract<WikiGraphReference, { readonly type: "triple" }>,
): Promise<string> {
  const [subjectMentions, objectMentions] = await Promise.all([
    document.mentions.listByQid(reference.subjectQid),
    document.mentions.listByQid(reference.objectQid),
  ]);
  const scopedSubjectMentions = filterMentionsByChapter(
    subjectMentions,
    reference.chapterId,
  );
  const scopedObjectMentions = filterMentionsByChapter(
    objectMentions,
    reference.chapterId,
  );
  const subjectLabel =
    scopedSubjectMentions.length === 0
      ? reference.subjectQid
      : selectEntityLabel(scopedSubjectMentions);
  const objectLabel =
    scopedObjectMentions.length === 0
      ? reference.objectQid
      : selectEntityLabel(scopedObjectMentions);

  return `${subjectLabel}(${reference.subjectQid}) ${reference.predicate} ${objectLabel}(${reference.objectQid})`;
}

export function filterMentionsByChapter(
  mentions: readonly MentionRecord[],
  chapterId: number | undefined,
): readonly MentionRecord[] {
  return chapterId === undefined
    ? mentions
    : mentions.filter((mention) => mention.chapterId === chapterId);
}

export function filterMentionsByChapterSet(
  mentions: readonly MentionRecord[],
  chapterFilter: ReadonlySet<number> | undefined,
): readonly MentionRecord[] {
  return chapterFilter === undefined
    ? mentions
    : mentions.filter((mention) => chapterFilter.has(mention.chapterId));
}

export async function filterMentionLinksByChapter(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  chapterId: number | undefined,
): Promise<readonly MentionLinkRecord[]> {
  if (chapterId === undefined) {
    return links;
  }

  const filtered: MentionLinkRecord[] = [];

  for (const link of links) {
    const source = await document.mentions.getById(link.sourceMentionId);

    if (source?.chapterId === chapterId) {
      filtered.push(link);
    }
  }

  return filtered;
}
