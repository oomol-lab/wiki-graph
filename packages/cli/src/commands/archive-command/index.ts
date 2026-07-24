import {
  listArchiveCollection,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  findWikiGraphLibraryObjects,
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
  type ArchiveRelatedResult,
} from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../args/index.js";
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

export async function runArchiveCommand(
  args: CLIArchiveArguments,
): Promise<void> {
  const libraryTarget = parseWikiGraphLibraryUri(args.archivePath);
  if (
    libraryTarget?.kind === "scope" &&
    libraryTarget.objectUri !== "wikg://index" &&
    (libraryTarget.objectUri !== undefined || args.action === "search")
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
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          const scope = await resolveArchiveChapterScope(document, args);
          const scopedArgs =
            scope === undefined
              ? args
              : { ...args, chapters: scope.chapterIds };
          const context = createArchiveOutputContext(scopedArgs);

          if (args.all === true) {
            await writeAllFindHits(
              async (cursor) =>
                await findArchiveObjects(document, scopedArgs.query!, {
                  ...createFindOptions(scopedArgs),
                  ...(cursor === undefined ? {} : { cursor }),
                }),
              context,
              args.format ?? "text",
            );
            return;
          }

          await writeFindHits(
            await findArchiveObjects(
              document,
              scopedArgs.query!,
              createFindOptions(scopedArgs),
            ),
            context,
            args.format ?? "text",
          );
        },
      );
      return;
    case "list":
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
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

          await writePage(
            await readArchivePage(document, objectUri, {
              ...(args.backlinks === undefined
                ? {}
                : { backlinks: args.backlinks }),
              ...(evidenceLimit === undefined ? {} : { evidenceLimit }),
              ...(args.reverse === true ? { order: "doc-desc" } : {}),
              ...createOptionalSourceContext(args),
            }),
            outputContext,
            args.format ?? "text",
          );
        },
      );
      return;
    case "related":
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
                    ...createOptionalSourceContext(args),
                  },
                ),
              args.cursor,
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

async function runLibraryIndexArchiveCommand(
  args: CLIArchiveArguments,
  target: NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>,
): Promise<void> {
  const library = await resolveWikiGraphLibrary(target);
  const objectUri =
    target.objectUri === undefined && args.objectId === undefined
      ? "wikg://"
      : getObjectUri(args.objectId ?? args.archivePath);
  const context = {
    ...createArchiveOutputContext(args),
    archiveKey: args.archivePath,
    archivePath: args.archivePath,
    indexScope: { kind: "library-index" as const, libraryId: library.id },
  };

  switch (args.action) {
    case "search":
      if (args.all === true) {
        await writeAllFindHits(
          async (cursor) =>
            await findWikiGraphLibraryObjects(target, args.query!, {
              ...createFindOptions(args),
              ...(cursor === undefined ? {} : { cursor }),
            }),
          context,
          args.format ?? "text",
        );
        return;
      }

      await writeFindHits(
        await findWikiGraphLibraryObjects(
          target,
          args.query!,
          createFindOptions(args),
        ),
        context,
        args.format ?? "text",
      );
      return;
    case "list": {
      const listContext = {
        ...context,
        continuationKind: "collection" as const,
      };
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
      const evidenceLimit = getSingleObjectEvidenceLimit(args, objectUri);
      await writePage(
        await readWikiGraphLibraryPage(target, objectUri, {
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
      const relatedContext = {
        ...context,
        continuationKind: "related" as const,
        targetUri: objectUri,
      };
      const readPage = async (
        cursor: string | undefined,
      ): Promise<ArchiveRelatedResult> =>
        await listRelatedWikiGraphLibraryObjects(target, objectUri, {
          ...(cursor === undefined ? {} : { cursor }),
          ...createOptionalEvidenceLimit(args),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.reverse === true ? { order: "doc-desc" } : {}),
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.role === undefined ? {} : { role: args.role }),
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
      const evidenceContext = {
        ...context,
        continuationKind: "evidence" as const,
        targetUri: objectUri,
      };

      if (args.all === true) {
        await writeAllEvidence(
          async (cursor) =>
            await listWikiGraphLibraryEvidence(target, objectUri, {
              ...(cursor === undefined ? {} : { cursor }),
              ...(args.limit === undefined ? {} : { limit: args.limit }),
              ...(args.reverse === true ? { order: "doc-desc" } : {}),
              ...(args.query === undefined ? {} : { query: args.query }),
              ...createOptionalSourceContext(args),
            }),
          args.cursor,
          args.format ?? "text",
        );
        return;
      }

      await writeEvidence(
        await listWikiGraphLibraryEvidence(target, objectUri, {
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.reverse === true ? { order: "doc-desc" } : {}),
          ...(args.query === undefined ? {} : { query: args.query }),
          ...createOptionalSourceContext(args),
        }),
        evidenceContext,
        args.format ?? "text",
      );
      return;
    }
    case "pack":
      await writePack(
        await packWikiGraphLibraryContext(
          target,
          objectUri,
          args.budget ?? 5000,
        ),
        context,
        args.format ?? "text",
      );
      return;
    case "create":
    case "export":
    case "inspect":
    case "next":
      throw new Error(
        `The library index scope does not support \`${args.action}\`.`,
      );
  }
}
