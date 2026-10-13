import type { ReadonlyDocument } from "../../../../document/index.js";
import type { ChapterEntry } from "../../../../document/chapter/index.js";

import { readTextStreamRange } from "../text-streams.js";
import type { ArchiveEvidenceItem, EvidenceReadContext } from "../types.js";
import { requireChapter } from "../core.js";
import type { WikiGraphRetrievalSignals } from "../../../../api/objects.js";

export async function createSourceEvidenceItem(
  document: ReadonlyDocument,
  chapterId: number,
  startSentenceIndex: number,
  endSentenceIndex: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
  score?: number,
  signals: WikiGraphRetrievalSignals = {},
): Promise<ArchiveEvidenceItem> {
  const chapter = await getEvidenceChapter(document, chapterId, context);
  const range = await readTextStreamRange(
    document,
    chapterId,
    "source",
    startSentenceIndex,
    endSentenceIndex,
    context,
  );

  return {
    chapterId,
    endSentenceIndex: range.endSentenceIndex,
    fragmentId: range.startSentenceIndex,
    id: range.id,
    ...(score === undefined ? {} : { score }),
    ...signals,
    source: range.text,
    startSentenceIndex: range.startSentenceIndex,
    title: chapter.title ?? chapter.uri,
    type: "source",
  };
}

export function createEvidenceReadContext(): EvidenceReadContext {
  return {
    chapters: new Map(),
    streamIndexes: new Map(),
  };
}

async function getEvidenceChapter(
  document: ReadonlyDocument,
  chapterId: number,
  context: EvidenceReadContext,
): Promise<ChapterEntry> {
  let chapter = context.chapters.get(chapterId);

  if (chapter === undefined) {
    chapter = requireChapter(document, chapterId);
    context.chapters.set(chapterId, chapter);
  }

  return await chapter;
}
