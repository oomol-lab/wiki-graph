import type { ReadonlyDocument } from "../../../document/index.js";
import type { ChapterEntry } from "../../../facade/chapter.js";

import { formatTextStreamRangeUri } from "./references.js";
import { readTextStreamRange } from "./text-streams.js";
import type { ArchiveEvidenceItem, EvidenceReadContext } from "./types.js";
import { requireChapter } from "./core.js";

export async function createSourceEvidenceItem(
  document: ReadonlyDocument,
  chapterId: number,
  startSentenceIndex: number,
  endSentenceIndex: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
  score?: number,
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
    id: formatTextStreamRangeUri(
      chapterId,
      "source",
      range.startSentenceIndex,
      range.endSentenceIndex,
    ),
    ...(score === undefined ? {} : { score }),
    source: range.text,
    startSentenceIndex: range.startSentenceIndex,
    title: chapter.title ?? `[chapter ${chapterId}]`,
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
