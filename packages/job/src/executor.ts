import type {
  ChapterJobArtifact,
  ChapterJobKind,
  ChapterJobSnapshot,
} from "./contracts.js";

export interface ChapterJobExecutor {
  execute<K extends ChapterJobKind>(
    snapshot: ChapterJobSnapshot<K>,
  ): Promise<ChapterJobArtifact<K>>;
}
