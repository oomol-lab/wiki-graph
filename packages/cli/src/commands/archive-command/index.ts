import {
  listArchiveCollection,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  findWikiGraphLibraryObjects,
  formatWikiGraphLibraryUri,
  isArchiveSearchIndexCurrent,
  listRelatedWikiGraphLibraryObjects,
  listWikiGraphLibraryEvidence,
  listWikiGraphLibraryObjects,
  packArchiveContext,
  packWikiGraphLibraryContext,
  parseWikiGraphLibraryUri,
  readArchivePage,
  readWikiGraphLibraryPage,
  resolveWikiGraphLibrary,
  findArchiveObjects,
  listArchiveQueryableChapterIds,
  listArchiveSourceLocators,
  isSourceLocatorScopeUri,
  rebuildArchiveSearchIndex,
  openWikimediaResolver,
  WikiGraphArchiveFile,
  type ArchiveFindOptions,
  type ArchiveRelatedResult,
  type ReadonlyDocument,
  type WikimediaResolver,
} from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../args/index.js";
import { loadCLIConfig } from "../../runtime/config.js";
import { buildSearchIndexEmbeddingProvider } from "../../runtime/embedding.js";
import { formatCliCommand } from "../../support/index.js";
import { runConvertCommand } from "../convert.js";
import { createArchive } from "./create.js";
import { writeArchiveInspectReport } from "./inspect.js";
import {
  writeAllEvidence,
  writeAllFindHits,
  writeAllRelatedItems,
  writeEvidence,
  writeFindHits,
  writeFindHitsWithoutContinuation,
  writeList,
  writePack,
  writePage,
  writeAllSourceLocators,
  writeSourceLocators,
} from "../archive-output/index.js";
import {
  ALL_COLLECTION_OUTPUT_LIMIT,
  createArchiveOutputContext,
  createCollectionFindResult,
  createCollectionOptions,
  createFindOptions,
  createOptionalEvidenceLimit,
  createOptionalSourceContext,
  getArchivePath,
  getObjectUri,
  getSingleObjectEvidenceLimit,
  isArchiveRootGet,
  readArchiveDocument,
  resolveArchiveCommandRuntimeArguments,
  resolveArchiveRuntimeLocation,
  runNextArchivePage,
  writeArchiveRoot,
} from "./run/index.js";
import { resolveArchiveChapterScope } from "./run/scope.js";
import type { ChapterScopeResolution } from "./run/scope.js";

