import {
  listArchiveCollection,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchivePage,
  findArchiveObjects,
  type ArchiveRelatedResult,
} from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../args.js";
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
} from "./output.js";
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
  runNextArchivePage,
  writeArchiveRoot,
} from "./run/index.js";

export async function runArchiveCommand(
  args: CLIArchiveArguments,
): Promise<void> {
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
      await readArchiveDocument(args.archivePath, async (document) => {
        await writeArchiveInspectReport(document, args);
      });
      return;
    case "search":
      await readArchiveDocument(
        getArchivePath(args.archivePath),
        async (document) => {
          const context = createArchiveOutputContext(args);

          if (args.all === true) {
            await writeAllFindHits(
              async (cursor) =>
                await findArchiveObjects(document, args.query!, {
                  ...createFindOptions(args),
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
              args.query!,
              createFindOptions(args),
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
          const context = createArchiveOutputContext(args, {
            continuationKind: "collection",
          });

          if (args.all === true) {
            if (args.limit !== undefined) {
              await writeAllFindHits(
                async (cursor) =>
                  createCollectionFindResult(
                    await listArchiveCollection(document, {
                      ...createCollectionOptions(args),
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
                  ...createCollectionOptions(args),
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
                createCollectionOptions(args),
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
