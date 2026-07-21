import {
  listArchiveCollection,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  packArchiveContext,
  readArchivePage,
  findArchiveObjects,
  readContinuationCursor,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  type ArchiveRelatedResult,
} from "wiki-graph-core";
import {
  formatLocatedWikiGraphUri,
  parseLocatedWikiGraphUri,
  requireLocatedObjectOrArchiveUri,
  WikiGraphArchiveFile,
} from "wiki-graph-core";
import type { ReadonlyDocument } from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../args.js";
import { runConvertCommand } from "../convert.js";
import { writeTextToStdout } from "../../support/index.js";
import { formatCLIJSON } from "../../support/index.js";
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

type ResultFormat = "json" | "jsonl" | "text";

const DEFAULT_OUTPUT_LIMIT = 20;
const DEFAULT_GET_EVIDENCE_LIMIT = 3;
const ALL_COLLECTION_OUTPUT_LIMIT = 1_000_000_000;

interface ArchiveOutputContext {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly backlinks?: boolean;
  readonly chapters?: readonly number[];
  readonly continuationKind?: "collection" | "evidence" | "related" | "search";
  readonly evidenceDisabled?: boolean;
  readonly evidenceLimit?: number;
  readonly format: ResultFormat;
  readonly ids?: readonly string[];
  readonly limit: number;
  readonly order?: ArchiveCollectionResult["order"];
  readonly query?: string;
  readonly role?: CLIArchiveArguments["role"];
  readonly sourceContext?: number;
  readonly targetUri?: string;
  readonly triplePattern?: CLIArchiveArguments["triplePattern"];
  readonly types: readonly string[] | null;
}

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