export async function runArchiveCommand(
  args: CLIArchiveArguments,
): Promise<void> {
  const libraryTarget = parseWikiGraphLibraryUri(args.archivePath);
  if (
    libraryTarget?.kind === "scope" &&
    libraryTarget.objectUri !== "wikg://index" &&
    (libraryTarget.objectUri !== undefined ||
      args.action === "related" ||
      args.action === "evidence" ||
      args.action === "pack" ||
      args.action === "search" ||
      args.action === "list")
  ) {
    await runLibraryIndexArchiveCommand(args, libraryTarget);
    return;
  }

  args = await resolveArchiveCommandRuntimeArguments(args);

  switch (args.action) {
    case "create":
      await createArchive(args);
      return;
    case "export":
      if (args.outputFormat === undefined) {
        throw new Error("Internal error: missing export output format.");
      }
      await runConvertCommand({
        help: false,
        inputFormat: "wikg",
        inputPath: args.archivePath,
        ...(args.outputPath === undefined
          ? {}
          : { outputPath: args.outputPath }),
        outputFormat: args.outputFormat,
        verbose: false,
      });
      return;
    case "inspect":
      await readArchiveDocument(
        (await resolveArchiveRuntimeLocation(args.archivePath)).archivePath,
        async (document) => {
          await writeArchiveInspectReport(document, args);
        },
      );
      return;
    case "search":
      await ensureArchiveQueryIndexCache(args);
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          const scopedArgs = await createScopedQueryArgs(document, args);
          const context = createArchiveOutputContext(scopedArgs);
          const findOptions = await createSearchFindOptions(scopedArgs);

          if (args.all === true) {
            await writeAllFindHits(
              async (cursor) =>
                await findArchiveObjects(document, scopedArgs.query!, {
                  ...findOptions,
                  ...(cursor === undefined ? {} : { cursor }),
                }),
              context,
              args.format ?? "text",
            );
            return;
          }

          await writeFindHits(
            await findArchiveObjects(document, scopedArgs.query!, findOptions),
            context,
            args.format ?? "text",
          );
        },
      );
      return;
    case "list":
      if (args.query !== undefined) {
        await ensureArchiveQueryIndexCache(args);
      }
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          const objectUri = getObjectUri(args.archivePath);
          if (isSourceLocatorScopeUri(objectUri)) {
            const context = createArchiveOutputContext(args, {
              continuationKind: "source-locators",
              targetUri: objectUri,
            });
            const readPage = async (cursor: string | undefined) =>
              await listArchiveSourceLocators(document, objectUri, {
                ...(cursor === undefined ? {} : { cursor }),
                ...(args.limit === undefined ? {} : { limit: args.limit }),
              });

            if (args.all === true) {
              await writeAllSourceLocators(
                readPage,
                args.cursor,
                context,
                args.format ?? "text",
              );
              return;
            }

            await writeSourceLocators(
              await readPage(args.cursor),
              context,
              args.format ?? "text",
            );
            return;
          }

          const scope = await resolveArchiveChapterScope(document, args);
          const scopedArgs =
            scope === undefined
              ? args
              : { ...args, chapters: scope.chapterIds };
          const context = createArchiveOutputContext(scopedArgs, {
            continuationKind: "collection",
          });

          if (args.all === true) {
            if (args.limit !== undefined) {
              await writeAllFindHits(
                async (cursor) =>
                  createCollectionFindResult(
                    await listArchiveCollection(document, {
                      ...createCollectionOptions(scopedArgs),
                      ...(cursor === undefined ? {} : { cursor }),
                    }),
                  ),
                context,
                args.format ?? "text",
              );
              return;
            }

            await writeFindHitsWithoutContinuation(
              createCollectionFindResult(
                await listArchiveCollection(document, {
                  ...createCollectionOptions(scopedArgs),
                  limit: ALL_COLLECTION_OUTPUT_LIMIT,
                }),
              ),
              context,
              args.format ?? "text",
            );
            return;
          }

          await writeFindHits(
            createCollectionFindResult(
              await listArchiveCollection(
                document,
                createCollectionOptions(scopedArgs),
              ),
            ),
            context,
            args.format ?? "text",
          );
        },
      );
      return;
    case "get":
      if (isArchiveRootGet(args)) {
        await writeArchiveRoot(args);
        return;
      }
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          const objectUri = getObjectUri(args.objectId!);
          const evidenceLimit = getSingleObjectEvidenceLimit(args, objectUri);
          const outputContext =
            evidenceLimit === undefined
              ? createArchiveOutputContext(args)
              : createArchiveOutputContext({ ...args, evidenceLimit });

          await withWikimediaPageOptions(objectUri, async (wikimediaOptions) =>
            writePage(
              await readArchivePage(document, objectUri, {
                ...(args.backlinks === undefined
                  ? {}
                  : { backlinks: args.backlinks }),
                ...(evidenceLimit === undefined ? {} : { evidenceLimit }),
                ...(args.reverse === true ? { order: "doc-desc" } : {}),
                ...wikimediaOptions,
                ...createOptionalSourceContext(args),
              }),
              outputContext,
              args.format ?? "text",
            ),
          );
        },
      );
      return;
    case "related":
      if (args.query !== undefined) {
        await ensureArchiveQueryIndexCache(args);
      }
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          const context = createArchiveOutputContext(args, {
            continuationKind: "related",
            targetUri: getObjectUri(args.objectId!),
          });
          const readPage = async (
            cursor: string | undefined,
          ): Promise<ArchiveRelatedResult> =>
            await listRelatedArchiveObjects(
              document,
              getObjectUri(args.objectId!),
              {
                ...(cursor === undefined ? {} : { cursor }),
                ...createOptionalEvidenceLimit(args),
                ...(args.limit === undefined ? {} : { limit: args.limit }),
                ...(args.reverse === true ? { order: "doc-desc" } : {}),
                ...(args.query === undefined ? {} : { query: args.query }),
                ...(args.role === undefined ? {} : { role: args.role }),
                ...(args.skipUnindexed === true ? { skipUnindexed: true } : {}),
                ...createOptionalSourceContext(args),
              },
            );

          if (args.all === true) {
            await writeAllRelatedItems(
              readPage,
              args.cursor,
              context,
              args.format ?? "text",
            );
            return;
          }

          await writeList(
            await readPage(args.cursor),
            context,
            args.format ?? "text",
          );
        },
      );
      return;
    case "evidence":
      if (args.query !== undefined) {
        await ensureArchiveQueryIndexCache(args);
      }
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          const context = createArchiveOutputContext(args, {
            continuationKind: "evidence",
            targetUri: getObjectUri(args.objectId!),
          });

          if (args.all === true) {
            await writeAllEvidence(
              async (cursor) =>
                await listArchiveEvidence(
                  document,
                  getObjectUri(args.objectId!),
                  {
                    ...(cursor === undefined ? {} : { cursor }),
                    ...(args.limit === undefined ? {} : { limit: args.limit }),
                    ...(args.reverse === true ? { order: "doc-desc" } : {}),
                    ...(args.query === undefined ? {} : { query: args.query }),
                    ...(args.skipUnindexed === true
                      ? { skipUnindexed: true }
                      : {}),
                    ...createOptionalSourceContext(args),
                  },
                ),
              args.cursor,
              context,
              args.format ?? "text",
            );
            return;
          }

          await writeEvidence(
            await listArchiveEvidence(document, getObjectUri(args.objectId!), {
              ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
              ...(args.limit === undefined ? {} : { limit: args.limit }),
              ...(args.reverse === true ? { order: "doc-desc" } : {}),
              ...(args.query === undefined ? {} : { query: args.query }),
              ...(args.skipUnindexed === true ? { skipUnindexed: true } : {}),
              ...createOptionalSourceContext(args),
            }),
            context,
            args.format ?? "text",
          );
        },
      );
      return;
    case "next":
      await runNextArchivePage(args);
      return;
    case "pack":
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          await writePack(
            await packArchiveContext(
              document,
              getObjectUri(args.objectId!),
              args.budget ?? 5000,
            ),
            createArchiveOutputContext(args),
            args.format ?? "text",
          );
        },
      );
      return;
  }
}

