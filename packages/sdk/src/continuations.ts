import {
  createContinuationCursor,
  findArchiveObjects,
  findWikiGraphLibraryArchiveMembers,
  findWikiGraphLibraryObjects,
  listArchiveCollection,
  listArchiveEvidence,
  listArchiveSourceLocators,
  listRelatedArchiveObjects,
  listRelatedWikiGraphLibraryObjects,
  listWikiGraphLibraryArchiveMembers,
  listWikiGraphLibraryEvidence,
  listWikiGraphLibraryObjects,
  readContinuationCursor,
  resolveWikiGraphLibraryQueryTargetById,
  WikiGraphArchiveFile,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  type ArchiveEvidence,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchiveRelatedResult,
  type ArchiveSourceLocatorResult,
  type ContinuationCursor,
  type QueryIndexScope,
} from "wiki-graph-core";

import { resolveWikiGraphArchiveLocation } from "./archives.js";
import {
  buildSearchIndexEmbeddingProvider,
  readWikiGraphEmbeddingConfig,
} from "./embedding.js";
import type { WikiGraphJobRuntime } from "./jobs.js";

export interface WikiGraphContinuationOptions {
  /** Optional archive locator used to verify that the cursor belongs to it. */
  readonly archive?: string;
  readonly cursor: string;
  readonly format?: ContinuationCursor["format"];
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface WikiGraphContinuationContext {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly backlinks?: boolean;
  readonly chapters?: readonly number[];
  readonly continuationKind?: ContinuationCursor["kind"];
  readonly evidenceLimit?: number;
  readonly format: ContinuationCursor["format"];
  readonly ids?: readonly string[];
  readonly indexScope: QueryIndexScope;
  readonly libraryQuery?: "archive-members" | "objects";
  readonly order?: "doc-asc" | "doc-desc";
  readonly query?: string;
  readonly role?: "any" | "object" | "self" | "subject" | undefined;
  readonly skipUnindexed?: boolean;
  readonly sourceContext?: number;
  readonly targetUri?: string;
  readonly triplePattern?:
    | {
        readonly objectQid?: string;
        readonly predicate?: string;
        readonly subjectQid?: string;
      }
    | undefined;
  readonly types: readonly string[] | null;
}

type ContinuationPageBase<TCursor extends ContinuationCursor> = {
  readonly cursor: TCursor;
  readonly format: TCursor["format"];
  readonly limit: number;
};

export type WikiGraphContinuationPage =
  | (ContinuationPageBase<
      Extract<ContinuationCursor, { readonly kind: "source-locators" }>
    > & {
      readonly kind: "source-locators";
      readonly result: ArchiveSourceLocatorResult;
    })
  | (ContinuationPageBase<
      Extract<ContinuationCursor, { readonly kind: "collection" }>
    > & {
      readonly kind: "collection";
      readonly result: ArchiveCollectionResult;
    })
  | (ContinuationPageBase<
      Extract<ContinuationCursor, { readonly kind: "search" }>
    > & {
      readonly kind: "search";
      readonly result: ArchiveFindResult;
    })
  | (ContinuationPageBase<
      Extract<ContinuationCursor, { readonly kind: "evidence" }>
    > & {
      readonly kind: "evidence";
      readonly result: ArchiveEvidence;
    })
  | (ContinuationPageBase<
      Extract<ContinuationCursor, { readonly kind: "related" }>
    > & {
      readonly kind: "related";
      readonly result: ArchiveRelatedResult;
    });

export class WikiGraphContinuationManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async next(
    options: WikiGraphContinuationOptions,
  ): Promise<WikiGraphContinuationPage> {
    return await this.#runtime.run(
      async () => await this.#next(options),
      options.signal,
    );
  }

  public async create(
    context: WikiGraphContinuationContext,
    cursor: string | null | undefined,
  ): Promise<string | null> {
    if (cursor === null || cursor === undefined) return null;
    return await this.#runtime.run(
      async () =>
        await createContinuationCursor(
          createContinuationPayload(context, cursor),
        ),
    );
  }

  async #next(
    options: WikiGraphContinuationOptions,
  ): Promise<WikiGraphContinuationPage> {
    const cursor = await readContinuationCursor(options.cursor);
    const continuationCursor =
      options.format === undefined
        ? cursor
        : ({ ...cursor, format: options.format } as ContinuationCursor);
    const limit = options.limit ?? 20;
    if (options.archive !== undefined) {
      const explicit = await resolveWikiGraphArchiveLocation(options.archive);
      const cursorArchivePath = getCursorArchivePath(cursor);
      if (explicit.archivePath !== cursorArchivePath) {
        throw new Error(
          `Continuation cursor ${options.cursor} belongs to ${cursorArchivePath}, not ${explicit.archivePath}.`,
        );
      }
    }

    const result =
      cursor.indexScope.kind === "library-index"
        ? await continueLibraryCursor(cursor, limit)
        : await continueArchiveCursor(cursor, limit);
    const durableResult = await persistResultCursor(continuationCursor, result);
    return {
      cursor: continuationCursor,
      format: continuationCursor.format,
      kind: cursor.kind,
      limit,
      result: durableResult,
    } as WikiGraphContinuationPage;
  }
}

