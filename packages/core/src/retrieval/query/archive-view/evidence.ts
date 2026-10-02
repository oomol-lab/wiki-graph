import type {
  MentionLinkRecord,
  ReadonlyDocument,
} from "../../../document/index.js";

import { parseWikiGraphReference } from "./references.js";
import type { ArchiveEvidence, ArchiveEvidenceOptions } from "./types.js";
import { requireNode } from "./core.js";
import { DEFAULT_FIND_LIMIT, decodeFindCursor } from "./helpers.js";
import {
  filterMentionLinksByChapter,
  filterMentionsByChapter,
  filterMentionsByChapterSet,
} from "./knowledge.js";
import {
  createMentionEvidenceRanges,
  createMentionEvidencePage,
  createMentionLinkEvidenceRanges,
  createMentionLinkEvidencePage,
  createNodeEvidenceRanges,
  createSourceEvidenceCandidatePage,
  createSourceEvidencePage,
  createEvidenceReadContext,
  filterAndSortSourceEvidenceCandidatesByFtsQuery,
} from "./source.js";

export async function listArchiveEvidence(
  document: ReadonlyDocument,
  uri: string,
  options: ArchiveEvidenceOptions = {},
): Promise<ArchiveEvidence> {
  let reference: ReturnType<typeof parseWikiGraphReference>;
  try {
    reference = parseWikiGraphReference(uri);
  } catch (error) {
    if (
      /^wikg:\/\/chapter\/.+\/(?:source|summary|title|state)(?:[#/]|$)/u.test(
        uri,
      )
    ) {
      throw new Error(`Evidence is not available for ${uri}.`);
    }
    throw error;
  }

  switch (reference.type) {
    case "artifact":
    case "chapter":
    case "chapter-title":
    case "chapter-state":
    case "chapter-tree":
    case "entity-wikipage":
    case "meta":
    case "text-stream":
      throw new Error(`Evidence is not available for ${uri}.`);
    case "chunk": {
      const { chapterId, node } = await requireNode(document, reference.id);

      if (
        reference.chapterId !== undefined &&
        reference.chapterId !== chapterId
      ) {
        throw new Error(`Chunk ${uri} was not found in this archive.`);
      }
      assertEvidenceChapterAllowed(chapterId, options.chapters, uri);

      return await createSourceEvidencePage(
        document,
        createNodeEvidenceRanges(node),
        options,
      );
    }
    case "entity": {
      if (options.query === undefined) {
        const limit = options.limit ?? DEFAULT_FIND_LIMIT;
        const offset = decodeFindCursor(options.cursor);
        if (options.chapters !== undefined) {
          const mentions = filterMentionsByChapterSet(
            filterMentionsByChapter(
              await document.mentions.listByQid(reference.qid),
              reference.chapterId,
            ),
            new Set(options.chapters),
          );
          return await createMentionEvidencePage(
            document,
            mentions.slice(offset, offset + limit),
            {
              context: createEvidenceReadContext(),
              limit,
              offset,
              sourceContext: options.sourceContext,
              total: mentions.length,
            },
          );
        }
        const chapterFilter =
          reference.chapterId === undefined
            ? {}
            : { chapterId: reference.chapterId };
        const [total, mentions] = await Promise.all([
          document.mentions.countByQid(reference.qid, chapterFilter),
          document.mentions.listByQid(reference.qid, {
            ...chapterFilter,
            limit,
            offset,
            order: options.order === "doc-desc" ? "desc" : "asc",
          }),
        ]);

        return await createMentionEvidencePage(document, mentions, {
          context: createEvidenceReadContext(),
          limit,
          offset,
          sourceContext: options.sourceContext,
          total,
        });
      }

      const limit = options.limit ?? DEFAULT_FIND_LIMIT;
      const offset = decodeFindCursor(options.cursor);
      const mentions = filterMentionsByChapterSet(
        filterMentionsByChapter(
          await document.mentions.listByQid(reference.qid),
          reference.chapterId,
        ),
        options.chapters === undefined ? undefined : new Set(options.chapters),
      );
      const candidates = await filterAndSortSourceEvidenceCandidatesByFtsQuery(
        document,
        mentions,
        async (mention) =>
          await createMentionEvidenceRanges(document, [mention]),
        (mention) => mention.id,
        options.query,
        options.skipUnindexed,
      );

      return await createSourceEvidenceCandidatePage(document, {
        candidates: candidates.slice(offset, offset + limit),
        context: createEvidenceReadContext(),
        createRanges: async (match) =>
          (await createMentionEvidenceRanges(document, [match.candidate])).map(
            (range) => ({ ...range, score: match.score }),
          ),
        limit,
        offset,
        sourceContext: options.sourceContext,
        total: candidates.length,
      });
    }
    case "triple": {
      if (options.query === undefined) {
        const limit = options.limit ?? DEFAULT_FIND_LIMIT;
        const offset = decodeFindCursor(options.cursor);
        if (options.chapters !== undefined) {
          const links = await filterMentionLinksByChapterSet(
            document,
            await filterMentionLinksByChapter(
              document,
              await document.mentionLinks.listByTriple({
                objectQid: reference.objectQid,
                predicate: reference.predicate,
                subjectQid: reference.subjectQid,
              }),
              reference.chapterId,
            ),
            new Set(options.chapters),
          );
          return await createMentionLinkEvidencePage(
            document,
            links.slice(offset, offset + limit),
            {
              context: createEvidenceReadContext(),
              limit,
              offset,
              sourceContext: options.sourceContext,
              total: links.length,
            },
          );
        }
        const tripleQuery = {
          ...(reference.chapterId === undefined
            ? {}
            : { chapterId: reference.chapterId }),
          objectQid: reference.objectQid,
          predicate: reference.predicate,
          subjectQid: reference.subjectQid,
        };
        const [total, links] = await Promise.all([
          document.mentionLinks.countByTriple(tripleQuery),
          document.mentionLinks.listByTriple({
            ...tripleQuery,
            limit,
            offset,
            order: options.order === "doc-desc" ? "desc" : "asc",
          }),
        ]);

        return await createMentionLinkEvidencePage(document, links, {
          context: createEvidenceReadContext(),
          limit,
          offset,
          sourceContext: options.sourceContext,
          total,
        });
      }

      const limit = options.limit ?? DEFAULT_FIND_LIMIT;
      const offset = decodeFindCursor(options.cursor);
      const links = await filterMentionLinksByChapterSet(
        document,
        await filterMentionLinksByChapter(
          document,
          await document.mentionLinks.listByTriple({
            objectQid: reference.objectQid,
            predicate: reference.predicate,
            subjectQid: reference.subjectQid,
          }),
          reference.chapterId,
        ),
        options.chapters === undefined ? undefined : new Set(options.chapters),
      );
      const candidates = await filterAndSortSourceEvidenceCandidatesByFtsQuery(
        document,
        links,
        (link) => createMentionLinkEvidenceRanges(document, [link]),
        (link) => link.id,
        options.query,
        options.skipUnindexed,
      );

      return await createSourceEvidenceCandidatePage(document, {
        candidates: candidates.slice(offset, offset + limit),
        context: createEvidenceReadContext(),
        createRanges: (match) =>
          createMentionLinkEvidenceRanges(document, [match.candidate]).map(
            (range) => ({ ...range, score: match.score }),
          ),
        limit,
        offset,
        sourceContext: options.sourceContext,
        total: candidates.length,
      });
    }
  }
}

async function filterMentionLinksByChapterSet(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  chapters: ReadonlySet<number> | undefined,
): Promise<readonly MentionLinkRecord[]> {
  if (chapters === undefined) return links;
  const filtered: MentionLinkRecord[] = [];
  for (const link of links) {
    const source = await document.mentions.getById(link.sourceMentionId);
    if (source !== undefined && chapters.has(source.chapterId)) {
      filtered.push(link);
    }
  }
  return filtered;
}

function assertEvidenceChapterAllowed(
  chapterId: number,
  chapters: readonly number[] | undefined,
  uri: string,
): void {
  if (chapters !== undefined && !chapters.includes(chapterId)) {
    throw new Error(`Object ${uri} was not found in this archive scope.`);
  }
}

export {
  createFindEvidenceHydrationOptions,
  hydrateFindHitEvidence,
} from "./evidence-hydration.js";