async function ensureArchiveQueryIndexCache(
  args: CLIArchiveArguments,
): Promise<void> {
  const location = await resolveArchiveRuntimeLocation(args.archivePath);

  await new WikiGraphArchiveFile(location.archiveFile).write(
    async (document) => {
      const scopedArgs = await createScopedQueryArgs(document, args);
      const options =
        scopedArgs.chapters === undefined
          ? {}
          : { chapters: scopedArgs.chapters };

      if (await isArchiveSearchIndexCurrent(document, options)) {
        return;
      }

      try {
        await rebuildArchiveSearchIndex(document, undefined, options);
      } catch (error) {
        if (isArchiveQueryNotReadyError(error)) {
          throw createArchiveQueryNotReadyError(args, error.message);
        }
        throw error;
      }
    },
    { searchIndexWritebackPolicy: "cache" },
  );
}

async function createScopedQueryArgs(
  document: ReadonlyDocument,
  args: CLIArchiveArguments,
): Promise<CLIArchiveArguments> {
  const scope = await resolveArchiveChapterScope(document, args);
  if (args.skipUnindexed !== true) {
    return applyChapterScope(args, scope);
  }

  const queryableChapters = await listArchiveQueryableChapterIds(document, {
    ...(scope === undefined ? {} : { chapters: scope.chapterIds }),
  });

  if (queryableChapters.length === 0) {
    throw createArchiveQueryNotReadyError(
      args,
      "Wiki Graph query is not ready. No chapters in this scope have a current FTS artifact or source embedding artifact.",
    );
  }

  return { ...args, chapters: queryableChapters };
}

function createArchiveQueryNotReadyError(
  args: Pick<CLIArchiveArguments, "archivePath">,
  reason: string,
): Error {
  const buildCommand = formatCliCommand([
    "wikg://local/job",
    "add",
    "--input",
    args.archivePath,
    "--task",
    "index-fts",
  ]);

  return new Error(
    [
      reason,
      "",
      "Build local FTS artifacts without provider calls:",
      `  ${buildCommand}`,
      "",
      "Help:",
      "  wg help readiness",
    ].join("\n"),
  );
}

function isArchiveQueryNotReadyError(error: unknown): error is Error {
  return error instanceof Error && error.name === "ArchiveQueryNotReadyError";
}

function applyChapterScope(
  args: CLIArchiveArguments,
  scope: ChapterScopeResolution | undefined,
): CLIArchiveArguments {
  return scope === undefined ? args : { ...args, chapters: scope.chapterIds };
}

