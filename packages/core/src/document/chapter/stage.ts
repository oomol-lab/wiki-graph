import type { ReadonlyDocument } from "../directory/index.js";
import { getChapterDetails } from "./query.js";
import type { ChapterDetails } from "./types.js";

export async function requireStage(
  document: ReadonlyDocument,
  chapterId: number,
  stage: ChapterDetails["stage"],
): Promise<void> {
  const details = await getChapterDetails(document, chapterId);

  if (details.stage !== stage) {
    throw new Error(
      `Chapter ${chapterId} is ${details.stage}. Expected ${stage} before committing build output.`,
    );
  }
}