async function continueArchiveCursor(
  cursor: ContinuationCursor,
  limit: number,
): Promise<
  | ArchiveCollectionResult
  | ArchiveEvidence
  | ArchiveFindResult
  | ArchiveRelatedResult
  | ArchiveSourceLocatorResult
> {
  const location = await resolveWikiGraphArchiveLocation(
    getCursorArchivePath(cursor),
  );
  return await new WikiGraphArchiveFile(location.archiveFile).readDocument(
    async (document) => {
      switch (cursor.kind) {
        case "source-locators":
          return await listArchiveSourceLocators(document, cursor.targetUri, {
            cursor: cursor.cursor,
            limit,
          });
        case "collection":
          return await listArchiveCollection(
            document,
            createCollectionOptions(cursor, limit),
          );
        case "search":
          return await findArchiveObjects(
            document,
            cursor.query ?? "",
            await createFindOptions(cursor, limit),
          );
        case "evidence":
          return await listArchiveEvidence(document, cursor.targetUri, {
            cursor: cursor.cursor,
            limit,
            order: cursor.order,
            ...(cursor.query === undefined ? {} : { query: cursor.query }),
            ...(cursor.skipUnindexed === undefined
              ? {}
              : { skipUnindexed: cursor.skipUnindexed }),
            ...(cursor.sourceContext === undefined
              ? {}
              : { sourceContext: cursor.sourceContext }),
          });
        case "related":
          return await listRelatedArchiveObjects(document, cursor.targetUri, {
            cursor: cursor.cursor,
            ...(cursor.evidenceLimit === undefined
              ? {}
              : { evidenceLimit: cursor.evidenceLimit }),
            limit,
            order: cursor.order,
            ...(cursor.query === undefined ? {} : { query: cursor.query }),
            ...(cursor.role === undefined ? {} : { role: cursor.role }),
            ...(cursor.skipUnindexed === undefined
              ? {}
              : { skipUnindexed: cursor.skipUnindexed }),
            ...(cursor.sourceContext === undefined
              ? {}
              : { sourceContext: cursor.sourceContext }),
          });
      }
    },
  );
}

async function continueLibraryCursor(
  cursor: ContinuationCursor,
  limit: number,
): Promise<
  | ArchiveCollectionResult
  | ArchiveEvidence
  | ArchiveFindResult
  | ArchiveRelatedResult
