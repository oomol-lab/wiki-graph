import type { MentionLinkRecord } from "../document/index.js";
import type { GraphNeighbor } from "../graph/reading.js";
import type { ChapterTree } from "../document/chapter/index.js";
import type {
  ArchiveFindEvidencePreview,
  ArchiveFindPosition,
  ArchiveNodeSourceFragment,
  ArchiveSourceFragment,
  ArchiveNodeLabel,
  ArchiveBacklinks,
  ArchiveEntityWikipageLocale,
} from "../retrieval/query/archive-view/types.js";

/** Public identities shared by search, collections and object details. */
export interface WikiGraphLibrarySource {
  readonly archiveId: number;
  readonly libraryArchiveUri: string;
}
export interface WikiGraphLibrarySourceFields {
  readonly archiveId?: number;
  readonly libraryArchiveUri?: string;
  readonly sources?: readonly WikiGraphLibrarySource[];
}
export type WikiGraphChapterStateTarget =
  | "knowledge-graph"
  | "reading-graph"
  | "reading-summary"
  | "source";
export type WikiGraphChapterStateValue = "missing" | "ready";
export type WikiGraphChapterState = Record<
  WikiGraphChapterStateTarget,
  WikiGraphChapterStateValue
>;

export interface WikiGraphObjectIdentity<
  T extends string = string,
> extends WikiGraphLibrarySourceFields {
  readonly id: string;
  readonly type: T;
}

/** Scopes are containers, not their title objects. */
export type WikiGraphScopeIdentity = WikiGraphObjectIdentity<
  "archive" | "chapter"
>;

export type WikiGraphObjectKind =
  | "artifact"
  | "archive-title"
  | "chapter-title"
  | "chapter-tree"
  | "edge"
  | "entity"
  | "entity-wikipage"
  | "fragment"
  | "meta"
  | "node"
  | "source"
  | "state"
  | "summary"
  | "triple";

export type WikiGraphObject = {
  [K in WikiGraphObjectKind]: WikiGraphObjectIdentity<K>;
}[WikiGraphObjectKind];

export interface WikiGraphObjectSummary<
  T extends WikiGraphObjectKind = WikiGraphObjectKind,
> extends WikiGraphObjectIdentity<T> {
  readonly title: string;
}

export type WikiGraphScopeSummary = {
  [K in "archive" | "chapter"]: WikiGraphObjectIdentity<K> & {
    readonly title: string;
    readonly triple?: never;
    readonly state?: WikiGraphChapterState;
  };
}["archive" | "chapter"];

/** `node` is the historic discriminant for a reading-graph chunk. */
export type WikiGraphChunkSummary = WikiGraphObjectSummary<"node">;
export type WikiGraphEntitySummary = WikiGraphObjectSummary<"entity">;
export type WikiGraphSourceSentenceSummary = WikiGraphObjectSummary<"source">;
export type WikiGraphSummarySentenceSummary = WikiGraphObjectSummary<"summary">;
export interface WikiGraphTripleSummary extends WikiGraphObjectSummary<"triple"> {
  readonly triple: {
    readonly objectLabel: string;
    readonly predicate: string;
    readonly subjectLabel: string;
  };
}

export type WikiGraphSearchableKind = Exclude<
  WikiGraphObjectKind,
  "artifact" | "edge" | "state" | "entity-wikipage"
>;
/** Search/collection projections also support scopes, separately from titles. */
export type WikiGraphSearchableSummary =
  | WikiGraphTripleSummary
  | WikiGraphScopeSummary
  | {
      [K in Exclude<
        WikiGraphSearchableKind,
        "triple"
      >]: WikiGraphObjectSummary<K> & {
        readonly triple?: never;
        readonly state?: never;
      };
    }[Exclude<WikiGraphSearchableKind, "triple">];

/** Optional raw query signals, before rank normalization. Missing is not zero. */
export interface WikiGraphRetrievalSignals {
  readonly ftsScore?: number;
  readonly embeddingScore?: number;
}

export type WikiGraphObjectListItem = WikiGraphLibrarySourceFields &
  WikiGraphObjectIdentity &
  (
    | {
        [K in
          | Exclude<
              WikiGraphObjectKind,
              "artifact" | "triple" | "entity-wikipage"
            >
          | "chapter"]: WikiGraphObjectIdentity<K> & {
          readonly evidence?: ArchiveFindEvidencePreview;
          readonly id: string;
          readonly label: string;
          readonly score?: number;
          readonly state?: K extends "chapter" ? WikiGraphChapterState : never;
          readonly summary: string;
          readonly type: K;
        };
      }[
        | Exclude<
            WikiGraphObjectKind,
            "artifact" | "triple" | "entity-wikipage"
          >
        | "chapter"]
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
      }
  );

export type WikiGraphObjectDetails = WikiGraphLibrarySourceFields &
  WikiGraphObjectIdentity &
  (
    | {
        readonly digest: string;
        readonly id: string;
        readonly identifier?: string;
        readonly locator?: Readonly<Record<string, unknown>>;
        readonly mediaType: string;
        readonly name?: string;
        readonly shortUid: string;
        readonly type: "artifact";
      }
    | {
        readonly id: string;
        readonly title: string;
        readonly type: "archive-title";
      }
    | {
        readonly id: string;
        readonly state: WikiGraphChapterState;
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
        readonly state: WikiGraphChapterState;
        readonly type: "state";
      }
    | {
        readonly id: string;
        readonly target: WikiGraphChapterStateTarget;
        readonly type: "state";
        readonly value: WikiGraphChapterStateValue;
      }
  );

export type WikiGraphArtifactDetails = Extract<
  WikiGraphObjectDetails,
  { readonly type: "artifact" }
>;
export type WikiGraphChunkDetails = Extract<
  WikiGraphObjectDetails,
  { readonly type: "node" }
>;
export type WikiGraphEntityDetails = Extract<
  WikiGraphObjectDetails,
  { readonly type: "entity" }
>;
export type WikiGraphTripleDetails = Extract<
  WikiGraphObjectDetails,
  { readonly type: "triple" }
>;
