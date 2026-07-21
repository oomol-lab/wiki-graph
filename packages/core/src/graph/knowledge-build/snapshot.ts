import type { ReadonlyDocument } from "../../document/index.js";
import { getChapterDetails } from "../../document/chapter/index.js";
import { readChapterFragments } from "./fragments.js";
import type { ChapterKnowledgeGraphInputSnapshot } from "./types.js";

export async function snapshotChapterKnowledgeGraphInput(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<ChapterKnowledgeGraphInputSnapshot> {
  const details = await getChapterDetails(document, chapterId);

  if (details.stage === "planned") {
    throw new Error(
      `Chapter ${chapterId} is planned. Set source before generating Knowledge Graph.`,
    );
  }

  return {
    details,
    fragments: await readChapterFragments(document, chapterId),
  };
}
