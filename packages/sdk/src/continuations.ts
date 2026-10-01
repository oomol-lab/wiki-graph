import {
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
  parseWikiGraphLibraryUri,
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
  readonly limit?: number;
  readonly signal?: AbortSignal;
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

  async #next(
    options: WikiGraphContinuationOptions,
  ): Promise<WikiGraphContinuationPage> {
    const cursor = await readContinuationCursor(options.cursor);
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
    return {
      cursor,
      format: cursor.format,
      kind: cursor.kind,
      limit,
      result,
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
      return await (isLibraryArchiveMemberCursor(cursor)
        ? listWikiGraphLibraryArchiveMembers(
            target,
            createCollectionOptions(cursor, limit),
          )
        : listWikiGraphLibraryObjects(
            target,
            createCollectionOptions(cursor, limit),
          ));
    case "search":
      return await (isLibraryArchiveMemberCursor(cursor)
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

function isLibraryArchiveMemberCursor(cursor: ContinuationCursor): boolean {
  const target = parseWikiGraphLibraryUri(cursor.archivePath);
  return (
    target?.kind === "scope" &&
    target.objectUri === undefined &&
    cursor.archiveKey === cursor.archivePath
  );
}

function getCursorArchivePath(cursor: ContinuationCursor): string {
  return cursor.indexScope.kind === "archive-index"
    ? cursor.indexScope.archivePath
    : cursor.archivePath;
}
