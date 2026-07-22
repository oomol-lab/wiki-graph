export type QueryScope =
  | { readonly kind: "archive"; readonly archiveId: number }
  | { readonly kind: "library"; readonly libraryId: number };

export type QueryIndexScope =
  | {
      readonly kind: "archive-index";
      readonly archivePath: string;
      readonly archiveKey: string;
    }
  | { readonly kind: "library-index"; readonly libraryId: number };

type ContinuationCursorBase = {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly indexScope: QueryIndexScope;
};

export type ContinuationCursor =
  | (ContinuationCursorBase & {
      readonly backlinks?: boolean;
      readonly chapters: readonly number[] | null;
      readonly cursor: string;
      readonly evidenceLimit?: number;
      readonly format: "json" | "jsonl" | "text";
      readonly ids: readonly string[] | null;
      readonly kind: "collection";
      readonly order: "doc-asc" | "doc-desc";
      readonly sourceContext?: number;
      readonly triplePattern?: {
        readonly objectQid?: string;
        readonly predicate?: string;
        readonly subjectQid?: string;
      };
      readonly types: readonly string[] | null;
    })
  | (ContinuationCursorBase & {
      readonly backlinks?: boolean;
      readonly chapters?: readonly number[] | null;
      readonly cursor: string;
      readonly evidenceLimit?: number;
      readonly format: "json" | "jsonl" | "text";
      readonly kind: "search";
      readonly query?: string;
      readonly sourceContext?: number;
      readonly triplePattern?: {
        readonly objectQid?: string;
        readonly predicate?: string;
        readonly subjectQid?: string;
      };
      readonly types: readonly string[] | null;
    })
  | (ContinuationCursorBase & {
      readonly cursor: string;
      readonly format: "json" | "jsonl" | "text";
      readonly kind: "evidence";
      readonly order: "doc-asc" | "doc-desc";
      readonly query?: string;
      readonly sourceContext?: number;
      readonly targetUri: string;
    })
  | (ContinuationCursorBase & {
      readonly cursor: string;
      readonly evidenceLimit?: number;
      readonly format: "json" | "jsonl" | "text";
      readonly kind: "related";
      readonly order: "doc-asc" | "doc-desc";
      readonly query?: string;
      readonly role?: "any" | "object" | "self" | "subject";
      readonly sourceContext?: number;
      readonly targetUri: string;
    });
