import {
  formatWikiGraphLibraryUri,
  parseWikiGraphLibraryUri,
  isSourceLocatorScopeUri,
  type ArchiveFindOptions,
  type ArchiveRelatedResult,
  type ArchiveCollectionResult,
  type ArchiveSourceLocatorResult,
} from "wiki-graph-sdk";

import type { CLIArchiveArguments } from "../../args/index.js";
import { getWikiGraphSDK } from "../../runtime/context.js";
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
  getObjectUri,
  getSingleObjectEvidenceLimit,
  isArchiveRootGet,
  resolveArchiveCommandRuntimeArguments,
  runNextArchivePage,
  writeArchiveRoot,
} from "./run/index.js";
import { parseCLIArchiveTarget } from "../../support/archive-target.js";

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

  args = resolveArchiveCommandRuntimeArguments(args);

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
      await writeArchiveInspectReport(args);
      return;
    case "search":
      await runArchiveSearch(args);
      return;
    case "list":
      await runArchiveList(args);
      return;
    case "get":
      if (isArchiveRootGet(args)) {
        await writeArchiveRoot(args);
        return;
      }
      await runArchiveGet(args);
      return;
    case "related":
      await runArchiveRelated(args);
      return;
    case "evidence":
      await runArchiveEvidence(args);
      return;
    case "next":
      await runNextArchivePage(args);
      return;
    case "pack":
      await writePack(
        await (
          await getWikiGraphSDK().archives.open(
            parseCLIArchiveTarget(args.archivePath),
          )
        ).pack(getObjectUri(args.objectId!), args.budget ?? 5000),
        createArchiveOutputContext(args),
        args.format ?? "text",
      );
      return;
  }
}