async function runLibraryIndexArchiveCommand(
  args: CLIArchiveArguments,
  target: NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>,
): Promise<void> {
  const library = await resolveWikiGraphLibrary(target);
  const isLibraryRootCollection =
    target.objectUri === undefined && args.objectId === undefined;
  const objectUri = isLibraryRootCollection
    ? undefined
    : getObjectUri(args.objectId ?? args.archivePath);
  const context = {
    ...createArchiveOutputContext(args),
    archiveKey: isLibraryRootCollection
      ? `${formatWikiGraphLibraryUri(target.publicId)}#scope`
      : args.archivePath,
    archivePath: args.archivePath,
    indexScope: { kind: "library-index" as const, libraryId: library.id },
  };

  switch (args.action) {
    case "search": {
      const findOptions = await createSearchFindOptions(args);
      if (objectUri === undefined) {
        if (args.all === true) {
          await writeAllFindHits(
            async (cursor) =>
              await findWikiGraphLibraryObjects(target, args.query!, {
                ...findOptions,
                ...(cursor === undefined ? {} : { cursor }),
              }),
            context,
            args.format ?? "text",
          );
          return;
        }
        await writeFindHits(
          await findWikiGraphLibraryObjects(target, args.query!, findOptions),
          context,
          args.format ?? "text",
        );
        return;
      }
      if (args.all === true) {
        await writeAllFindHits(
          async (cursor) =>
            await findWikiGraphLibraryObjects(target, args.query!, {
              ...findOptions,
              ...(cursor === undefined ? {} : { cursor }),
            }),
          context,
          args.format ?? "text",
        );
        return;
      }

      await writeFindHits(
        await findWikiGraphLibraryObjects(target, args.query!, findOptions),
        context,
        args.format ?? "text",
      );
      return;
    }
    case "list": {
      const listContext = {
        ...context,
        continuationKind: "collection" as const,
      };
      if (objectUri === undefined) {
        if (args.all === true) {
          if (args.limit !== undefined) {
            await writeAllFindHits(
              async (cursor) =>
                createCollectionFindResult(
                  await listWikiGraphLibraryObjects(target, {
                    ...createCollectionOptions(args),
                    ...(cursor === undefined ? {} : { cursor }),
                  }),
                ),
              listContext,
              args.format ?? "text",
            );
            return;
          }

          await writeFindHitsWithoutContinuation(
            createCollectionFindResult(
              await listWikiGraphLibraryObjects(target, {
                ...createCollectionOptions(args),
                limit: ALL_COLLECTION_OUTPUT_LIMIT,
              }),
            ),
            listContext,
            args.format ?? "text",
          );
          return;
        }
        await writeFindHits(
          createCollectionFindResult(
            await listWikiGraphLibraryObjects(
              target,
              createCollectionOptions(args),
            ),
          ),
          listContext,
          args.format ?? "text",
        );
        return;
      }
      if (args.all === true) {
        if (args.limit !== undefined) {
          await writeAllFindHits(
            async (cursor) =>
              createCollectionFindResult(
                await listWikiGraphLibraryObjects(target, {
                  ...createCollectionOptions(args),
                  ...(cursor === undefined ? {} : { cursor }),
                }),
              ),
            listContext,
            args.format ?? "text",
          );
          return;
        }

        await writeFindHitsWithoutContinuation(
          createCollectionFindResult(
            await listWikiGraphLibraryObjects(target, {
              ...createCollectionOptions(args),
              limit: ALL_COLLECTION_OUTPUT_LIMIT,
            }),
          ),
          listContext,
          args.format ?? "text",
        );
        return;
      }

      await writeFindHits(
        createCollectionFindResult(
          await listWikiGraphLibraryObjects(
            target,
            createCollectionOptions(args),
          ),
        ),
        listContext,
        args.format ?? "text",
      );
      return;
    }
    case "get": {
      if (objectUri === undefined) {
        const getContext = {
          ...context,
          continuationKind: "collection" as const,
        };
        await writeFindHits(
          createCollectionFindResult(
            await listWikiGraphLibraryObjects(
              target,
              createCollectionOptions(args),
            ),
          ),
          getContext,
          args.format ?? "text",
        );
        return;
      }

      const evidenceLimit = getSingleObjectEvidenceLimit(args, objectUri);
      await withWikimediaPageOptions(objectUri, async (wikimediaOptions) =>
        writePage(
          await readWikiGraphLibraryPage(target, objectUri, {
            ...(args.backlinks === undefined
              ? {}
              : { backlinks: args.backlinks }),
            ...(evidenceLimit === undefined ? {} : { evidenceLimit }),
            ...(args.reverse === true ? { order: "doc-desc" } : {}),
            ...wikimediaOptions,
            ...createOptionalSourceContext(args),
          }),
          evidenceLimit === undefined ? context : { ...context, evidenceLimit },
          args.format ?? "text",
        ),
      );
      return;
    }
    case "related": {
      const concreteObjectUri = requireLibraryObjectUri("related", objectUri);
      const relatedContext = {
        ...context,
        continuationKind: "related" as const,
        targetUri: concreteObjectUri,
      };
      const readPage = async (
        cursor: string | undefined,
      ): Promise<ArchiveRelatedResult> =>
        await listRelatedWikiGraphLibraryObjects(target, concreteObjectUri, {
          ...(cursor === undefined ? {} : { cursor }),
          ...createOptionalEvidenceLimit(args),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.reverse === true ? { order: "doc-desc" } : {}),
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.role === undefined ? {} : { role: args.role }),
          ...(args.skipUnindexed === true ? { skipUnindexed: true } : {}),
          ...createOptionalSourceContext(args),
        });

      if (args.all === true) {
        await writeAllRelatedItems(
          readPage,
          args.cursor,
          relatedContext,
          args.format ?? "text",
        );
        return;
      }

      await writeList(
        await readPage(args.cursor),
        relatedContext,
        args.format ?? "text",
      );
      return;
    }
    case "evidence": {
      const concreteObjectUri = requireLibraryObjectUri("evidence", objectUri);
      const evidenceContext = {
        ...context,
        continuationKind: "evidence" as const,
        targetUri: concreteObjectUri,
      };

      if (args.all === true) {
        await writeAllEvidence(
          async (cursor) =>
            await listWikiGraphLibraryEvidence(target, concreteObjectUri, {
              ...(cursor === undefined ? {} : { cursor }),
              ...(args.limit === undefined ? {} : { limit: args.limit }),
              ...(args.reverse === true ? { order: "doc-desc" } : {}),
              ...(args.query === undefined ? {} : { query: args.query }),
              ...(args.skipUnindexed === true ? { skipUnindexed: true } : {}),
              ...createOptionalSourceContext(args),
            }),
          args.cursor,
          evidenceContext,
          args.format ?? "text",
        );
        return;
      }

      await writeEvidence(
        await listWikiGraphLibraryEvidence(target, concreteObjectUri, {
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.reverse === true ? { order: "doc-desc" } : {}),
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.skipUnindexed === true ? { skipUnindexed: true } : {}),
          ...createOptionalSourceContext(args),
        }),
        evidenceContext,
        args.format ?? "text",
      );
      return;
    }
    case "pack": {
      const concreteObjectUri = requireLibraryObjectUri("pack", objectUri);
      await writePack(
        await packWikiGraphLibraryContext(
          target,
          concreteObjectUri,
          args.budget ?? 5000,
        ),
        context,
        args.format ?? "text",
      );
      return;
    }
    case "create":
    case "export":
    case "inspect":
    case "next":
      throw new Error(
        `The library index scope does not support \`${args.action}\`.`,
      );
  }
}