> {
  if (cursor.kind === "source-locators") {
    throw new Error(
      "Source locator cursors do not use the aggregate library index.",
    );
  }
  if (cursor.indexScope.kind !== "library-index") {
    throw new Error("Internal error: expected a library index cursor.");
  }
  const target = await resolveWikiGraphLibraryQueryTargetById(
    cursor.indexScope.libraryId,
  );
  switch (cursor.kind) {
    case "collection":
      return await (requireLibraryQuery(cursor) === "archive-members"
        ? listWikiGraphLibraryArchiveMembers(
            target,
            createCollectionOptions(cursor, limit),
          )
        : listWikiGraphLibraryObjects(
            target,
            createCollectionOptions(cursor, limit),
          ));
    case "search":
      return await (requireLibraryQuery(cursor) === "archive-members"
        ? findWikiGraphLibraryArchiveMembers(
            target,
            cursor.query ?? "",
            await createFindOptions(cursor, limit),
          )
        : findWikiGraphLibraryObjects(
            target,
            cursor.query ?? "",
            await createFindOptions(cursor, limit),
          ));
    case "evidence":
      return await listWikiGraphLibraryEvidence(target, cursor.targetUri, {
        cursor: cursor.cursor,
        limit,
        order: cursor.order,
        ...(cursor.query === undefined ? {} : { query: cursor.query }),
        ...(cursor.skipUnindexed === undefined
          ? {}
          : { skipUnindexed: cursor.skipUnindexed }),
        ...(cursor.sourceContext === undefined
          ? {}
          : { sourceContext: cursor.sourceContext }),
      });
    case "related":
      return await listRelatedWikiGraphLibraryObjects(
        target,
        cursor.targetUri,
        {
          cursor: cursor.cursor,
          ...(cursor.evidenceLimit === undefined
            ? {}
            : { evidenceLimit: cursor.evidenceLimit }),
          limit,
          order: cursor.order,
          ...(cursor.query === undefined ? {} : { query: cursor.query }),
          ...(cursor.role === undefined ? {} : { role: cursor.role }),
          ...(cursor.skipUnindexed === undefined
            ? {}
            : { skipUnindexed: cursor.skipUnindexed }),
          ...(cursor.sourceContext === undefined
            ? {}
            : { sourceContext: cursor.sourceContext }),
        },
      );
  }
}

function createCollectionOptions(
  cursor: Extract<ContinuationCursor, { readonly kind: "collection" }>,
  limit: number,
): ArchiveCollectionOptions {
  return {
    ...(cursor.backlinks === undefined ? {} : { backlinks: cursor.backlinks }),
    ...(cursor.chapters === null ? {} : { chapters: cursor.chapters }),
    cursor: cursor.cursor,
    ...(cursor.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: cursor.evidenceLimit }),
    ...(cursor.ids === null ? {} : { ids: cursor.ids }),
    limit,
    order: cursor.order,
    ...(cursor.sourceContext === undefined
      ? {}
      : { sourceContext: cursor.sourceContext }),
    ...(cursor.triplePattern === undefined
      ? {}
      : { triplePattern: cursor.triplePattern }),
    ...(cursor.types === null
      ? {}
      : {
          types: cursor.types as NonNullable<ArchiveCollectionOptions["types"]>,
        }),
  };
}

async function createFindOptions(
  cursor: Extract<ContinuationCursor, { readonly kind: "search" }>,
  limit: number,
): Promise<ArchiveFindOptions> {
  const embedding = await readWikiGraphEmbeddingConfig();
  const hasEmbedding =
    embedding.provider !== undefined &&
    embedding.model !== undefined &&
    (embedding.provider !== "openai-compatible" ||
      embedding.baseURL !== undefined) &&
    (embedding.provider !== "openai" || embedding.baseURL === undefined);
  return {
    archiveKey: cursor.archiveKey,
    ...(cursor.backlinks === undefined ? {} : { backlinks: cursor.backlinks }),
    ...(cursor.chapters == null ? {} : { chapters: cursor.chapters }),
    cursor: cursor.cursor,
    ...(cursor.evidenceLimit === undefined
      ? {}
      : { evidenceLimit: cursor.evidenceLimit }),
    limit,
    ...(cursor.skipUnindexed === undefined
      ? {}
      : { skipUnindexed: cursor.skipUnindexed }),
    ...(cursor.sourceContext === undefined
      ? {}
      : { sourceContext: cursor.sourceContext }),
    ...(cursor.triplePattern === undefined
      ? {}
      : { triplePattern: cursor.triplePattern }),
    ...(cursor.types === null
      ? {}
      : { types: cursor.types as NonNullable<ArchiveFindOptions["types"]> }),
    ...(!hasEmbedding
      ? {}
      : {
          embeddingProvider: buildSearchIndexEmbeddingProvider(embedding),
        }),
  };
}

function requireLibraryQuery(
  cursor: ContinuationCursor,
): "archive-members" | "objects" {
  if (
    (cursor.kind === "collection" || cursor.kind === "search") &&
    cursor.libraryQuery !== undefined
  ) {
    return cursor.libraryQuery;
  }
  throw new Error(
    "Library continuation cursor is missing its typed query variant.",
  );
}

function getCursorArchivePath(cursor: ContinuationCursor): string {
  return cursor.indexScope.kind === "archive-index"
    ? cursor.indexScope.archivePath
    : cursor.archivePath;
}

async function persistResultCursor<
  T extends { readonly nextCursor: string | null },
