import {
  findArchiveObjects,
  findWikiGraphLibraryArchiveMembers,
  findWikiGraphLibraryObjects,
  listArchiveCollection,
  listArchiveEvidence,
  listArchiveSourceLocators,
  listWikiGraphLibraryArchiveMembers,
  listRelatedWikiGraphLibraryObjects,
  listWikiGraphLibraryEvidence,
  listWikiGraphLibraryObjects,
  listRelatedArchiveObjects,
  parseWikiGraphLibraryUri,
  readContinuationCursor,
  resolveWikiGraphLibraryQueryTargetById,
  type ArchiveCollectionOptions,
  type ArchiveFindOptions,
} from "wiki-graph-sdk";

import type { CLIArchiveArguments } from "../../../args/index.js";
import { loadCLIConfig } from "../../../runtime/config.js";
import { buildSearchIndexEmbeddingProvider } from "../../../runtime/embedding.js";
import {
  writeEvidence,
  writeFindHits,
  writeList,
  writeSourceLocators,
} from "../../archive-output/index.js";
import { readArchiveDocument } from "./document.js";
import { createCollectionFindResult } from "./options.js";
import { DEFAULT_OUTPUT_LIMIT } from "./types.js";
import { resolveArchiveRuntimeLocation } from "./uri.js";

export async function runNextArchivePage(
  args: CLIArchiveArguments,
): Promise<void> {
  const cursorId = args.cursor ?? args.archivePath;
  const explicitArchivePath =
    args.cursor === undefined ? undefined : args.archivePath;
  const cursor = await readContinuationCursor(cursorId);

  if (explicitArchivePath !== undefined) {
    const { archivePath } =
      await resolveArchiveRuntimeLocation(explicitArchivePath);
    const cursorArchivePath = getCursorArchivePath(cursor);

    if (archivePath !== cursorArchivePath) {
      throw new Error(
        `Continuation cursor ${cursorId} belongs to ${cursorArchivePath}, not ${archivePath}.`,
      );
    }
  }

  if (cursor.kind === "source-locators") {
    await readArchiveDocument(
      getCursorArchivePath(cursor),
      async (document) => {
        const format = args.format ?? cursor.format;
        const limit = args.limit ?? DEFAULT_OUTPUT_LIMIT;
        await writeSourceLocators(
          await listArchiveSourceLocators(document, cursor.targetUri, {
            cursor: cursor.cursor,
            limit,
          }),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            continuationKind: "source-locators",
            format,
            indexScope: cursor.indexScope,
            limit,
            targetUri: cursor.targetUri,
            types: null,
          },
          format,
        );
      },
    );
    return;
  }

  if (cursor.indexScope?.kind === "library-index") {
    await runNextLibraryIndexPage(args, cursor);
    return;
  }

  await readArchiveDocument(getCursorArchivePath(cursor), async (document) => {
    const format = args.format ?? cursor.format;
    const limit = args.limit ?? DEFAULT_OUTPUT_LIMIT;

    switch (cursor.kind) {
      case "collection": {
        const collectionOptions: ArchiveCollectionOptions = {
          ...(cursor.backlinks === undefined
            ? {}
            : { backlinks: cursor.backlinks }),
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
        };

        if (cursor.types !== null) {
          Object.assign(collectionOptions, {
            types: cursor.types as ArchiveCollectionOptions["types"],
          });
        }

        await writeFindHits(
          createCollectionFindResult(
            await listArchiveCollection(document, collectionOptions),
          ),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            ...(cursor.backlinks === undefined
              ? {}
              : { backlinks: cursor.backlinks }),
            ...(cursor.chapters === null ? {} : { chapters: cursor.chapters }),
            continuationKind: "collection",
            ...(cursor.evidenceLimit === undefined
              ? {}
              : { evidenceLimit: cursor.evidenceLimit }),
            format,
            indexScope: cursor.indexScope,
            ...(cursor.ids === null ? {} : { ids: cursor.ids }),
            limit,
            order: cursor.order,
            ...(cursor.sourceContext === undefined
              ? {}
              : { sourceContext: cursor.sourceContext }),
            ...(cursor.triplePattern === undefined
              ? {}
              : { triplePattern: cursor.triplePattern }),
            types: cursor.types,
          },
          format,
        );
        return;
      }
      case "search": {
        const findOptions: ArchiveFindOptions = {
          archiveKey: cursor.archiveKey,
          ...(cursor.backlinks === undefined
            ? {}
            : { backlinks: cursor.backlinks }),
          ...(cursor.chapters === null ? {} : { chapters: cursor.chapters }),
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
        };

        if (cursor.types !== null) {
          Object.assign(findOptions, {
            types: cursor.types as ArchiveFindOptions["types"],
          });
        }
        await addSearchIndexEmbeddingProvider(findOptions);

        await writeFindHits(
          await findArchiveObjects(document, cursor.query ?? "", findOptions),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            ...(cursor.backlinks === undefined
              ? {}
              : { backlinks: cursor.backlinks }),
            ...(cursor.chapters === null ? {} : { chapters: cursor.chapters }),
            ...(cursor.evidenceLimit === undefined
              ? {}
              : { evidenceLimit: cursor.evidenceLimit }),
            format,
            indexScope: cursor.indexScope,
            limit,
            ...(cursor.sourceContext === undefined
              ? {}
              : { sourceContext: cursor.sourceContext }),
            ...(cursor.skipUnindexed === undefined
              ? {}
              : { skipUnindexed: cursor.skipUnindexed }),
            ...(cursor.triplePattern === undefined
              ? {}
              : { triplePattern: cursor.triplePattern }),
            types: cursor.types,
          },
          format,
        );
        return;
      }
      case "evidence":
        await writeEvidence(
          await listArchiveEvidence(document, cursor.targetUri, {
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
          }),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            continuationKind: "evidence",
            format,
            indexScope: cursor.indexScope,
            limit,
            order: cursor.order,
            ...(cursor.query === undefined ? {} : { query: cursor.query }),
            ...(cursor.skipUnindexed === undefined
              ? {}
              : { skipUnindexed: cursor.skipUnindexed }),
            ...(cursor.sourceContext === undefined
              ? {}
              : { sourceContext: cursor.sourceContext }),
            targetUri: cursor.targetUri,
            types: null,
          },
          format,
        );
        return;
      case "related":
        await writeList(
          await listRelatedArchiveObjects(document, cursor.targetUri, {
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
          }),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            continuationKind: "related",
            ...(cursor.evidenceLimit === undefined
              ? {}
              : { evidenceLimit: cursor.evidenceLimit }),
            format,
            indexScope: cursor.indexScope,
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
            targetUri: cursor.targetUri,
            types: null,
          },
          format,
        );
        return;
    }
  });
}

