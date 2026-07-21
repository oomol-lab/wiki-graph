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
import type {
  GenerateChapterGraphOptions,
  GenerateChapterSummaryOptions,
} from "../chapter/index.js";

export interface ChapterGraphBuildArtifact {
  readonly documentPath: string;
  readonly chapterId: number;
  readonly parameter: GraphBuildParameterInput;
}

export interface GraphBuildParameterInput {
  readonly language?: string;
  readonly prompt: string;
}

export interface ChapterSummaryInputSnapshot {
  readonly filePath: string;
}

export interface BuildChapterGraphArtifactOptions
  extends GenerateChapterGraphOptions {
  readonly sourceText: readonly string[];
  readonly workspacePath: string;
}

export interface BuildChapterSummaryArtifactOptions
  extends GenerateChapterSummaryOptions {
  readonly snapshotPath?: string;
  readonly sourceDocumentPath?: string;
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