async function runArchiveList(args: CLIArchiveArguments): Promise<void> {
  const archive = await getWikiGraphSDK().archives.open(
    parseCLIArchiveTarget(args.archivePath),
  );
  const objectUri = getObjectUri(args.archivePath);
  if (isSourceLocatorScopeUri(objectUri)) {
    const context = createArchiveOutputContext(args, {
      continuationKind: "source-locators",
      targetUri: objectUri,
    });
    const readPage = async (
      cursor: string | undefined,
    ): Promise<ArchiveSourceLocatorResult> =>
      (await archive.list({
        ...(cursor === undefined ? {} : { cursor }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      })) as ArchiveSourceLocatorResult;
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
  const scope = await archive.resolveScope({
    ...(args.depth === undefined ? {} : { depth: args.depth }),
  });
  const scopedArgs =
    scope === undefined ? args : { ...args, chapters: scope.chapterIds };
  if (args.query !== undefined) {
    await archive.ensureSearchIndex({
      ...(scopedArgs.chapters === undefined
        ? {}
        : { chapters: scopedArgs.chapters }),
    });
  }
  const context = createArchiveOutputContext(scopedArgs, {
    continuationKind: "collection",
  });
  const readPage = async (
    cursor: string | undefined,
    limit = args.limit,
  ): Promise<ArchiveCollectionResult> =>
    (await archive.list({
      ...createCollectionOptions(scopedArgs),
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
    })) as ArchiveCollectionResult;
  if (args.all === true) {
    if (args.limit !== undefined) {
      await writeAllFindHits(
        async (cursor) => createCollectionFindResult(await readPage(cursor)),
        context,
        args.format ?? "text",
      );
      return;
    }
    await writeFindHitsWithoutContinuation(
      createCollectionFindResult(
        await readPage(undefined, ALL_COLLECTION_OUTPUT_LIMIT),
      ),
      context,
      args.format ?? "text",
    );
    return;
  }
  await writeFindHits(
    createCollectionFindResult(await readPage(args.cursor)),
    context,
    args.format ?? "text",
  );
}

async function runArchiveSearch(args: CLIArchiveArguments): Promise<void> {
  const archive = await getWikiGraphSDK().archives.open(
    parseCLIArchiveTarget(args.archivePath),
  );
  const scope = await archive.resolveScope({
    ...(args.depth === undefined ? {} : { depth: args.depth }),
  });
  const scopedArgs =
    scope === undefined ? args : { ...args, chapters: scope.chapterIds };
  const context = createArchiveOutputContext(scopedArgs);
  const findOptions = createSearchFindOptions(scopedArgs);
  const { archiveKey: _archiveKey, chapters, ...options } = findOptions;
  const readPage = async (cursor: string | undefined) =>
    await archive.search(scopedArgs.query!, {
      ...options,
      ...(chapters === undefined ? {} : { chapters }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  try {
    if (args.all === true) {
      await writeAllFindHits(readPage, context, args.format ?? "text");
      return;
    }
    await writeFindHits(
      await readPage(args.cursor),
      context,
      args.format ?? "text",
    );
  } catch (error) {
    if (isArchiveQueryNotReadyError(error)) {
      throw createArchiveQueryNotReadyError(args, error.message);
    }
    throw error;
  }
}

async function runArchiveGet(args: CLIArchiveArguments): Promise<void> {
  const objectUri = getObjectUri(args.objectId!);
  const evidenceLimit = getSingleObjectEvidenceLimit(args, objectUri);
  const context =
    evidenceLimit === undefined
      ? createArchiveOutputContext(args)
      : createArchiveOutputContext({ ...args, evidenceLimit });
  const archive = await getWikiGraphSDK().archives.open(
    parseCLIArchiveTarget(args.archivePath),
  );
  await writePage(
    await archive.page(objectUri, {
      ...(args.backlinks === undefined ? {} : { backlinks: args.backlinks }),
      ...(evidenceLimit === undefined ? {} : { evidenceLimit }),
      ...(args.reverse === true ? { order: "doc-desc" } : {}),
      ...createOptionalSourceContext(args),
    }),
    context,
    args.format ?? "text",
  );
}

async function runArchiveRelated(args: CLIArchiveArguments): Promise<void> {
  const objectUri = getObjectUri(args.objectId!);
  const archive = await getWikiGraphSDK().archives.open(
    parseCLIArchiveTarget(args.archivePath),
  );
  const scope = await archive.resolveScope();
  const context = createArchiveOutputContext(
    scope === undefined ? args : { ...args, chapters: scope.chapterIds },
    {
      continuationKind: "related",
      targetUri: objectUri,
    },
  );
  const readPage = async (
    cursor: string | undefined,
  ): Promise<ArchiveRelatedResult> =>
    await archive.related(objectUri, {
      ...(cursor === undefined ? {} : { cursor }),
      ...createOptionalEvidenceLimit(args),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      ...(args.reverse === true ? { order: "doc-desc" } : {}),
      ...(args.query === undefined ? {} : { query: args.query }),
      ...(args.queryMode === undefined ? {} : { queryMode: args.queryMode }),
      ...(args.role === undefined ? {} : { role: args.role }),
      ...(args.skipUnindexed === true ? { skipUnindexed: true } : {}),
      ...createOptionalSourceContext(args),
    });
  if (args.all === true) {
    await writeAllRelatedItems(
      readPage,
      args.cursor,
      context,
      args.format ?? "text",
    );
    return;
  }
  await writeList(await readPage(args.cursor), context, args.format ?? "text");
}

async function runArchiveEvidence(args: CLIArchiveArguments): Promise<void> {
  const objectUri = getObjectUri(args.objectId!);
  const archive = await getWikiGraphSDK().archives.open(
    parseCLIArchiveTarget(args.archivePath),
  );
  const scope = await archive.resolveScope();
  const context = createArchiveOutputContext(
    scope === undefined ? args : { ...args, chapters: scope.chapterIds },
    {
      continuationKind: "evidence",
      targetUri: objectUri,
    },
  );
  const readPage = async (cursor: string | undefined) =>
    await archive.evidence(objectUri, {
      ...(cursor === undefined ? {} : { cursor }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      ...(args.reverse === true ? { order: "doc-desc" } : {}),
      ...(args.query === undefined ? {} : { query: args.query }),
      ...(args.queryMode === undefined ? {} : { queryMode: args.queryMode }),
      ...(args.skipUnindexed === true ? { skipUnindexed: true } : {}),
      ...createOptionalSourceContext(args),
    });
  if (args.all === true) {
    await writeAllEvidence(
      readPage,
      args.cursor,
      context,
      args.format ?? "text",
    );
    return;
  }
  await writeEvidence(
    await readPage(args.cursor),
    context,
    args.format ?? "text",
  );
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

async function runLibraryIndexArchiveCommand(
  args: CLIArchiveArguments,
  target: NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>,
): Promise<void> {
  const libraries = getWikiGraphSDK().libraries;
  const library = await libraries.get(
    formatWikiGraphLibraryUri(target.publicId),
  );
  const isLibraryRootCollection =
    target.objectUri === undefined && args.objectId === undefined;
  const objectUri = isLibraryRootCollection
    ? undefined
    : getObjectUri(args.objectId ?? args.archivePath);
  const context = {
    ...createArchiveOutputContext(args),
    archiveKey: args.archivePath,
    archivePath: args.archivePath,
    indexScope: {
      kind: "library-index" as const,
      libraryId: library.snapshot.id,
    },
    libraryQuery: "objects" as const,
  };

  switch (args.action) {
    case "search": {
      const findOptions = createSearchFindOptions(args);
      if (objectUri === undefined) {
        if (args.all === true) {
          await writeAllFindHits(
            async (cursor) =>
              await libraries.search(target, args.query!, {
                ...findOptions,
                ...(cursor === undefined ? {} : { cursor }),
              }),
            context,
            args.format ?? "text",
          );
          return;
        }
        await writeFindHits(
          await libraries.search(target, args.query!, findOptions),
          context,
          args.format ?? "text",
        );
        return;
      }
      if (args.all === true) {
        await writeAllFindHits(
          async (cursor) =>
            await libraries.search(target, args.query!, {
              ...findOptions,
              ...(cursor === undefined ? {} : { cursor }),
            }),
          context,
          args.format ?? "text",
        );
        return;
      }

      await writeFindHits(
        await libraries.search(target, args.query!, findOptions),
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
                  await libraries.objects(target, {
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
              await libraries.objects(target, {
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
            await libraries.objects(target, createCollectionOptions(args)),
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
                await libraries.objects(target, {
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
            await libraries.objects(target, {
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
          await libraries.objects(target, createCollectionOptions(args)),
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
            await libraries.objects(target, createCollectionOptions(args)),
          ),
          getContext,
          args.format ?? "text",
        );
        return;
      }

      const evidenceLimit = getSingleObjectEvidenceLimit(args, objectUri);
      await writePage(
        await libraries.page(target, objectUri, {
          ...(args.backlinks === undefined
            ? {}
            : { backlinks: args.backlinks }),
          ...(evidenceLimit === undefined ? {} : { evidenceLimit }),
          ...(args.reverse === true ? { order: "doc-desc" } : {}),
          ...createOptionalSourceContext(args),
        }),
        evidenceLimit === undefined ? context : { ...context, evidenceLimit },
        args.format ?? "text",
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
        await libraries.related(target, concreteObjectUri, {
          ...(cursor === undefined ? {} : { cursor }),
          ...createOptionalEvidenceLimit(args),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.reverse === true ? { order: "doc-desc" } : {}),
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.queryMode === undefined
            ? {}
            : { queryMode: args.queryMode }),
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
            await libraries.evidence(target, concreteObjectUri, {
              ...(cursor === undefined ? {} : { cursor }),
              ...(args.limit === undefined ? {} : { limit: args.limit }),
              ...(args.reverse === true ? { order: "doc-desc" } : {}),
              ...(args.query === undefined ? {} : { query: args.query }),
              ...(args.queryMode === undefined
                ? {}
                : { queryMode: args.queryMode }),
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
        await libraries.evidence(target, concreteObjectUri, {
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.reverse === true ? { order: "doc-desc" } : {}),
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.queryMode === undefined
            ? {}
            : { queryMode: args.queryMode }),
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
        await libraries.pack(target, concreteObjectUri, args.budget ?? 5000),
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

function createSearchFindOptions(
  args: CLIArchiveArguments,
): ArchiveFindOptions {
  return createFindOptions(args);
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