async function runNextLibraryIndexPage(
  args: CLIArchiveArguments,
  cursor: Awaited<ReturnType<typeof readContinuationCursor>>,
): Promise<void> {
  if (cursor.indexScope.kind !== "library-index") {
    throw new Error("Internal error: expected a library index cursor.");
  }

  const target = await resolveWikiGraphLibraryQueryTargetById(
    cursor.indexScope.libraryId,
  );
  const format = args.format ?? cursor.format;
  const limit = args.limit ?? DEFAULT_OUTPUT_LIMIT;

  switch (cursor.kind) {
    case "source-locators":
      throw new Error(
        "Source locator cursors do not use the aggregate library index.",
      );
    case "collection": {
      const collectionOptions: ArchiveCollectionOptions = {
        ...(cursor.backlinks === undefined
          ? {}
          : { backlinks: cursor.backlinks }),
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
      };

      if (cursor.types !== null) {
        Object.assign(collectionOptions, {
          types: cursor.types as ArchiveCollectionOptions["types"],
        });
      }

      if (isLibraryArchiveMemberCursor(cursor)) {
        await writeFindHits(
          createCollectionFindResult(
            await listWikiGraphLibraryArchiveMembers(target, collectionOptions),
          ),
          {
            ...createCursorOutputContext(cursor, format, limit),
            continuationKind: "collection",
          },
          format,
        );
        return;
      }

      await writeFindHits(
        createCollectionFindResult(
          await listWikiGraphLibraryObjects(target, collectionOptions),
        ),
        {
          ...createCursorOutputContext(cursor, format, limit),
          continuationKind: "collection",
        },
        format,
      );
      return;
    }
    case "search": {
      const findOptions: ArchiveFindOptions = {
        archiveKey: cursor.archiveKey,
        ...(cursor.backlinks === undefined
          ? {}
          : { backlinks: cursor.backlinks }),
        ...(cursor.chapters === null ? {} : { chapters: cursor.chapters }),
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
      };

      if (cursor.types !== null) {
        Object.assign(findOptions, {
          types: cursor.types as ArchiveFindOptions["types"],
        });
      }
      await addSearchIndexEmbeddingProvider(findOptions);

      if (isLibraryArchiveMemberCursor(cursor)) {
        await writeFindHits(
          await findWikiGraphLibraryArchiveMembers(
            target,
            cursor.query ?? "",
            findOptions,
          ),
          createCursorOutputContext(cursor, format, limit),
          format,
        );
        return;
      }

      await writeFindHits(
        await findWikiGraphLibraryObjects(
          target,
          cursor.query ?? "",
          findOptions,
        ),
        createCursorOutputContext(cursor, format, limit),
        format,
      );
      return;
    }
    case "evidence":
      await writeEvidence(
        await listWikiGraphLibraryEvidence(target, cursor.targetUri, {
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
        }),
        {
          ...createCursorOutputContext(cursor, format, limit),
          continuationKind: "evidence",
          order: cursor.order,
          ...(cursor.query === undefined ? {} : { query: cursor.query }),
          ...(cursor.skipUnindexed === undefined
            ? {}
            : { skipUnindexed: cursor.skipUnindexed }),
          targetUri: cursor.targetUri,
        },
        format,
      );
      return;
    case "related":
      await writeList(
        await listRelatedWikiGraphLibraryObjects(target, cursor.targetUri, {
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
        }),
        {
          ...createCursorOutputContext(cursor, format, limit),
          continuationKind: "related",
          ...(cursor.evidenceLimit === undefined
            ? {}
            : { evidenceLimit: cursor.evidenceLimit }),
          order: cursor.order,
          ...(cursor.query === undefined ? {} : { query: cursor.query }),
          ...(cursor.role === undefined ? {} : { role: cursor.role }),
          ...(cursor.skipUnindexed === undefined
            ? {}
            : { skipUnindexed: cursor.skipUnindexed }),
          targetUri: cursor.targetUri,
        },
        format,
      );
      return;
  }
}

