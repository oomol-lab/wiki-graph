import type { MentionLinkRecord, MentionRecord } from "../../../document/index.js";
import type { BookMeta } from "../../../text/source/index.js";
import type { GraphNeighbor } from "../../../graph/reading.js";
import type { ChapterEntry, ChapterTree } from "../../../document/chapter/index.js";

export type ArchiveObjectType =
  | "chapter"
  | "chapter-title"
  | "chapter-tree"
  | "edge"
  | "entity"
  | "fragment"
  | "meta"
  | "node"
  | "source"
  | "state"
  | "summary"
  | "triple";
export type ChapterStateTarget =
  | "knowledge-graph"
  | "reading-graph"
  | "reading-summary"
  | "source";
export type ChapterStateValue = "missing" | "ready";
export type ChapterState = Record<ChapterStateTarget, ChapterStateValue>;

export type ArchiveCollectionType =
  | "chapter"
  | "chapter-title"
  | "entity"
  | "fragment"
  | "meta"
  | "node"
  | "source"
  | "summary"
  | "triple";

export type ArchiveFindObjectType =
  | "chapter"
  | "chapter-title"
  | "chapter-tree"
  | "entity"
  | "fragment"
  | "meta"
  | "node"
  | "source"
  | "summary"
  | "triple";

export type ArchiveFindFilterType =
  | "chapter"
  | "chapter-title"
  | "entity"
  | "fragment"
  | "meta"
  | "node"
  | "source"
  | "summary"
  | "triple";

export interface ArchiveIndex {
  readonly chapters: readonly ChapterEntry[];
  readonly edgeCount: number;
  readonly meta: BookMeta | undefined;
  readonly nodeCount: number;
  readonly summaryCount: number;
}

export interface ArchiveFindHit {
  readonly backlinks?: ArchiveBacklinks;
  readonly chapter?: number;
  readonly evidence?: ArchiveFindEvidencePreview;
  readonly evidenceLinks?: readonly MentionLinkRecord[];
  readonly evidenceMentions?: readonly EntityEvidenceMention[];
  readonly field: ArchiveFindField;
  readonly id: string;
  readonly matchCount?: number;
  readonly matchedTerms?: readonly string[];
  readonly missingTerms?: readonly string[];
  readonly position?: ArchiveFindPosition;
  readonly score?: number;
  readonly snippet: string;
  readonly state?: ChapterState;
  readonly title: string;
  readonly triple?: {
    readonly objectLabel: string;
    readonly predicate: string;
    readonly subjectLabel: string;
  };
  readonly type: ArchiveFindObjectType;
}

export interface EntityEvidenceMention {
  readonly match: Pick<
    ArchiveFindHit,
    "matchCount" | "matchedTerms" | "missingTerms" | "score"
  >;
  readonly mention: MentionRecord;
}

export interface EvidenceReadContext {
  readonly chapters: Map<number, Promise<ChapterEntry>>;
  readonly streamIndexes: Map<string, Promise<ArchiveTextStreamIndex>>;
}

export interface ArchiveFindEvidencePreview {
  readonly nextCursor: string | null;
  readonly shown: number;
  readonly sources: readonly ArchiveEvidenceItem[];
  readonly total: number;
}

export type ArchiveFindField =
  | "content"
  | "metadata"
  | "source"
  | "summary"
  | "title";

export interface ArchiveFindOptions {
  readonly archiveKey?: string;
  readonly backlinks?: boolean;
  readonly chapters?: readonly number[];
  readonly cursor?: string;
  readonly evidenceLimit?: number;
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly match?: ArchiveFindMatch;
  readonly order?: ArchiveFindOrder;
  readonly sourceContext?: number;
  readonly triplePattern?: ArchiveTriplePattern;
  readonly types?: readonly ArchiveFindFilterType[];
}

export type ArchiveFindOrder = "doc-asc" | "doc-desc";
export type ArchiveFindMatch = "all" | "any";

