export type QueryScope =
  | { readonly kind: "archive"; readonly archiveId: number }
  | { readonly kind: "library"; readonly libraryId: number }
  | {
      readonly archiveId: number;
      readonly kind: "library-archive";
      readonly libraryId: number;
    };

export type QueryIndexScope =
  | {
      readonly archiveKey: string;
      readonly archivePath: string;
      readonly kind: "archive-index";
    }
  | { readonly kind: "library-index"; readonly libraryId: number };

export function createArchiveQueryIndexScope(input: {
  readonly archiveKey: string;
  readonly archivePath: string;
}): QueryIndexScope {
  return { ...input, kind: "archive-index" };
}

export function createLibraryQueryIndexScope(
  libraryId: number,
): QueryIndexScope {
  return { kind: "library-index", libraryId };
}