async function runNextArchivePage(args: CLIArchiveArguments): Promise<void> {
  const cursorId = args.cursor ?? args.archivePath;
  const explicitArchivePath =
    args.cursor === undefined ? undefined : args.archivePath;
  const cursor = await readContinuationCursor(cursorId);

  if (explicitArchivePath !== undefined) {
    const archivePath = getArchivePath(explicitArchivePath);

    if (archivePath !== cursor.archivePath) {
      throw new Error(
        `Continuation cursor ${cursorId} belongs to ${cursor.archivePath}, not ${archivePath}.`,
      );
    }
  }

  await readArchiveDocument(cursor.archivePath, async (document) => {
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
          cursor: cursor.cursor,
          ...(cursor.evidenceLimit === undefined
            ? {}
            : { evidenceLimit: cursor.evidenceLimit }),
          limit,
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

        await writeFindHits(
          await findArchiveObjects(document, cursor.query ?? "", findOptions),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            ...(cursor.backlinks === undefined
              ? {}
              : { backlinks: cursor.backlinks }),
            ...(cursor.evidenceLimit === undefined
              ? {}
              : { evidenceLimit: cursor.evidenceLimit }),
            format,
            limit,
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
      case "evidence":
        await writeEvidence(
          await listArchiveEvidence(document, cursor.targetUri, {
            cursor: cursor.cursor,
            limit,
            order: cursor.order,
            ...(cursor.query === undefined ? {} : { query: cursor.query }),
            ...(cursor.sourceContext === undefined
              ? {}
              : { sourceContext: cursor.sourceContext }),
          }),
          {
            archiveKey: cursor.archiveKey,
            archivePath: cursor.archivePath,
            continuationKind: "evidence",
            format,
            limit,
            order: cursor.order,
            ...(cursor.query === undefined ? {} : { query: cursor.query }),
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
            limit,
            order: cursor.order,
            ...(cursor.query === undefined ? {} : { query: cursor.query }),
            ...(cursor.role === undefined ? {} : { role: cursor.role }),
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

function createFindOptions(args: CLIArchiveArguments): ArchiveFindOptions {
  const types = args.kinds?.map((kind) => {
    const type = toArchiveFindType(kind);

    if (type === undefined) {
      throw new Error(`Unsupported archive search type: ${kind}`);
    }

    return type;
  });

  return {
    archiveKey: getArchivePath(args.archivePath),
    ...(args.backlinks === undefined ? {} : { backlinks: args.backlinks }),
    ...createScopeOptions(args.archivePath),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    ...createOptionalEvidenceLimit(args),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.reverse === true ? { order: "doc-desc" } : {}),
    ...createOptionalSourceContext(args),
    ...(args.triplePattern === undefined
      ? {}
      : { triplePattern: args.triplePattern }),
    ...(types === undefined ? {} : { types }),
  };
}

function createArchiveOutputContext(
  args: CLIArchiveArguments,
  options: {
    readonly continuationKind?:
      | "collection"
      | "evidence"
      | "related"
      | "search";
    readonly targetUri?: string;
  } = {},
): ArchiveOutputContext {
  return {
    archiveKey: getArchivePath(args.archivePath),
    archivePath: getArchivePath(args.archivePath),
    ...(args.backlinks === undefined ? {} : { backlinks: args.backlinks }),
    ...(isEvidenceDisabled(args.evidenceLimit)
      ? { evidenceDisabled: true }
      : {}),
    ...(options.continuationKind === undefined
      ? {}
      : { continuationKind: options.continuationKind }),
    ...createOptionalEvidenceLimit(args),
    ...createOptionalSourceContext(args),
    format: args.format ?? "text",
    limit: args.limit ?? DEFAULT_OUTPUT_LIMIT,
    ...(args.reverse === true ? { order: "doc-desc" } : {}),
    ...(args.action !== "evidence" &&
    args.action !== "related" &&
    args.action !== "search"
      ? {}
      : args.query === undefined
        ? {}
        : { query: args.query }),
    ...(args.role === undefined ? {} : { role: args.role }),
    ...(options.continuationKind === "collection"
      ? createScopeOptions(args.archivePath)
      : {}),
    ...(args.triplePattern === undefined
      ? {}
      : { triplePattern: args.triplePattern }),
    ...(options.targetUri === undefined
      ? {}
      : { targetUri: options.targetUri }),
    types:
      args.kinds === undefined
        ? null
        : args.kinds
            .map((kind) => toArchiveFindType(kind))
            .filter(
              (type): type is NonNullable<typeof type> => type !== undefined,
            ),
  };
}

function getSingleObjectEvidenceLimit(
  args: CLIArchiveArguments,
  objectUri: string,
): number | undefined {
  if (isEvidenceDisabled(args.evidenceLimit)) {
    return undefined;
  }

  if (args.evidenceLimit !== undefined) {
    return args.evidenceLimit;
  }

  return isEvidenceBackedObjectUri(objectUri)
    ? DEFAULT_GET_EVIDENCE_LIMIT
    : undefined;
}

function isEvidenceDisabled(evidenceLimit: number | undefined): boolean {
  return evidenceLimit === 0;
}

function createOptionalEvidenceLimit(args: CLIArchiveArguments): {
  readonly evidenceLimit?: number;
} {
  if (
    args.evidenceLimit === undefined ||
    isEvidenceDisabled(args.evidenceLimit)
  ) {
    return {};
  }

  return { evidenceLimit: args.evidenceLimit };
}

function createOptionalSourceContext(args: CLIArchiveArguments): {
  readonly sourceContext?: number;
} {
  return args.context === undefined ? {} : { sourceContext: args.context };
}

function isEvidenceBackedObjectUri(uri: string): boolean {
  return /^wikg:\/\/(?:(?:chapter\/[1-9][0-9]*\/)?entity\/Q[1-9][0-9]*|(?:chapter\/[1-9][0-9]*\/)?triple\/Q[1-9][0-9]*\/[^/]+\/Q[1-9][0-9]*)\/?$/u.test(
    uri,
  );
}

function createCollectionOptions(
  args: CLIArchiveArguments,
): ArchiveCollectionOptions {
  const types = args.kinds?.map((kind) => {
    const type = toArchiveCollectionType(kind);

    if (type === undefined) {
      throw new Error(`Unsupported archive list type: ${kind}`);
    }

    return type;
  });

  return {
    ...(args.backlinks === undefined ? {} : { backlinks: args.backlinks }),
    ...createScopeOptions(args.archivePath),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    ...createOptionalEvidenceLimit(args),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...createOptionalSourceContext(args),
    ...(args.triplePattern === undefined
      ? {}
      : { triplePattern: args.triplePattern }),
    ...(types === undefined ? {} : { types }),
  };
}

function createCollectionFindResult(
  collection: ArchiveCollectionResult,
): ArchiveFindResult {
  return {
    chapters: collection.chapters,
    items: collection.items,
    lens: "typed",
    lensHint: null,
    limit: collection.limit,
    match: "any",
    nextCursor: collection.nextCursor,
    order: collection.order,
    query: "",
    terms: [],
    types: null,
  };
}

function createScopeOptions(uri: string): {
  readonly chapters?: readonly number[];
} {
  const objectUri = parseLocatedWikiGraphUri(uri).objectUri;

  if (objectUri === undefined) {
    return {};
  }

  const chapterId = parseChapterScope(objectUri);

  return chapterId === undefined ? {} : { chapters: [chapterId] };
}

function getArchivePath(uri: string): string {
  return requireLocatedObjectOrArchiveUri(uri).archivePath;
}

function getObjectUri(uri: string): string {
  const parsed = requireLocatedObjectOrArchiveUri(uri);

  return parsed.objectUri ?? "wikg://";
}

function isArchiveRootGet(args: CLIArchiveArguments): boolean {
  return (
    args.objectId !== undefined &&
    requireLocatedObjectOrArchiveUri(args.objectId).objectUri === undefined
  );
}

async function writeArchiveRoot(args: CLIArchiveArguments): Promise<void> {
  const archivePath = getArchivePath(args.objectId!);

  if (args.format === "json") {
    await writeTextToStdout(
      formatCLIJSON({ uri: formatLocatedWikiGraphUri(archivePath) }),
    );
    return;
  }

  await writeTextToStdout("<archive>\n");
}

function parseChapterScope(uri: string): number | undefined {
  const match = /^wikg:\/\/chapter\/([1-9][0-9]*)(?:\/|$)/u.exec(uri);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

async function readArchiveDocument<T>(
  path: string,
  operation: (document: ReadonlyDocument) => Promise<T> | T,
): Promise<void> {
  await new WikiGraphArchiveFile(path).readDocument(operation);
}

function toArchiveFindType(
  kind: NonNullable<CLIArchiveArguments["kinds"]>[number],
): NonNullable<ArchiveFindOptions["types"]>[number] | undefined {
  switch (kind) {
    case "chapter":
      return "chapter-title";
    case "chunk":
      return "node";
    case "source":
      return "source";
    case "summary":
      return "summary";
    case "entity":
      return "entity";
    case "meta":
      return "meta";
    case "triple":
      return "triple";
  }
}

function toArchiveCollectionType(
  kind: NonNullable<CLIArchiveArguments["kinds"]>[number],
): NonNullable<ArchiveCollectionOptions["types"]>[number] | undefined {
  switch (kind) {
    case "chapter":
      return "chapter-title";
    case "chunk":
      return "node";
    case "entity":
      return "entity";
    case "meta":
      return "meta";
    case "source":
      return "source";
    case "summary":
      return "summary";
    case "triple":
      return "triple";
  }
}
