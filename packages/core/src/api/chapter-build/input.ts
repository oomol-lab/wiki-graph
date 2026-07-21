import type { ReadonlyDocument } from "../../document/index.js";
import { getChapterDetails, type ChapterDetails } from "../chapter/index.js";
import { collectReaderText, readChapterSource } from "./source.js";

export async function readChapterBuildInput(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<{
  readonly details: ChapterDetails;
  readonly revision: number;
  readonly sourceText: readonly string[];
}> {
  const details = await getChapterDetails(document, chapterId);

  return {
    details,
    revision: await document.serials.getRevision(chapterId),
    sourceText: await collectReaderText(readChapterSource(document, chapterId)),
  };
}