>(cursor: ContinuationCursor, result: T): Promise<T> {
  if (result.nextCursor === null) return result;
  const nextCursor = await createContinuationCursor({
    ...cursor,
    cursor: result.nextCursor,
  });
  return { ...result, nextCursor };
}

function createContinuationPayload(
  context: WikiGraphContinuationContext,
  cursor: string,
): ContinuationCursor {
  switch (context.continuationKind ?? "search") {
    case "source-locators":
      return {
        archiveKey: context.archiveKey,
        archivePath: context.archivePath,
        cursor,
        format: context.format,
        indexScope: context.indexScope,
        kind: "source-locators",
        targetUri: requireTargetUri(context, "Source locator"),
      };
    case "evidence":
      return {
        archiveKey: context.archiveKey,
        archivePath: context.archivePath,
        cursor,
        format: context.format,
        indexScope: context.indexScope,
        kind: "evidence",
        order: context.order ?? "doc-asc",
        ...(context.query === undefined ? {} : { query: context.query }),
        ...(context.skipUnindexed === undefined
          ? {}
          : { skipUnindexed: context.skipUnindexed }),
        ...(context.sourceContext === undefined
          ? {}
          : { sourceContext: context.sourceContext }),
        targetUri: requireTargetUri(context, "Evidence"),
      };
    case "related":
      return {
        archiveKey: context.archiveKey,
        archivePath: context.archivePath,
        cursor,
        ...(context.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: context.evidenceLimit }),
        format: context.format,
        indexScope: context.indexScope,
        kind: "related",
        order: context.order ?? "doc-asc",
        ...(context.query === undefined ? {} : { query: context.query }),
        ...(context.role === undefined ? {} : { role: context.role }),
        ...(context.skipUnindexed === undefined
          ? {}
          : { skipUnindexed: context.skipUnindexed }),
        ...(context.sourceContext === undefined
          ? {}
          : { sourceContext: context.sourceContext }),
        targetUri: requireTargetUri(context, "Related"),
      };
    case "collection":
      return {
        archiveKey: context.archiveKey,
        archivePath: context.archivePath,
        ...(context.backlinks === undefined
          ? {}
          : { backlinks: context.backlinks }),
        chapters: context.chapters ?? null,
        cursor,
        ...(context.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: context.evidenceLimit }),
        format: context.format,
        ids: context.ids ?? null,
        indexScope: context.indexScope,
        kind: "collection",
        ...createLibraryQueryPayload(context),
        order: context.order ?? "doc-asc",
        ...(context.sourceContext === undefined
          ? {}
          : { sourceContext: context.sourceContext }),
        ...(context.triplePattern === undefined
          ? {}
          : { triplePattern: context.triplePattern }),
        types: context.types,
      };
    case "search":
      return {
        archiveKey: context.archiveKey,
        archivePath: context.archivePath,
        ...(context.backlinks === undefined
          ? {}
          : { backlinks: context.backlinks }),
        ...(context.chapters === undefined
          ? {}
          : { chapters: context.chapters }),
        cursor,
        ...(context.evidenceLimit === undefined
          ? {}
          : { evidenceLimit: context.evidenceLimit }),
        format: context.format,
        indexScope: context.indexScope,
        kind: "search",
        ...createLibraryQueryPayload(context),
        ...(context.query === undefined ? {} : { query: context.query }),
        ...(context.skipUnindexed === undefined
          ? {}
          : { skipUnindexed: context.skipUnindexed }),
        ...(context.sourceContext === undefined
          ? {}
          : { sourceContext: context.sourceContext }),
        ...(context.triplePattern === undefined
          ? {}
          : { triplePattern: context.triplePattern }),
        types: context.types,
      };
  }
}

function requireTargetUri(
  context: WikiGraphContinuationContext,
  label: string,
): string {
  if (context.targetUri !== undefined) return context.targetUri;
  throw new Error(`${label} continuation cursors require a target URI.`);
}

function createLibraryQueryPayload(context: WikiGraphContinuationContext): {
  readonly libraryQuery?: "archive-members" | "objects";
} {
  if (context.indexScope.kind !== "library-index") return {};
  if (context.libraryQuery !== undefined) {
    return { libraryQuery: context.libraryQuery };
  }
  throw new Error(
    "Library collection and search continuations require an explicit query variant.",
  );
}
