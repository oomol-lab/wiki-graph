import type { ReadonlyDocument } from "../../../document/index.js";

import { parseWikiGraphReference } from "./references.js";
import type { ArchiveEvidence, ArchiveEvidenceOptions } from "./types.js";
import { requireNode } from "./core.js";
import {
  filterMentionLinksByChapter,
  filterMentionsByChapter,
} from "./knowledge.js";
import {
  createMentionEvidenceRanges,
  createMentionLinkEvidenceRanges,
  createNodeEvidenceRanges,
  createSourceEvidencePage,
} from "./source.js";

export async function listArchiveEvidence(
  document: ReadonlyDocument,
  uri: string,
  options: ArchiveEvidenceOptions = {},
): Promise<ArchiveEvidence> {
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
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

      return await createSourceEvidencePage(
        document,
        createNodeEvidenceRanges(node),
        options,
      );
    }
    case "entity":
      return await createSourceEvidencePage(
        document,
        await createMentionEvidenceRanges(
          document,
          filterMentionsByChapter(
            await document.mentions.listByQid(reference.qid),
            reference.chapterId,
          ),
        ),
        options,
      );
    case "triple":
      return await createSourceEvidencePage(
        document,
        createMentionLinkEvidenceRanges(
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
        ),
        options,
      );
  }
}

export {
  createFindEvidenceHydrationOptions,
  hydrateFindHitEvidence,
} from "./evidence-hydration.js";