async function addSearchIndexEmbeddingProvider(
  options: ArchiveFindOptions,
): Promise<void> {
  const config = await loadCLIConfig();

  if (config.embedding === undefined) {
    return;
  }
  Object.assign(options, {
    embeddingProvider: buildSearchIndexEmbeddingProvider(config.embedding),
  });
}

function isLibraryArchiveMemberCursor(
  cursor: Awaited<ReturnType<typeof readContinuationCursor>>,
): boolean {
  const target = parseWikiGraphLibraryUri(cursor.archivePath);
  return (
    target?.kind === "scope" &&
    target.objectUri === undefined &&
    cursor.archiveKey === cursor.archivePath
  );
}

function createCursorOutputContext(
  cursor: Awaited<ReturnType<typeof readContinuationCursor>>,
  format: "json" | "jsonl" | "text",
  limit: number,
) {
  return {
    archiveKey: cursor.archiveKey,
    archivePath: cursor.archivePath,
    format,
    indexScope: cursor.indexScope,
    limit,
    types:
      cursor.kind === "evidence" ||
      cursor.kind === "related" ||
      cursor.kind === "source-locators"
        ? null
        : cursor.types,
    ...(cursor.kind === "search" || cursor.kind === "collection"
      ? cursor.backlinks === undefined
        ? {}
        : { backlinks: cursor.backlinks }
      : {}),
    ...(cursor.kind === "search" || cursor.kind === "collection"
      ? cursor.evidenceLimit === undefined
        ? {}
        : { evidenceLimit: cursor.evidenceLimit }
      : {}),
    ...(cursor.kind === "search" || cursor.kind === "collection"
      ? cursor.sourceContext === undefined
        ? {}
        : { sourceContext: cursor.sourceContext }
      : {}),
    ...(cursor.kind === "search"
      ? cursor.query === undefined
        ? {}
        : { query: cursor.query }
      : {}),
    ...(cursor.kind === "search" && cursor.skipUnindexed !== undefined
      ? { skipUnindexed: cursor.skipUnindexed }
      : {}),
  };
}

function getCursorArchivePath(
  cursor: Awaited<ReturnType<typeof readContinuationCursor>>,
): string {
  if (cursor.indexScope === undefined) {
    return cursor.archivePath;
  }
  if (cursor.indexScope.kind === "archive-index") {
    return cursor.indexScope.archivePath;
  }
  return cursor.archivePath;
}
