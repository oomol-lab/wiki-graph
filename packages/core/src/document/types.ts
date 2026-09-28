import {
  createEnumValueAsserter,
  createEnumValueGuard,
} from "../utils/enum.js";

export enum ChunkRetention {
  Verbatim = "verbatim",
  Detailed = "detailed",
  Focused = "focused",
  Relevant = "relevant",
}

export const isChunkRetention = createEnumValueGuard(ChunkRetention);
export const expectChunkRetention = createEnumValueAsserter(
  ChunkRetention,
  "chunk retention",
);

export enum ChunkImportance {
  Critical = "critical",
  Important = "important",
  Helpful = "helpful",
}

export const isChunkImportance = createEnumValueGuard(ChunkImportance);
export const expectChunkImportance = createEnumValueAsserter(
  ChunkImportance,
  "chunk importance",
);

export type SentenceId = readonly [chapterId: number, sentenceIndex: number];

export interface SentenceRecord {
  readonly text: string;
  readonly wordsCount: number;
}

export class Sentence implements SentenceRecord {
  #text: string | undefined;
  public readonly rawText: string;
  public readonly wordsCount: number;

  public constructor(rawText: string, wordsCount: number) {
    this.rawText = rawText;
    this.wordsCount = wordsCount;
  }

  public get text(): string {
    this.#text ??= normalizeSentenceText(this.rawText);

    return this.#text;
  }

  public toJSON(): SentenceRecord {
    return {
      text: this.text,
      wordsCount: this.wordsCount,
    };
  }
}

export interface FragmentRecord {
  readonly serialId: number;
  readonly fragmentId: number;
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

export interface SerialRecord {
  readonly documentOrder: number;
  readonly knowledgeGraphReady: boolean;
  readonly knowledgeGraphParameterHash?: string;
  readonly id: number;
  readonly revision: number;
  readonly topologyParameterHash?: string;
  readonly topologyReady: boolean;
}

export interface SourceArtifactInput {
  readonly digest: string;
  readonly identifier?: string;
  readonly mediaType: string;
  readonly name?: string;
}

export interface SourceArtifactRecord extends SourceArtifactInput {
  readonly id: number;
  readonly shortUid: string;
}

export interface SourceTextMappingInput {
  readonly artifactDigest: string;
  readonly locator: Readonly<Record<string, unknown>>;
  readonly sourceEnd: number;
  readonly sourceStart: number;
}

export interface SourceTextProvenanceInput {
  readonly artifacts: readonly SourceArtifactInput[];
  readonly mappings: readonly SourceTextMappingInput[];
}

export interface SourceTextMapRecord {
  readonly artifact: Omit<SourceArtifactRecord, "id">;
  readonly fragment: string;
  readonly locator: Readonly<Record<string, unknown>>;
  readonly sourceEnd: number;
  readonly sourceRevision: number;
  readonly sourceStart: number;
}

export interface SourceLocatorRecord {
  readonly artifact: Omit<SourceArtifactRecord, "id">;
  readonly fragment: string;
  readonly locator: Readonly<Record<string, unknown>>;
}

export interface GraphBuildParameterRecord {
  readonly createdAt: string;
  readonly hash: string;
  readonly language?: string;
  readonly prompt: string;
}

export const INDEX_ARTIFACT_KINDS = [
  "fts",
  "embedding-source",
  "embedding-summary",
] as const;

export type IndexArtifactKind = (typeof INDEX_ARTIFACT_KINDS)[number];

export interface IndexArtifactRecord {
  readonly createdAt: string;
  readonly kind: IndexArtifactKind;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly serialId: number;
  readonly sourceRevision: number;
}

export interface IndexArtifactCoverageRecord {
  readonly current: boolean;
  readonly kind: IndexArtifactKind;
  readonly serialId: number;
  readonly serialRevision: number;
  readonly sourceRevision?: number;
}

export interface IndexArtifactLexicalRow {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly objectId: string;
  readonly objectKind: string;
  readonly rowId: string;
  readonly sentenceIndex?: number;
  readonly text: string;
  readonly tokens: readonly string[];
}

export interface IndexArtifactEmbeddingSegment {
  readonly endSentenceIndex: number;
  readonly segmentIndex: number;
  readonly startSentenceIndex: number;
  readonly text: string;
  readonly vector: readonly number[];
  readonly wordsCount: number;
}

export interface ReplaceFtsIndexArtifactInput {
  readonly lexicalRows:
    | AsyncIterable<IndexArtifactLexicalRow>
    | Iterable<IndexArtifactLexicalRow>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly serialId: number;
  readonly sourceRevision: number;
}

export interface ReplaceEmbeddingIndexArtifactInput {
  readonly kind: "embedding-source" | "embedding-summary";
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly segments:
    | AsyncIterable<IndexArtifactEmbeddingSegment>
    | Iterable<IndexArtifactEmbeddingSegment>;
  readonly serialId: number;
  readonly sourceRevision: number;
}

export interface ChunkRecord {
  readonly id: number;
  readonly generation: number;
  readonly sentenceId: SentenceId;
  readonly label: string;
  readonly content: string;
  readonly sentenceIds: readonly SentenceId[];
  readonly retention?: ChunkRetention;
  readonly importance?: ChunkImportance;
  readonly wordsCount: number;
  readonly weight: number;
}

export type CreateChunkRecord = Omit<ChunkRecord, "id">;

export interface ReadingEdgeRecord {
  readonly fromId: number;
  readonly toId: number;
  readonly strength?: string;
  readonly weight: number;
}

export interface MentionRecord {
  readonly id: string;
  readonly chapterId: number;
  readonly fragmentId?: number;
  readonly sentenceIndex?: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly surface: string;
  readonly qid: string;
  readonly confidence?: number;
  readonly note?: string;
}

export interface MentionLinkRecord {
  readonly id: string;
  readonly sourceMentionId: string;
  readonly targetMentionId: string;
  readonly predicate: string;
  readonly evidenceSentenceIds: readonly SentenceId[];
  readonly confidence?: number;
  readonly note?: string;
}

export interface SnakeRecord {
  readonly id: number;
  readonly serialId: number;
  readonly groupId: number;
  readonly localSnakeId: number;
  readonly size: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly wordsCount: number;
  readonly weight: number;
}

export interface CreateSnakeRecord {
  readonly serialId: number;
  readonly groupId: number;
  readonly localSnakeId: number;
  readonly size: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly wordsCount?: number;
  readonly weight?: number;
}

export interface SnakeChunkRecord {
  readonly snakeId: number;
  readonly chunkId: number;
  readonly position: number;
}

export interface SnakeEdgeRecord {
  readonly fromSnakeId: number;
  readonly toSnakeId: number;
  readonly weight: number;
}

function normalizeSentenceText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export interface SentenceGroupRecord {
  readonly serialId: number;
  readonly groupId: number;
  readonly startSentenceIndex: number;
  readonly endSentenceIndex: number;
  readonly fragmentId?: number;
}

export type FragmentGroupRecord = SentenceGroupRecord;

export const enum ObjectMetadataKind {
  Archive = 1,
  Chapter = 2,
  Chunk = 3,
  Entity = 4,
  Triple = 5,
  Object = 6,
}

export interface ObjectMetadataTarget {
  readonly kind: ObjectMetadataKind;
  readonly objectPath: string;
  readonly chapterId?: number;
  readonly chunkId?: number;
  readonly entityQid?: string;
  readonly tripleSubjectQid?: string;
  readonly triplePredicate?: string;
  readonly tripleObjectQid?: string;
}
