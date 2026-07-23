import type { QueryIndexScope } from "wiki-graph-core";
import type { CLIArchiveArguments } from "../../../args/index.js";

export type ResultFormat = "json" | "jsonl" | "text";

export const DEFAULT_GET_EVIDENCE_LIMIT = 3;
export const PLAIN_OBJECT_KEY_PRIORITY = [
  "uri",
  "title",
  "label",
  "labels",
  "state",
  "value",
  "authors",
  "publisher",
  "description",
] as const;

export interface ArchiveOutputObject {
  readonly archiveId?: number;
  readonly authors?: readonly string[];
  readonly backlinks?: ArchiveOutputBacklinks;
  readonly description?: string;
  readonly evidence?: ArchiveOutputEvidencePreview;
  readonly label?: string;
  readonly libraryArchiveUri?: string;
  readonly objectLabel?: string;
  readonly predicate?: string;
  readonly publisher?: string;
  readonly score?: number;
  readonly state?: Record<string, string>;
  readonly subjectLabel?: string;
  readonly sources?: readonly ArchiveOutputLibrarySource[];
  readonly text?: string;
  readonly title?: string;
  readonly type?: string;
  readonly uri: string;
  readonly value?: string;
}

export interface ArchiveOutputLibrarySource {
  readonly archiveId: number;
  readonly libraryArchiveUri: string;
}

export interface ArchiveOutputBacklinks {
  readonly chunks: ArchiveOutputResultPage;
  readonly entities: ArchiveOutputResultPage;
  readonly triples: ArchiveOutputResultPage;
}

export interface ArchiveOutputResultPage {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly objects: readonly ArchiveOutputObject[];
}

export interface ArchiveOutputEvidencePreview {
  readonly nextCursor: string | null;
  readonly shown: number;
  readonly sources: readonly ArchiveOutputSource[];
  readonly total: number;
}

export interface ArchiveOutputSource {
  readonly archiveId?: number;
  readonly libraryArchiveUri?: string;
  readonly score?: number;
  readonly text: string;
  readonly uri: string;
}

export interface ArchiveOutputContext {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly backlinks?: boolean;
  readonly chapters?: readonly number[];
  readonly continuationKind?: "collection" | "evidence" | "related" | "search";
  readonly evidenceDisabled?: boolean;
  readonly evidenceLimit?: number;
  readonly format: ResultFormat;
  readonly ids?: readonly string[];
  readonly indexScope: QueryIndexScope;
  readonly limit: number;
  readonly order?: "doc-asc" | "doc-desc";
  readonly query?: string;
  readonly role?: CLIArchiveArguments["role"];
  readonly sourceContext?: number;
  readonly targetUri?: string;
  readonly triplePattern?: CLIArchiveArguments["triplePattern"];
  readonly types: readonly string[] | null;
}
