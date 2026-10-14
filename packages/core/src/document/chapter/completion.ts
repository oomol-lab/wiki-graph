import type { ReadonlyDocument } from "../directory/index.js";
import type { ChapterStage } from "./types.js";

/** Summary existence records completion independently of its text length. */
export async function resolveChapterStage(
  document: ReadonlyDocument,
  chapterId: number,
  fragmentCount: number,
): Promise<ChapterStage> {
  const summary = document.getSummaryFragments(chapterId);
  const hasSummary =
    summary.exists === undefined
      ? (await document.readSummary(chapterId)) !== undefined
      : await summary.exists();
  if (hasSummary) {
    return "summarized";
  }
  if ((await document.serials.getById(chapterId))?.topologyReady === true) {
    return "graphed";
  }
  return fragmentCount > 0 ? "sourced" : "planned";
}
