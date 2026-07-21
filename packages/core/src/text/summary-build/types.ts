import type {
  ChunkRecord,
  FragmentRecord,
  ReadingEdgeRecord,
  SentenceGroupRecord,
  SerialRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "../../document/index.js";
import type { LLM } from "../../external/llm/index.js";
import type { Language } from "../../runtime/common/language.js";
import type { WikiGraphScope } from "../../runtime/common/llm-scope.js";

export interface ChapterSummaryInputSnapshot {
  readonly filePath: string;
}

export interface BuildChapterSummaryArtifactOptions {
  readonly llm: LLM<WikiGraphScope>;
  readonly logDirPath?: string;
  readonly snapshotPath?: string;
  readonly sourceDocumentPath?: string;
  readonly userLanguage?: Language;
  readonly workspacePath: string;
}

export interface SummaryInputSnapshotData {
  readonly chunks: readonly ChunkRecord[];
  readonly fragmentGroups: readonly SentenceGroupRecord[];
  readonly fragments: readonly FragmentRecord[];
  readonly readingEdges: readonly ReadingEdgeRecord[];
  readonly serial: SerialRecord;
  readonly snakeChunks: readonly SnakeChunkRecord[];
  readonly snakeEdges: readonly SnakeEdgeRecord[];
  readonly snakes: readonly SnakeRecord[];
}