export interface ArchiveFindPosition {
  readonly chapter: number;
  readonly documentOrder?: number;
  readonly fragment?: number;
  readonly sentence?: number;
}

export interface ArchiveFindResult {
  readonly chapters: readonly number[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly lens: ArchiveFindLens;
  readonly lensHint: ArchiveFindLensHint | null;
  readonly limit: number;
  readonly match: ArchiveFindMatch;
  readonly nextCursor: string | null;
  readonly order: ArchiveFindOrder;
  readonly query: string;
  readonly terms: readonly string[];
  readonly types: readonly ArchiveFindFilterType[] | null;
}

export type ArchiveFindLens = "broad" | "exact" | "typed";

export interface ArchiveFindLensHint {
  readonly lenses: {
    readonly chapter: string;
    readonly chunk: string;
    readonly entity: string;
    readonly node: string;
    readonly triple: string;
  };
  readonly message: string;
}

export interface ArchiveCollectionOptions {
  readonly backlinks?: boolean;
  readonly chapters?: readonly number[];
  readonly cursor?: string;
  readonly evidenceLimit?: number;
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly order?: ArchiveFindOrder;
  readonly sourceContext?: number;
  readonly triplePattern?: ArchiveTriplePattern;
  readonly types?: readonly ArchiveCollectionType[];
}

export interface ArchiveTriplePattern {
  readonly objectQid?: string;
  readonly predicate?: string;
  readonly subjectQid?: string;
}

export interface ArchiveCollectionResult {
  readonly chapters: readonly number[] | null;
  readonly ids: readonly string[] | null;
  readonly items: readonly ArchiveFindHit[];
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly order: ArchiveFindOrder;
  readonly types: readonly ArchiveCollectionType[] | null;
}

export interface ArchiveBacklinks {
  readonly chunks: ArchiveBacklinkBucket;
  readonly entities: ArchiveBacklinkBucket;
  readonly triples: ArchiveBacklinkBucket;
}

export interface ArchiveBacklinkBucket {
  readonly items: readonly ArchiveFindHit[];
  readonly limit: number;
  readonly nextCursor: string | null;
}

export type ArchiveListKind =
  | "chapters"
  | "edges"
  | "fragments"
  | "meta"
  | "nodes"
  | "summaries";

export type ArchiveListItem =
  | {
      readonly evidence?: ArchiveFindEvidencePreview;
      readonly id: string;
      readonly label: string;
      readonly score?: number;
      readonly state?: ChapterState;
      readonly summary: string;
      readonly type: Exclude<ArchiveObjectType, "triple">;
    }
  | {
      readonly evidence?: ArchiveFindEvidencePreview;
      readonly id: string;
      readonly label: string;
      readonly evidenceLinks?: readonly MentionLinkRecord[];
      readonly objectLabel: string;
      readonly objectQid: string;
      readonly predicate: string;
      readonly score?: number;
      readonly subjectLabel: string;
      readonly subjectQid: string;
      readonly summary: string;
      readonly type: "triple";
    };

export type ArchivePage =
  | {
      readonly id: string;
      readonly state: ChapterState;
      readonly title: string;
      readonly type: "chapter";
    }
  | {
      readonly id: string;
      readonly title: string;
      readonly type: "chapter-title";
    }
  | {
      readonly id: string;
      readonly title: string;
      readonly tree: ChapterTree;
      readonly type: "chapter-tree";
    }
  | {
      readonly generatedNodeSummary: string;
      readonly id: string;
      readonly incoming: readonly GraphNeighbor[];
      readonly neighbors: readonly GraphNeighbor[];
      readonly outgoing: readonly GraphNeighbor[];
      readonly position: ArchiveFindPosition | undefined;
      readonly sourceFragments: readonly ArchiveNodeSourceFragment[];
      readonly title: string;
      readonly type: "node";
    }
  | {
      readonly backlinks?: ArchiveBacklinks;
      readonly fragment: ArchiveSourceFragment;
      readonly id: string;
      readonly nextFragmentId: string | undefined;
      readonly nodes: readonly ArchiveNodeLabel[];
      readonly previousFragmentId: string | undefined;
      readonly title: string;
      readonly type: "fragment";
    }
  | {
      readonly content: string;
      readonly id: string;
      readonly title: string;
      readonly type: "summary";
    }
  | {
      readonly evidence: ArchiveFindEvidencePreview;
      readonly id: string;
      readonly label: string;
      readonly labels: readonly string[];
      readonly mentionCount: number;
      readonly qid: string;
      readonly type: "entity";
    }
  | {
      readonly en: ArchiveEntityWikipageLocale | null;
      readonly id: string;
      readonly type: "entity-wikipage";
      readonly zh: ArchiveEntityWikipageLocale | null;
    }
  | {
      readonly evidence: ArchiveFindEvidencePreview;
      readonly id: string;
      readonly label: string;
      readonly objectQid: string;
      readonly predicate: string;
      readonly subjectQid: string;
      readonly type: "triple";
    }
  | {
      readonly authors?: readonly string[];
      readonly description?: string;
      readonly id: string;
      readonly publisher?: string;
      readonly title: string;
      readonly type: "meta";
    }
  | {
      readonly id: string;
      readonly state: ChapterState;
      readonly type: "state";
    }
  | {
      readonly id: string;
      readonly target: ChapterStateTarget;
      readonly type: "state";
      readonly value: ChapterStateValue;
    };

export interface ArchiveEntityWikipageLocale {
  readonly description?: string;
  readonly title: string;
  readonly url: string;
}

export interface ArchivePack {
  readonly anchor: ArchivePage;
  readonly budget: number;
  readonly related: readonly ArchiveListItem[];
}

export type ArchiveRelatedRole = "any" | "object" | "self" | "subject";

export interface ArchiveRelatedOptions {
  readonly cursor?: string;
  readonly evidenceLimit?: number;
  readonly limit?: number;
  readonly order?: ArchiveFindOrder;
  readonly query?: string;
  readonly role?: ArchiveRelatedRole;
  readonly sourceContext?: number;
}

export interface ArchiveRelatedResult {
  readonly items: readonly ArchiveListItem[];
  readonly limit: number;
  readonly nextCursor: string | null;
}

export interface ArchiveEvidence {
  readonly items: readonly ArchiveEvidenceItem[];
  readonly limit: number;
  readonly nextCursor: string | null;
}

export interface ArchiveEvidenceItem {
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly fragmentId?: number;
  readonly id: string;
  readonly score?: number;
  readonly source: string;
  readonly startSentenceIndex: number;
  readonly title: string;
  readonly type: "source";
}

export interface ArchiveNodeLabel {
  readonly id: string;
  readonly title: string;
}

export interface PositionedNodeLabel {
  readonly label: ArchiveNodeLabel;
  readonly position: ArchiveFindPosition | undefined;
}

export interface ArchiveSourceFragment {
  readonly fragmentId?: number;
  readonly id: string;
  readonly preview: string;
  readonly sentenceCount: number;
  readonly text: string;
  readonly wordsCount: number;
}

export type ArchiveTextStreamKind = "source" | "summary";
export type SourceEvidenceRange = {
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly score?: number;
  readonly startSentenceIndex: number;
};

export type TextStreamHitRange = {
  readonly chapterId: number;
  readonly endSentenceIndex: number;
  readonly hit: ArchiveFindHit;
  readonly startSentenceIndex: number;
  readonly stream: ArchiveTextStreamKind;
};

export interface ArchiveTextStreamSentence {
  readonly fragmentId: number;
  readonly globalIndex: number;
  readonly localIndex: number;
  readonly text: string;
  readonly wordsCount: number;
}

export interface ArchiveTextStreamIndex {
  readonly sentences: readonly ArchiveTextStreamSentence[];
}

export interface ArchiveNodeSourceFragment {
  readonly id: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface ArchiveEvidenceOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: ArchiveFindOrder;
  readonly query?: string;
  readonly sourceContext?: number;
}