async function createSearchFindOptions(
  args: CLIArchiveArguments,
): Promise<ArchiveFindOptions> {
  const options = createFindOptions(args);
  const config = await loadCLIConfig();

  return {
    ...options,
    ...(config.embedding === undefined
      ? {}
      : {
          embeddingProvider: buildSearchIndexEmbeddingProvider(
            config.embedding,
          ),
        }),
  };
}

async function withWikimediaPageOptions<T>(
  objectUri: string,
  operation: (
    options:
      | Record<string, never>
      | { readonly wikimediaResolver: WikimediaResolver },
  ) => Promise<T>,
): Promise<T> {
  if (!objectUri.endsWith("/wikipage")) {
    return await operation({});
  }

  const config = await loadCLIConfig();
  const resolver = await openWikimediaResolver(
    config.wikimedia === undefined
      ? { kind: "local" }
      : {
          endpoint: config.wikimedia.endpoint,
          kind: "remote",
          token: config.wikimedia.token,
        },
  );
  try {
    return await operation({ wikimediaResolver: resolver });
  } finally {
    await resolver.close();
  }
}

function requireLibraryObjectUri(
  action: "related" | "evidence" | "pack",
  objectUri: string | undefined,
): string {
  if (objectUri === undefined) {
    throw new Error(
      `The library \`${action}\` predicate requires a concrete library object URI.`,
    );
  }

  return objectUri;
}
