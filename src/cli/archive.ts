import { rm, writeFile } from "fs/promises";
import { join } from "path";

import { createWikiGraphTempDirectory } from "../common/wiki-graph-temp.js";
import {
  listArchiveCollection,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  listChapters,
  packArchiveContext,
  readArchivePage,
  findArchiveObjects,
  createContinuationCursor,
  readContinuationCursor,
  type ArchiveBacklinkBucket,
  type ArchiveBacklinks,
  type ArchiveEvidence,
  type ArchiveEvidenceItem,
  type ArchiveFindEvidencePreview,
  type ArchiveFindOptions,
  type ArchiveFindResult,
  type ArchiveFindHit,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  type ArchiveListItem,
  type ArchivePack,
  type ArchivePage,
  type ArchiveRelatedResult,
  type ChapterEntry,
  type ContinuationCursor,
} from "../facade/index.js";
import {
  isSearchIndexCurrent,
  readArchiveIndexSettings,
} from "../archive/search-index/index.js";
import {
  formatLocatedWikiGraphUri,
  parseLocatedWikiGraphUri,
  requireLocatedObjectOrArchiveUri,
  SpineDigestFile,
} from "../wikg/index.js";
import type { ReadonlyDocument } from "../document/index.js";

import type { CLIArchiveArguments } from "./args.js";
import { loadCLIConfig } from "./config.js";
import { runConvertCommand } from "./convert.js";
import { readTextStreamFromStdin, writeTextToStdout } from "./io.js";
import { formatCLIJSON, formatCLIJSONLine } from "./json.js";

type ResultFormat = "json" | "jsonl" | "text";

const DEFAULT_OUTPUT_LIMIT = 20;
const DEFAULT_GET_EVIDENCE_LIMIT = 3;
const ALL_COLLECTION_OUTPUT_LIMIT = 1_000_000_000;
const PLAIN_OBJECT_KEY_PRIORITY = [
  "uri",
  "title",
  "label",
  "labels",
  "state",
  "value",
  "authors",
  "publisher",
  "description",
] as const;

interface ArchiveOutputObject {
  readonly authors?: readonly string[];
  readonly backlinks?: ArchiveOutputBacklinks;
  readonly description?: string;
  readonly evidence?: ArchiveOutputEvidencePreview;
  readonly label?: string;
  readonly objectLabel?: string;
  readonly predicate?: string;
  readonly publisher?: string;
  readonly score?: number;
  readonly state?: Record<string, string>;
  readonly subjectLabel?: string;
  readonly text?: string;
  readonly title?: string;
  readonly type?: string;
  readonly uri: string;
  readonly value?: string;
}

interface ArchiveOutputBacklinks {
  readonly chunks: ArchiveOutputResultPage;
  readonly entities: ArchiveOutputResultPage;
  readonly triples: ArchiveOutputResultPage;
}

interface ArchiveOutputResultPage {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly objects: readonly ArchiveOutputObject[];
}

interface ArchiveOutputEvidencePreview {
  readonly nextCursor: string | null;
  readonly shown: number;
  readonly sources: readonly ArchiveOutputSource[];
  readonly total: number;
}

interface ArchiveOutputSource {
  readonly score?: number;
  readonly text: string;
  readonly uri: string;
}

interface InspectChapter extends ChapterEntry {
  readonly knowledgeGraphReady: boolean;
  readonly readingGraphReady: boolean;
  readonly summaryReady: boolean;
}

interface InspectImprovement {
  readonly command: string;
  readonly missingChapters?: number;
  readonly missingWords?: number;
  readonly planning?: InspectPlanningCost;
  readonly recommendation: string;
  readonly title: string;
}

interface InspectPlanningCost {
  readonly model: string;
  readonly timeSeconds: {
    readonly max: number;
    readonly min: number;
  };
  readonly tokens: {
    readonly cacheableInput: number;
    readonly input: number;
    readonly output: number;
  };
}

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

async function createArchive(args: CLIArchiveArguments): Promise<void> {
  if (args.sourcePath === undefined) {
    if (args.inputFormat === undefined) {
      await new SpineDigestFile(args.archivePath).write(async () => {});
      return;
    }

    await createArchiveFromStdin(args);
    return;
  }

  if (!isUrl(args.sourcePath)) {
    await runConvertCommand({
      help: false,
      inputPath: args.sourcePath,
      outputPath: args.archivePath,
      ...(args.inputFormat === undefined
        ? {}
        : { inputFormat: args.inputFormat }),
      ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      outputFormat: "wikg",
      ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
      targetStage: "sourced",
      verbose: false,
    });
    return;
  }

  const temporaryDirectoryPath =
    await createWikiGraphTempDirectory("url-create");
  const sourcePath = join(temporaryDirectoryPath, "source.md");

  try {
    const response = await fetch(args.sourcePath);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${args.sourcePath}: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    await writeFile(sourcePath, formatFetchedUrlSource(args.sourcePath, text));
    await runConvertCommand({
      help: false,
      inputFormat: args.inputFormat ?? "markdown",
      inputPath: sourcePath,
      ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      outputFormat: "wikg",
      outputPath: args.archivePath,
      ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
      targetStage: "sourced",
      verbose: false,
    });
  } finally {
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
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

async function createArchiveFromStdin(
  args: CLIArchiveArguments,
): Promise<void> {
  if (args.inputFormat === undefined) {
    throw new Error("Internal error: missing stdin create format.");
  }
  if (process.stdin.isTTY) {
    throw new Error(
      "Missing source input. Pipe text into stdin or pass a source path.",
    );
  }

  const temporaryDirectoryPath =
    await createWikiGraphTempDirectory("stdin-create");
  const extension = args.inputFormat === "markdown" ? ".md" : ".txt";
  const sourcePath = join(temporaryDirectoryPath, `source${extension}`);

  try {
    await writeFile(sourcePath, await readAllText(readTextStreamFromStdin()));
    await runConvertCommand({
      help: false,
      inputFormat: args.inputFormat,
      inputPath: sourcePath,
      ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
      outputFormat: "wikg",
      outputPath: args.archivePath,
      ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
      targetStage: "sourced",
      verbose: false,
    });
  } finally {
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
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

async function createOutputContinuationCursor(
  context: ArchiveOutputContext,
  cursor: string | null | undefined,
): Promise<string | null> {
  if (cursor === null || cursor === undefined) {
    return null;
  }

  let input: ContinuationCursor;

  if (context.continuationKind === "evidence") {
    if (context.targetUri === undefined) {
      throw new Error("Evidence continuation cursors require a target URI.");
    }

    input = {
      archiveKey: context.archiveKey,
      archivePath: context.archivePath,
      cursor,
      format: context.format,
      kind: "evidence",
      ...(context.query === undefined ? {} : { query: context.query }),
      ...(context.sourceContext === undefined
        ? {}
        : { sourceContext: context.sourceContext }),
      targetUri: context.targetUri,
    };
  } else if (context.continuationKind === "related") {
    if (context.targetUri === undefined) {
      throw new Error("Related continuation cursors require a target URI.");
    }

    input = {
      archiveKey: context.archiveKey,
      archivePath: context.archivePath,
      cursor,
      ...(context.evidenceLimit === undefined
        ? {}
        : { evidenceLimit: context.evidenceLimit }),
      format: context.format,
      kind: "related",
      ...(context.query === undefined ? {} : { query: context.query }),
      ...(context.role === undefined ? {} : { role: context.role }),
      ...(context.sourceContext === undefined
        ? {}
        : { sourceContext: context.sourceContext }),
      targetUri: context.targetUri,
    };
  } else if (context.continuationKind === "collection") {
    input = {
      archiveKey: context.archiveKey,
      archivePath: context.archivePath,
      chapters: context.chapters ?? null,
      cursor,
      ...(context.backlinks === undefined
        ? {}
        : { backlinks: context.backlinks }),
      ...(context.evidenceLimit === undefined
        ? {}
        : { evidenceLimit: context.evidenceLimit }),
      format: context.format,
      ids: context.ids ?? null,
      kind: "collection",
      order: context.order ?? "doc-asc",
      ...(context.sourceContext === undefined
        ? {}
        : { sourceContext: context.sourceContext }),
      ...(context.triplePattern === undefined
        ? {}
        : { triplePattern: context.triplePattern }),
      types: context.types,
    };
  } else {
    input = {
      archiveKey: context.archiveKey,
      archivePath: context.archivePath,
      cursor,
      ...(context.backlinks === undefined
        ? {}
        : { backlinks: context.backlinks }),
      ...(context.evidenceLimit === undefined
        ? {}
        : { evidenceLimit: context.evidenceLimit }),
      format: context.format,
      kind: "search",
      ...(context.query === undefined ? {} : { query: context.query }),
      ...(context.sourceContext === undefined
        ? {}
        : { sourceContext: context.sourceContext }),
      ...(context.triplePattern === undefined
        ? {}
        : { triplePattern: context.triplePattern }),
      types: context.types,
    };
  }

  return await createContinuationCursor(input);
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
  await new SpineDigestFile(path).readDocument(operation);
}

async function writeArchiveInspectReport(
  document: ReadonlyDocument,
  args: CLIArchiveArguments,
): Promise<void> {
  const archiveUri = formatLocatedWikiGraphUri(args.archivePath);
  const scopeUri =
    args.chapterId === undefined
      ? archiveUri
      : `${archiveUri}/chapter/${args.chapterId}`;
  const [chapters, summaryWords, ftsCurrent, indexSettings, config] =
    await Promise.all([
      readInspectChapters(document, args.chapterId),
      readSummaryWords(document, args.chapterId),
      isSearchIndexCurrent(document),
      readArchiveIndexSettings(document),
      loadCLIConfig(),
    ]);
  const concurrent = {
    job: config.concurrent?.job ?? 3,
    request: config.concurrent?.request ?? 6,
  };
  const planningModel = formatInspectPlanningModel(config.llm);
  const contentChapters = chapters.filter(
    (chapter) => chapter.stage !== "planned",
  );
  const sourceWords = sumWords(contentChapters);
  const readingGraphCovered = contentChapters.filter(
    (chapter) => chapter.readingGraphReady,
  );
  const knowledgeGraphCovered = contentChapters.filter(
    (chapter) => chapter.knowledgeGraphReady,
  );
  const summaryCovered = contentChapters.filter(
    (chapter) => chapter.summaryReady,
  );
  const improvements = createInspectImprovements({
    archiveUri,
    concurrent,
    contentChapters,
    ftsCurrent,
    planningModel,
    scopeUri,
    summaryCovered,
    knowledgeGraphCovered,
    readingGraphCovered,
  });

  await writeTextToStdout(
    [
      "Archive Inspect",
      `URI: ${scopeUri}`,
      `Scope: ${args.chapterId === undefined ? "archive" : `chapter ${args.chapterId}`}`,
      "",
      "Content",
      `Chapters: ${contentChapters.length} content / ${chapters.length} total`,
      `Planned chapters: ${chapters.length - contentChapters.length}`,
      `Source words: ${sourceWords}`,
      `Summary words: ${summaryWords}`,
      "",
      "FTS Index",
      `Status: ${ftsCurrent ? "current" : "missing or outdated"}`,
      `Storage: ${indexSettings.ftsEmbedded ? "embedded in archive" : "local cache"}`,
      `Query support: ${ftsCurrent ? "available" : "unavailable"}`,
      ...(ftsCurrent
        ? []
        : [
            "Impact: --query, related --query, and evidence --query are unavailable.",
            `Fix: wikigraph ${archiveUri}/index build`,
            "Resource: local CPU/disk time only; no LLM tokens.",
          ]),
      "",
      "Coverage",
      formatCoverageLine("Reading Graph", readingGraphCovered, contentChapters),
      formatCoverageLine(
        "Knowledge Graph",
        knowledgeGraphCovered,
        contentChapters,
      ),
      formatCoverageLine("Summary", summaryCovered, contentChapters),
      "",
      "Retrieval Guidance",
      ...formatRetrievalGuidance({
        ftsCurrent,
        knowledgeGraphCovered,
        readingGraphCovered,
        contentChapters,
        sourceWords,
      }),
      "",
      "Improvements",
      ...(improvements.length === 0
        ? ["No immediate improvements recommended."]
        : [
            ...improvements.flatMap(formatInspectImprovement),
            "",
            "Readiness details: wikigraph help readiness",
          ]),
    ].join("\n") + "\n",
  );
}

async function readInspectChapters(
  document: ReadonlyDocument,
  chapterId: number | undefined,
): Promise<readonly InspectChapter[]> {
  const chapters =
    chapterId === undefined
      ? await listChapters(document)
      : (await listChapters(document)).filter(
          (chapter) => chapter.chapterId === chapterId,
        );

  if (chapterId !== undefined && chapters.length === 0) {
    throw new Error(`Chapter ${chapterId} does not exist.`);
  }

  return await Promise.all(
    chapters.map(async (chapter) => {
      const serial = await document.serials.getById(chapter.chapterId);

      return {
        ...chapter,
        knowledgeGraphReady: serial?.knowledgeGraphReady === true,
        readingGraphReady: serial?.topologyReady === true,
        summaryReady: chapter.stage === "summarized",
      };
    }),
  );
}

async function readSummaryWords(
  document: ReadonlyDocument,
  chapterId: number | undefined,
): Promise<number> {
  return await document.readDatabase(
    async (database) =>
      (await database.queryOne(
        `
          SELECT COALESCE(SUM(words_count), 0) AS words
          FROM text_sentence_records
          WHERE kind = 2
            ${chapterId === undefined ? "" : "AND chapter_id = ?"}
        `,
        chapterId === undefined ? undefined : [chapterId],
        (row) => Number(row.words),
      )) ?? 0,
  );
}

function formatCoverageLine(
  label: string,
  covered: readonly InspectChapter[],
  total: readonly InspectChapter[],
): string {
  const coveredWords = sumWords(covered);
  const totalWords = sumWords(total);

  if (total.length === 0 && totalWords === 0) {
    return `${label}: n/a, no source content`;
  }

  return `${label}: ${covered.length}/${total.length} chapters, ${coveredWords}/${totalWords} words, ${formatPercent(coveredWords, totalWords)}`;
}

function formatRetrievalGuidance(input: {
  readonly contentChapters: readonly InspectChapter[];
  readonly ftsCurrent: boolean;
  readonly knowledgeGraphCovered: readonly InspectChapter[];
  readonly readingGraphCovered: readonly InspectChapter[];
  readonly sourceWords: number;
}): readonly string[] {
  if (input.sourceWords === 0 || input.contentChapters.length === 0) {
    return [
      "Source content: empty.",
      "Add source text before using query coverage or graph-based retrieval.",
    ];
  }

  const lines = [
    `Query support: ${input.ftsCurrent ? "available" : "unavailable until FTS index is built"}.`,
  ];

  lines.push(
    formatObjectSearchGuidance(
      "Reading Graph object retrieval",
      input.readingGraphCovered,
      input.contentChapters,
    ),
  );
  lines.push(
    formatObjectSearchGuidance(
      "Entity/triple retrieval",
      input.knowledgeGraphCovered,
      input.contentChapters,
    ),
  );

  return lines;
}

function formatObjectSearchGuidance(
  label: string,
  covered: readonly InspectChapter[],
  total: readonly InspectChapter[],
): string {
  const coveredWords = sumWords(covered);
  const totalWords = sumWords(total);
  const ratio = totalWords === 0 ? 0 : coveredWords / totalWords;
  const coverage = formatPercent(coveredWords, totalWords);

  if (ratio >= 1) {
    return `${label}: covers all source content; it can represent the full scope for object retrieval.`;
  }
  if (ratio >= 0.9) {
    return `${label}: covers ${coverage}; use it as the main path, but source --query is needed for uncovered content.`;
  }
  if (ratio >= 0.5) {
    return `${label}: covers ${coverage}; use it as leads, not as a full-scope substitute for source --query.`;
  }

  return `${label}: covers ${coverage}; build missing graph coverage before relying on object retrieval.`;
}

function createInspectImprovements(input: {
  readonly archiveUri: string;
  readonly concurrent: { readonly job: number; readonly request: number };
  readonly contentChapters: readonly InspectChapter[];
  readonly ftsCurrent: boolean;
  readonly knowledgeGraphCovered: readonly InspectChapter[];
  readonly planningModel: string;
  readonly readingGraphCovered: readonly InspectChapter[];
  readonly scopeUri: string;
  readonly summaryCovered: readonly InspectChapter[];
}): readonly InspectImprovement[] {
  const improvements: InspectImprovement[] = [];

  if (!input.ftsCurrent) {
    improvements.push({
      command: `wikigraph ${input.archiveUri}/index build`,
      recommendation:
        "Build the local FTS index so --query, related, and evidence commands are available.",
      title: "Build FTS index",
    });
  }

  if (input.contentChapters.length === 0) {
    improvements.push({
      command: `wikigraph ${input.archiveUri}/chapter add --stage sourced`,
      recommendation:
        "No source content is available yet; add or import source text before graph or summary generation.",
      title: "Add source content",
    });
    return improvements;
  }

  improvements.push(
    ...createGraphImprovement({
      concurrent: input.concurrent,
      covered: input.readingGraphCovered,
      planningModel: input.planningModel,
      scopeUri: input.scopeUri,
      task: "reading-graph",
      title: "Complete Reading Graph coverage",
      total: input.contentChapters,
    }),
  );
  improvements.push(
    ...createGraphImprovement({
      concurrent: input.concurrent,
      covered: input.knowledgeGraphCovered,
      planningModel: input.planningModel,
      scopeUri: input.scopeUri,
      task: "knowledge-graph",
      title: "Complete Knowledge Graph coverage",
      total: input.contentChapters,
    }),
  );
  improvements.push(
    ...createGraphImprovement({
      concurrent: input.concurrent,
      covered: input.summaryCovered,
      planningModel: input.planningModel,
      scopeUri: input.scopeUri,
      task: "reading-summary",
      title: "Complete Summary coverage",
      total: input.contentChapters,
    }),
  );

  return improvements;
}

function createGraphImprovement(input: {
  readonly concurrent: { readonly job: number; readonly request: number };
  readonly covered: readonly InspectChapter[];
  readonly planningModel: string;
  readonly scopeUri: string;
  readonly task: "knowledge-graph" | "reading-graph" | "reading-summary";
  readonly title: string;
  readonly total: readonly InspectChapter[];
}): readonly InspectImprovement[] {
  const coveredIds = new Set(input.covered.map((chapter) => chapter.chapterId));
  const missing = input.total.filter(
    (chapter) => !coveredIds.has(chapter.chapterId),
  );

  if (missing.length === 0) {
    return [];
  }

  const missingWords = sumWords(missing);

  return [
    {
      command: `wikigraph wikg://local/job add --input ${input.scopeUri} --task ${input.task} --accept-cost`,
      missingChapters: missing.length,
      missingWords,
      planning: planInspectTask(
        input.task,
        missingWords,
        missing.length,
        input.concurrent,
        input.planningModel,
      ),
      recommendation: formatImprovementRecommendation(
        input.covered,
        input.total,
        missingWords,
      ),
      title: input.title,
    },
  ];
}

function planInspectTask(
  task: "knowledge-graph" | "reading-graph" | "reading-summary",
  words: number,
  chapters: number,
  concurrent: { readonly job: number; readonly request: number },
  model: string,
): InspectPlanningCost {
  const profile = getInspectTaskPlanningProfile(task);
  const calls = Math.max(chapters, Math.ceil(words / profile.wordsPerCall));
  const effectiveConcurrency = Math.max(
    1,
    task === "reading-graph" ? 1 : concurrent.request,
  );
  const callBatches = Math.ceil(calls / effectiveConcurrency);
  const wordSeconds = words * profile.secondsPerWord;

  return {
    model,
    timeSeconds: {
      max: Math.ceil(callBatches * profile.maxSecondsPerCall + wordSeconds),
      min: Math.ceil(callBatches * profile.minSecondsPerCall + wordSeconds),
    },
    tokens: {
      cacheableInput: Math.ceil(words * profile.cacheableInputTokenPerWord),
      input: Math.ceil(words * profile.inputTokenPerWord),
      output: Math.ceil(words * profile.outputTokenPerWord),
    },
  };
}

function getInspectTaskPlanningProfile(
  task: "knowledge-graph" | "reading-graph" | "reading-summary",
): {
  readonly inputTokenPerWord: number;
  readonly cacheableInputTokenPerWord: number;
  readonly maxSecondsPerCall: number;
  readonly minSecondsPerCall: number;
  readonly outputTokenPerWord: number;
  readonly secondsPerWord: number;
  readonly wordsPerCall: number;
} {
  switch (task) {
    case "knowledge-graph":
      return {
        cacheableInputTokenPerWord: 60,
        inputTokenPerWord: 80,
        maxSecondsPerCall: 35,
        minSecondsPerCall: 15,
        outputTokenPerWord: 25,
        secondsPerWord: 0.02,
        wordsPerCall: 35,
      };
    case "reading-graph":
      return {
        cacheableInputTokenPerWord: 20,
        inputTokenPerWord: 25,
        maxSecondsPerCall: 45,
        minSecondsPerCall: 15,
        outputTokenPerWord: 4,
        secondsPerWord: 0.01,
        wordsPerCall: 160,
      };
    case "reading-summary":
      return {
        cacheableInputTokenPerWord: 45,
        inputTokenPerWord: 55,
        maxSecondsPerCall: 25,
        minSecondsPerCall: 10,
        outputTokenPerWord: 4,
        secondsPerWord: 0.01,
        wordsPerCall: 110,
      };
  }
}

function formatImprovementRecommendation(
  covered: readonly InspectChapter[],
  total: readonly InspectChapter[],
  missingWords: number,
): string {
  const totalWords = sumWords(total);
  const coveredWords = sumWords(covered);

  if (totalWords === 0) {
    return "No source content is available.";
  }
  if (
    total.length === 1 ||
    coveredWords / totalWords >= 0.9 ||
    missingWords <= 1000
  ) {
    return "Queue the full scope to finish the remaining gap.";
  }

  return "Queue selected chapters first if only part of the scope matters.";
}

function formatInspectImprovement(
  improvement: InspectImprovement,
): readonly string[] {
  return [
    `${improvement.title}:`,
    ...(improvement.missingChapters === undefined
      ? []
      : [
          `  Missing: ${improvement.missingChapters} chapters / ${improvement.missingWords} words`,
        ]),
    `  Recommendation: ${improvement.recommendation}`,
    ...(improvement.planning === undefined
      ? [`  Command: ${improvement.command}`]
      : [
          "  If completing this scope:",
          `    Command: ${improvement.command}`,
          `    Model: ${improvement.planning.model}`,
          `    Tokens: ${improvement.planning.tokens.input} input / ${improvement.planning.tokens.cacheableInput} cacheable input / ${improvement.planning.tokens.output} output`,
          `    Wait: ${formatDuration(improvement.planning.timeSeconds.min)}-${formatDuration(improvement.planning.timeSeconds.max)}`,
        ]),
  ];
}

function sumWords(chapters: readonly Pick<InspectChapter, "words">[]): number {
  return chapters.reduce((total, chapter) => total + chapter.words, 0);
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "n/a";
  }

  const percent = (numerator / denominator) * 100;

  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatInspectPlanningModel(
  llm: { readonly model?: string; readonly provider?: string } | undefined,
): string {
  if (llm?.model === undefined) {
    return "not configured";
  }

  return llm.provider === undefined
    ? llm.model
    : `${llm.provider}/${llm.model}`;
}

async function writeList(
  result: ArchiveRelatedResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createListObject(item, context)),
  );
  const nextCursor = await createOutputContinuationCursor(
    context,
    result.nextCursor,
  );

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(createObjectResultPage(objects, nextCursor, result.limit)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([...objects, createPageCursorObject(nextCursor)]);
    return;
  }

  if (objects.length === 0) {
    await writeTextToStdout("No objects.\n");
    return;
  }

  await writeTextToStdout(
    `${objects.map(formatFindObject).join(getListObjectSeparator(objects))}${formatNextCursor(nextCursor)}\n`,
  );
}

async function writeAllRelatedItems(
  readPage: (cursor: string | undefined) => Promise<ArchiveRelatedResult>,
  initialCursor: string | undefined,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const pages: ArchiveRelatedResult[] = [];
  let cursor = initialCursor;

  while (true) {
    const page = await readPage(cursor);

    if (format === "jsonl") {
      await writeListWithoutContinuation(page, context, format);
    } else {
      pages.push(page);
    }

    if (page.nextCursor === null) {
      break;
    }

    cursor = page.nextCursor;
  }

  if (format === "jsonl") {
    return;
  }

  await writeListWithoutContinuation(mergeRelatedPages(pages), context, format);
}

async function writeListWithoutContinuation(
  result: ArchiveRelatedResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createListObject(item, context)),
  );

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(createObjectResultPage(objects, null, result.limit)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL(objects);
    return;
  }

  if (objects.length === 0) {
    await writeTextToStdout("No objects.\n");
    return;
  }

  await writeTextToStdout(
    `${objects.map(formatFindObject).join(getListObjectSeparator(objects))}\n`,
  );
}

function mergeRelatedPages(
  pages: readonly ArchiveRelatedResult[],
): ArchiveRelatedResult {
  const [first] = pages;

  if (first === undefined) {
    throw new Error("Internal error: no related pages were loaded.");
  }

  return {
    ...first,
    items: pages.flatMap((page) => page.items),
    limit: pages.reduce((total, page) => total + page.items.length, 0),
    nextCursor: null,
  };
}

async function createListObject(
  item: ArchiveListItem,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputObject> {
  if (item.type === "triple") {
    return {
      ...(context.evidenceLimit === undefined || item.evidence === undefined
        ? {}
        : {
            evidence: await createEvidencePreviewObject(item.evidence, {
              ...context,
              continuationKind: "evidence",
              targetUri: toWikiGraphUri(item.id),
            }),
          }),
      objectLabel: item.objectLabel,
      predicate: item.predicate,
      ...(item.score === undefined ? {} : { score: item.score }),
      subjectLabel: item.subjectLabel,
      uri: toWikiGraphUri(item.id),
    };
  }

  return {
    ...(context.evidenceLimit === undefined || item.evidence === undefined
      ? {}
      : {
          evidence: await createEvidencePreviewObject(item.evidence, {
            ...context,
            continuationKind: "evidence",
            targetUri: toWikiGraphUri(item.id),
          }),
        }),
    label: item.label,
    ...(item.score === undefined ? {} : { score: item.score }),
    ...(isTextStreamOutputType(item.type)
      ? { text: item.summary }
      : { type: item.type }),
    uri: toWikiGraphUri(item.id),
  };
}

function createObjectResultPage(
  objects: readonly ArchiveOutputObject[],
  nextCursor: string | null,
  limit: number,
): {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly objects: readonly ArchiveOutputObject[];
} {
  return {
    limit,
    nextCursor,
    objects,
  };
}

async function writeFindHits(
  result: ArchiveFindResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createFindObject(item, context)),
  );
  const nextCursor = await createOutputContinuationCursor(
    context,
    result.nextCursor,
  );

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(createObjectResultPage(objects, nextCursor, result.limit)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([...objects, createPageCursorObject(nextCursor)]);
    return;
  }

  if (objects.length === 0) {
    await writeTextToStdout(formatNoMatches(result));
    return;
  }

  const outputObjects = coalesceTextStreamObjects(objects);

  await writeTextToStdout(
    `${outputObjects
      .map((object) => formatFindObject(object))
      .join(
        getListObjectSeparator(outputObjects),
      )}${formatNextCursor(nextCursor)}${formatFindLensHint(result)}\n`,
  );
}

async function writeAllFindHits(
  readPage: (cursor: string | undefined) => Promise<ArchiveFindResult>,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const pages: ArchiveFindResult[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await readPage(cursor);

    if (format === "jsonl") {
      await writeFindHitsWithoutContinuation(page, context, format);
    } else {
      pages.push(page);
    }

    if (page.nextCursor === null) {
      break;
    }

    cursor = page.nextCursor;
  }

  if (format === "jsonl") {
    return;
  }

  const merged = mergeFindResultPages(pages);
  await writeFindHitsWithoutContinuation(merged, context, format);
}

async function writeFindHitsWithoutContinuation(
  result: ArchiveFindResult,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const objects = await Promise.all(
    result.items.map(async (item) => await createFindObject(item, context)),
  );

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(createObjectResultPage(objects, null, result.limit)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL(objects);
    return;
  }

  if (objects.length === 0) {
    await writeTextToStdout(formatNoMatches(result));
    return;
  }

  const outputObjects = coalesceTextStreamObjects(objects);

  await writeTextToStdout(
    `${outputObjects
      .map((object) => formatFindObject(object))
      .join(
        getListObjectSeparator(outputObjects),
      )}${formatFindLensHint(result)}\n`,
  );
}

function mergeFindResultPages(
  pages: readonly ArchiveFindResult[],
): ArchiveFindResult {
  const [first] = pages;

  if (first === undefined) {
    throw new Error("Internal error: no result pages were loaded.");
  }

  return {
    ...first,
    items: pages.flatMap((page) => page.items),
    limit: pages.reduce((total, page) => total + page.items.length, 0),
    nextCursor: null,
  };
}

function coalesceTextStreamObjects(
  objects: readonly ArchiveOutputObject[],
): readonly ArchiveOutputObject[] {
  const coalesced: ArchiveOutputObject[] = [];

  for (const object of objects) {
    if (object.backlinks !== undefined) {
      coalesced.push(object);
      continue;
    }

    const previous = coalesced.at(-1);
    const previousRange =
      previous === undefined ? undefined : parseTextStreamObjectRange(previous);
    const currentRange = parseTextStreamObjectRange(object);

    if (
      previous !== undefined &&
      previousRange !== undefined &&
      currentRange !== undefined &&
      previousRange.chapterId === currentRange.chapterId &&
      previousRange.stream === currentRange.stream &&
      previousRange.end + 1 === currentRange.start
    ) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        text: [previous.text, object.text].filter(isString).join("\n"),
        uri: formatTextStreamObjectUri(
          previousRange.chapterId,
          previousRange.stream,
          previousRange.start,
          currentRange.end,
        ),
      };
      continue;
    }

    coalesced.push(object);
  }

  return coalesced;
}

function parseTextStreamObjectRange(object: ArchiveOutputObject):
  | {
      readonly chapterId: number;
      readonly end: number;
      readonly start: number;
      readonly stream: "source" | "summary";
    }
  | undefined {
  const match =
    /^wikg:\/\/chapter\/([1-9][0-9]*)\/(source|summary)#([0-9]+)(?:\.\.([0-9]+))?$/u.exec(
      object.uri,
    );

  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return undefined;
  }

  const start = Number(match[3]);
  const end = match[4] === undefined ? start : Number(match[4]);

  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return undefined;
  }

  return {
    chapterId: Number(match[1]),
    end,
    start,
    stream: match[2] as "source" | "summary",
  };
}

function formatTextStreamObjectUri(
  chapterId: number,
  stream: "source" | "summary",
  start: number,
  end: number,
): string {
  return `wikg://chapter/${chapterId}/${stream}#${start === end ? String(start) : `${start}..${end}`}`;
}

function isString(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

async function writeEvidence(
  evidence: ArchiveEvidence,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const nextCursor = await createOutputContinuationCursor(
    context,
    evidence.nextCursor,
  );
  const objects = evidence.items.map(createSourceObject);

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(
        createObjectResultPage(objects, nextCursor, evidence.limit),
      ),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([...objects, createPageCursorObject(nextCursor)]);
    return;
  }

  if (evidence.items.length === 0) {
    await writeTextToStdout("No evidence.\n");
    return;
  }

  await writeTextToStdout(
    `${evidence.items.map(formatEvidenceItem).join("\n\n")}${formatEvidenceNextCursor(nextCursor)}\n`,
  );
}

async function writeAllEvidence(
  readPage: (cursor: string | undefined) => Promise<ArchiveEvidence>,
  initialCursor: string | undefined,
  format: ResultFormat,
): Promise<void> {
  const pages: ArchiveEvidence[] = [];
  let cursor = initialCursor;

  while (true) {
    const page = await readPage(cursor);

    if (format === "jsonl") {
      await writeEvidenceWithoutContinuation(page, format);
    } else {
      pages.push(page);
    }

    if (page.nextCursor === null) {
      break;
    }

    cursor = page.nextCursor;
  }

  if (format === "jsonl") {
    return;
  }

  await writeEvidenceWithoutContinuation(mergeEvidencePages(pages), format);
}

async function writeEvidenceWithoutContinuation(
  evidence: ArchiveEvidence,
  format: ResultFormat,
): Promise<void> {
  const objects = evidence.items.map(createSourceObject);

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(createObjectResultPage(objects, null, evidence.limit)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL(objects);
    return;
  }

  if (evidence.items.length === 0) {
    await writeTextToStdout("No evidence.\n");
    return;
  }

  await writeTextToStdout(
    `${evidence.items.map(formatEvidenceItem).join("\n\n")}\n`,
  );
}

function mergeEvidencePages(
  pages: readonly ArchiveEvidence[],
): ArchiveEvidence {
  const [first] = pages;

  if (first === undefined) {
    throw new Error("Internal error: no evidence pages were loaded.");
  }

  return {
    ...first,
    items: pages.flatMap((page) => page.items),
    limit: pages.reduce((total, page) => total + page.items.length, 0),
    nextCursor: null,
  };
}

function formatEvidenceNextCursor(nextCursor: string | null): string {
  return nextCursor === null
    ? ""
    : `\n\nNext page: wikigraph next ${nextCursor}`;
}

function createPageCursorObject(nextCursor: string | null): {
  readonly nextCursor: string | null;
  readonly type: "page";
} {
  return {
    nextCursor,
    type: "page",
  };
}

function formatEvidenceItem(item: ArchiveEvidenceItem): string {
  return formatScoredLines(
    item.score,
    formatSourceCitationBlock(item.id, item.source).split("\n"),
  ).join("\n");
}

async function writePage(
  page: ArchivePage,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(await createPageObject(page, context)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([await createPageObject(page, context)]);
    return;
  }

  switch (page.type) {
    case "chapter-title":
      await writeTextToStdout(
        `${formatPlainObject(await createPageObject(page, context))}\n`,
      );
      return;
    case "chapter":
      await writeTextToStdout(
        `${formatChapterObjectText(
          (await createPageObject(page, context)) as ArchiveOutputObject,
        )}\n`,
      );
      return;
    case "meta":
      await writeTextToStdout(
        `${formatPlainObject(await createPageObject(page, context))}\n`,
      );
      return;
    case "state":
      await writeTextToStdout(
        `${formatStatePageText(await createPageObject(page, context))}\n`,
      );
      return;
    case "fragment":
      if (
        page.id.startsWith("wikg://") &&
        !page.id.includes("#") &&
        page.backlinks === undefined
      ) {
        await writeTextToStdout(`${page.fragment.text}\n`);
        return;
      }
      if (page.id.startsWith("wikg://chapter/")) {
        await writeTextToStdout(
          `${formatFindObject(
            (await createPageObject(page, context)) as ArchiveOutputObject,
          )}\n`,
        );
        return;
      }
      await writeTextToStdout(
        [
          `${page.id}`,
          `Words: ${page.fragment.wordsCount}`,
          `Previous: ${page.previousFragmentId ?? "[none]"}`,
          `Next: ${page.nextFragmentId ?? "[none]"}`,
          "",
          page.fragment.text,
          "",
          "Related Nodes:",
          ...formatNodeLabels(page.nodes),
        ].join("\n") + "\n",
      );
      return;
    case "node":
      await writeTextToStdout(
        [
          `${page.id}  ${page.title}`,
          `Chapter: ${page.position === undefined ? "[unknown]" : `chapter:${page.position.chapter}`}`,
          `Position: ${formatPosition(page.position)}`,
          "",
          "Generated Node Summary:",
          page.generatedNodeSummary,
          "",
          "Source Fragments:",
          ...formatSourceFragmentLines(page.sourceFragments),
          "",
          "Outgoing Nodes:",
          ...formatNeighborLines(page.outgoing),
          "",
          "Incoming Nodes:",
          ...formatNeighborLines(page.incoming),
        ].join("\n") + "\n",
      );
      return;
    case "summary":
      await writeTextToStdout(`${page.id}  ${page.title}\n\n${page.content}\n`);
      return;
    case "entity":
      await writeTextToStdout(
        `${appendEntityNextSteps(
          await formatEvidenceBackedPageText(
            page.id,
            page.label,
            page.evidence,
            context,
          ),
          page.id,
          context.archivePath,
        )}\n`,
      );
      return;
    case "entity-wikipage":
      await writeTextToStdout(`${formatEntityWikipageText(page)}\n`);
      return;
    case "triple":
      await writeTextToStdout(
        `${await formatEvidenceBackedPageText(
          page.id,
          page.label,
          page.evidence,
          context,
        )}\n`,
      );
      return;
  }
}

async function formatEvidenceBackedPageText(
  uri: string,
  label: string,
  evidence: ArchiveFindEvidencePreview,
  context: ArchiveOutputContext,
): Promise<string> {
  if (context.evidenceLimit === undefined) {
    return [`${uri}`, label].join("\n");
  }

  return [
    `${uri}`,
    label,
    "",
    "Evidence:",
    ...formatEvidencePreviewBlocks(
      await createEvidencePreviewObject(evidence, {
        ...context,
        continuationKind: "evidence",
        targetUri: uri,
      }),
    ),
  ].join("\n");
}

function appendEntityNextSteps(
  text: string,
  uri: string,
  archivePath: string,
): string {
  if (!isEntityOutputUri(uri)) {
    return text;
  }
  const entityUri = formatLocatedWikiGraphUri(
    archivePath,
    uri.replace(/\/$/u, ""),
  );

  return [
    text,
    "",
    "Next:",
    `  wikigraph ${entityUri} evidence`,
    `  wikigraph ${entityUri} related`,
    `  wikigraph ${entityUri}/wikipage`,
  ].join("\n");
}

function isEntityOutputUri(uri: string): boolean {
  return /^wikg:\/\/(?:chapter\/[1-9][0-9]*\/)?entity\/Q[1-9][0-9]*\/?$/u.test(
    uri,
  );
}

function formatEntityWikipageText(
  page: Extract<ArchivePage, { readonly type: "entity-wikipage" }>,
): string {
  return [
    page.id,
    "",
    ...formatEntityWikipageLocaleLines("zh", page.zh),
    "",
    ...formatEntityWikipageLocaleLines("en", page.en),
  ].join("\n");
}

function formatEntityWikipageLocaleLines(
  language: "en" | "zh",
  locale: Extract<ArchivePage, { readonly type: "entity-wikipage" }>[
    | "en"
    | "zh"],
): readonly string[] {
  if (locale === null) {
    return [`${language}: [missing]`];
  }

  return [
    `${locale.title}  ${locale.url}`,
    ...(locale.description === undefined ? [] : [locale.description]),
  ];
}

async function writePack(
  pack: ArchivePack,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const packContext =
    context.evidenceDisabled === true
      ? context
      : {
          ...context,
          evidenceLimit: context.evidenceLimit ?? DEFAULT_GET_EVIDENCE_LIMIT,
        };

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(await createPackObject(pack, packContext)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([await createPackObject(pack, packContext)]);
    return;
  }

  const lines = [
    `Pack Budget: ${pack.budget}`,
    "",
    "# Anchor",
    await formatPackAnchor(pack.anchor, packContext),
    "",
    "# Related",
    (
      await Promise.all(
        pack.related.map(async (item) =>
          formatFindObject(await createListObject(item, packContext)),
        ),
      )
    ).join("\n\n"),
  ];

  await writeTextToStdout(
    `${truncateToBudget(lines.join("\n"), pack.budget)}\n`,
  );
}

function formatNextCursor(nextCursor: string | null): string {
  if (nextCursor === null) {
    return "";
  }

  return `\n\nNext page: wikigraph next ${nextCursor}`;
}

function formatNoMatches(result: ArchiveFindResult): string {
  if (result.match === "all" && result.terms.length > 1) {
    return `No matches. Try a more specific scope URI, for example: wikigraph <archive-uri>/chunk --query "${result.query}"${formatFindLensHint(result)}\n`;
  }

  const lines = [
    "No matches.",
    "Try fewer or broader keywords, or use --query on a scope URI such as `<archive-uri>/chapter`, `<archive-uri>/chunk`, `<archive-uri>/entity`, or `<archive-uri>/triple`.",
  ];

  if (result.lensHint !== null) {
    lines.push(`Lens hint: ${result.lensHint.message}`);
  }

  return `${lines.join("\n")}\n`;
}

async function createFindObject(
  hit: ArchiveFindHit,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputObject> {
  const uri = toWikiGraphUri(hit.id);

  if (hit.type === "chapter") {
    return {
      ...(hit.state === undefined ? {} : { state: hit.state }),
      title: hit.title,
      uri,
    };
  }
  if (hit.type === "chapter-title") {
    return {
      title: hit.title,
      type: "chapter-title",
      uri,
    };
  }
  if (hit.type === "meta") {
    return {
      title: hit.title,
      uri,
    };
  }
  if (hit.type === "triple") {
    const triple = hit.triple;

    return {
      ...(hit.backlinks === undefined
        ? {}
        : { backlinks: await createBacklinksObject(hit.backlinks, context) }),
      ...(context.evidenceLimit === undefined || hit.evidence === undefined
        ? {}
        : {
            evidence: await createEvidencePreviewObject(hit.evidence, {
              ...context,
              continuationKind: "evidence",
              targetUri: uri,
            }),
          }),
      objectLabel: triple?.objectLabel ?? "",
      predicate: triple?.predicate ?? "",
      subjectLabel: triple?.subjectLabel ?? "",
      uri,
    };
  }

  return {
    ...(hit.backlinks === undefined
      ? {}
      : { backlinks: await createBacklinksObject(hit.backlinks, context) }),
    ...(context.evidenceLimit === undefined || hit.evidence === undefined
      ? {}
      : {
          evidence: await createEvidencePreviewObject(hit.evidence, {
            ...context,
            continuationKind: "evidence",
            targetUri: uri,
          }),
        }),
    label: hit.title,
    ...(isTextStreamOutputType(hit.type)
      ? { text: hit.snippet }
      : { type: hit.type === "node" ? "chunk" : hit.type }),
    uri,
  };
}

async function createEvidencePreviewObject(
  evidence: ArchiveFindEvidencePreview,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputEvidencePreview> {
  return {
    nextCursor: await createOutputContinuationCursor(
      {
        ...context,
        continuationKind: "evidence",
      },
      evidence.nextCursor,
    ),
    shown: evidence.shown,
    sources: evidence.sources.map(createSourceObject),
    total: evidence.total,
  };
}

function createSourceObject(item: ArchiveEvidenceItem): ArchiveOutputSource {
  return {
    ...(item.score === undefined ? {} : { score: item.score }),
    text: item.source,
    uri: item.id,
  };
}

async function createBacklinksObject(
  backlinks: ArchiveBacklinks,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputBacklinks> {
  return {
    chunks: await createBacklinkBucketObject(backlinks.chunks, context),
    entities: await createBacklinkBucketObject(backlinks.entities, context),
    triples: await createBacklinkBucketObject(backlinks.triples, context),
  };
}

async function createBacklinkBucketObject(
  bucket: ArchiveBacklinkBucket,
  context: ArchiveOutputContext,
): Promise<ArchiveOutputResultPage> {
  const objects = await Promise.all(
    bucket.items.map(
      async (item) =>
        await createFindObject(item, {
          ...context,
          backlinks: false,
        }),
    ),
  );

  return createObjectResultPage(objects, bucket.nextCursor, bucket.limit);
}

async function createPageObject(
  page: ArchivePage,
  context: ArchiveOutputContext,
): Promise<unknown> {
  switch (page.type) {
    case "entity-wikipage":
      return {
        en: page.en,
        uri: page.id,
        zh: page.zh,
      };
    case "entity":
      return {
        labels: page.labels.slice(0, 7),
        qid: page.qid,
        ...(context.evidenceLimit === undefined
          ? {}
          : {
              evidence: await createEvidencePreviewObject(page.evidence, {
                ...context,
                continuationKind: "evidence",
                targetUri: page.id,
              }),
            }),
        uri: page.id,
      };
    case "triple":
      return {
        label: page.label,
        ...(context.evidenceLimit === undefined
          ? {}
          : {
              evidence: await createEvidencePreviewObject(page.evidence, {
                ...context,
                continuationKind: "evidence",
                targetUri: page.id,
              }),
            }),
        uri: page.id,
      };
    case "chapter": {
      return {
        state: page.state,
        title: page.title,
        uri: toWikiGraphUri(page.id),
      };
    }
    case "chapter-title":
      return {
        title: page.title,
        type: "chapter-title",
        uri: toWikiGraphUri(page.id),
      };
    case "chapter-tree": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "fragment": {
      const {
        backlinks,
        id: _id,
        nextFragmentId,
        previousFragmentId,
        ...rest
      } = page;
      const textStreamType = getTextStreamOutputType(page.id);

      if (textStreamType !== undefined) {
        return {
          ...(backlinks === undefined
            ? {}
            : { backlinks: await createBacklinksObject(backlinks, context) }),
          text: page.fragment.text,
          uri: toWikiGraphUri(page.id),
        };
      }

      return {
        ...rest,
        ...(backlinks === undefined
          ? {}
          : { backlinks: await createBacklinksObject(backlinks, context) }),
        ...(nextFragmentId === undefined
          ? {}
          : { nextUri: toWikiGraphUri(nextFragmentId) }),
        ...(previousFragmentId === undefined
          ? {}
          : { previousUri: toWikiGraphUri(previousFragmentId) }),
        uri: toWikiGraphUri(page.id),
      };
    }
    case "meta": {
      const { id: _id, type: _type, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "state": {
      if ("state" in page) {
        return { ...page.state, uri: toWikiGraphUri(page.id) };
      }

      return { uri: toWikiGraphUri(page.id), value: page.value };
    }
    case "node": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
    case "summary": {
      const { id: _id, ...rest } = page;

      return { ...rest, uri: toWikiGraphUri(page.id) };
    }
  }
}

async function createPackObject(
  pack: ArchivePack,
  context: ArchiveOutputContext,
): Promise<{
  readonly anchor: unknown;
  readonly related: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly objects: readonly ArchiveOutputObject[];
  };
}> {
  const relatedObjects = await Promise.all(
    pack.related.map(async (item) => await createListObject(item, context)),
  );

  return {
    anchor: await createPageObject(pack.anchor, context),
    related: createObjectResultPage(
      relatedObjects,
      null,
      relatedObjects.length,
    ),
  };
}

function formatFindObject(object: ArchiveOutputObject): string {
  const lines = formatScoredLines(
    object.score,
    formatObjectSummaryLines(object),
  );

  if (object.evidence !== undefined && object.evidence.sources.length > 0) {
    lines.push(
      "",
      ...object.evidence.sources.flatMap((source, index) => [
        ...(index === 0 ? [] : [""]),
        `-- evidence ${index + 1}/${object.evidence?.shown ?? object.evidence?.sources.length}`,
        formatSourceObject(source),
      ]),
    );

    const hiddenEvidenceCount = object.evidence.total - object.evidence.shown;

    lines.push(
      ...formatEvidencePreviewContinuation(
        object.evidence,
        hiddenEvidenceCount,
      ),
    );
  }

  if (object.backlinks !== undefined) {
    lines.push("", ...formatBacklinkLines(object.backlinks));
  }

  return lines.join("\n");
}

function formatScoredLines(
  score: number | undefined,
  lines: readonly string[],
): string[] {
  return score === undefined ? [...lines] : [`score: ${score}`, ...lines];
}

function formatBacklinkLines(backlinks: ArchiveOutputBacklinks): string[] {
  const lines = [
    ...backlinks.chunks.objects,
    ...backlinks.entities.objects,
    ...backlinks.triples.objects,
  ].flatMap((object, index) => [
    ...(index === 0 ? [] : [""]),
    formatFindObject(object),
  ]);

  return lines.length === 0 ? [] : ["Backlinks:", "", ...lines];
}

function formatObjectSummaryLines(object: ArchiveOutputObject): string[] {
  if (
    getTextStreamOutputType(object.uri) !== undefined &&
    object.text !== undefined
  ) {
    return formatSourceObject({
      text: object.text,
      uri: object.uri,
    }).split("\n");
  }

  if (object.predicate !== undefined) {
    return [object.uri, formatTripleObjectLabel(object)];
  }

  if (isChapterStateListObject(object)) {
    return [
      [object.uri, object.title, formatStateInline(object.state)]
        .filter((part): part is string => part !== undefined && part !== "")
        .join("  "),
    ];
  }

  return [
    object.uri,
    object.title,
    object.label,
    object.state === undefined ? undefined : formatStateInline(object.state),
    object.evidence === undefined ? object.text : undefined,
  ].filter((line): line is string => line !== undefined && line !== "");
}

function getListObjectSeparator(
  objects: readonly ArchiveOutputObject[],
): string {
  return objects.every(isChapterStateListObject) ? "\n" : "\n\n";
}

function isChapterStateListObject(
  object: ArchiveOutputObject,
): object is ArchiveOutputObject & {
  readonly state: Record<string, string>;
} {
  return (
    object.state !== undefined &&
    object.uri.startsWith("wikg://chapter/") &&
    !object.uri.includes("/state")
  );
}

function formatTripleObjectLabel(object: ArchiveOutputObject): string {
  const triple = parseTripleOutputUri(object.uri);

  if (triple === undefined) {
    return `${object.subjectLabel ?? "[subject]"} ${object.predicate ?? "[predicate]"} ${object.objectLabel ?? "[object]"}`;
  }

  return `${object.subjectLabel ?? triple.subjectQid}(${triple.subjectQid}) ${object.predicate ?? triple.predicate} ${object.objectLabel ?? triple.objectQid}(${triple.objectQid})`;
}

function parseTripleOutputUri(uri: string):
  | {
      readonly objectQid: string;
      readonly predicate: string;
      readonly subjectQid: string;
    }
  | undefined {
  const match =
    /^wikg:\/\/triple\/(Q[1-9][0-9]*)\/([^/]+)\/(Q[1-9][0-9]*)\/?$/u.exec(uri);

  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return undefined;
  }

  return {
    objectQid: match[3],
    predicate: decodeURIComponent(match[2]),
    subjectQid: match[1],
  };
}

function formatPlainObject(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return String(value);
  }

  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null)
    .sort(([left], [right]) => comparePlainObjectKeys(left, right))
    .map(([key, item]) => `${key}: ${formatPlainValue(item)}`)
    .join("\n");
}

function formatStatePageText(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return String(value);
  }

  const object = value as {
    readonly state?: Record<string, string>;
    readonly uri?: string;
    readonly value?: string;
  };

  if (object.value !== undefined) {
    return `${object.uri ?? "state"} ${object.value}`;
  }

  if (object.state !== undefined) {
    return [object.uri, formatStateBlock(object.state)]
      .filter((line): line is string => line !== undefined && line !== "")
      .join("\n");
  }

  return formatPlainObject(value);
}

function formatChapterObjectText(object: ArchiveOutputObject): string {
  if (isChapterStateListObject(object)) {
    return formatObjectSummaryLines(object).join("\n");
  }

  return formatPlainObject(object);
}

function formatStateBlock(state: Record<string, string>): string {
  return formatStateEntries(state)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function formatStateInline(state: Record<string, string>): string {
  return formatStateEntries(state)
    .map(([key, value]) => `${key}:${value}`)
    .join(" ");
}

function formatStateEntries(
  state: Record<string, string>,
): readonly (readonly [string, string])[] {
  const entries: readonly (readonly [string, string | undefined])[] = [
    ["source", state.source],
    ["reading-graph", state["reading-graph"]],
    ["reading-summary", state["reading-summary"]],
    ["knowledge-graph", state["knowledge-graph"]],
  ];

  return entries.filter(
    (entry): entry is readonly [string, string] => entry[1] !== undefined,
  );
}

function comparePlainObjectKeys(left: string, right: string): number {
  return getPlainObjectKeyOrder(left) - getPlainObjectKeyOrder(right);
}

function getPlainObjectKeyOrder(key: string): number {
  const index = PLAIN_OBJECT_KEY_PRIORITY.indexOf(
    key as (typeof PLAIN_OBJECT_KEY_PRIORITY)[number],
  );

  return index < 0 ? PLAIN_OBJECT_KEY_PRIORITY.length : index;
}

function formatPlainValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return formatCLIJSON(value).trimEnd();
  }

  return String(value);
}

function formatSourceObject(source: ArchiveOutputSource): string {
  return formatSourceCitationBlock(source.uri, source.text);
}

function formatSourceCitationBlock(uri: string, text: string): string {
  return [`@@ ${uri} @@`, normalizeSourceText(text)].join("\n");
}

function isTextStreamOutputType(type: string | undefined): boolean {
  return type === "source" || type === "summary";
}

function getTextStreamOutputType(
  uri: string,
): "source" | "summary" | undefined {
  const match =
    /^wikg:\/\/chapter\/[1-9][0-9]*\/(source|summary)(?:#.*)?$/u.exec(uri);

  return match?.[1] as "source" | "summary" | undefined;
}

function formatFindLensHint(result: ArchiveFindResult): string {
  if (result.lensHint === null) {
    return "";
  }

  return `\n\nLens hint: ${result.lensHint.message}`;
}

function formatNeighborLines(
  neighbors: Extract<ArchivePage, { readonly type: "node" }>["neighbors"],
): string[] {
  if (neighbors.length === 0) {
    return ["  [none]"];
  }

  return neighbors.map((neighbor) => {
    const arrow = neighbor.direction === "incoming" ? "<-" : "->";

    return `  ${arrow} ${toWikiGraphUri(`node:${neighbor.node.id}`)}  ${neighbor.node.label}`;
  });
}

function formatNodeLabels(
  nodes: readonly { readonly id: string; readonly title: string }[],
): string[] {
  if (nodes.length === 0) {
    return ["  [none]"];
  }

  return nodes.map((node) => `  ${node.id}  ${node.title}`);
}

function formatSourceFragmentLines(
  fragments: Extract<ArchivePage, { readonly type: "node" }>["sourceFragments"],
): string[] {
  if (fragments.length === 0) {
    return ["  [none]"];
  }

  return fragments.flatMap((fragment) => [
    `  ${fragment.id}${fragment.truncated ? "  [excerpt]" : ""}`,
    ...fragment.text.split("\n").map((line) => `    ${line}`),
  ]);
}

function formatEvidencePreviewBlocks(
  evidence: ArchiveOutputEvidencePreview,
): string[] {
  if (evidence.sources.length === 0) {
    return ["[none]"];
  }

  const lines = evidence.sources.flatMap((item, index) => [
    ...(index === 0 ? [] : [""]),
    `-- evidence ${index + 1}/${evidence.shown}`,
    formatSourceObject(item),
  ]);
  const hiddenEvidenceCount = evidence.total - evidence.shown;

  lines.push(
    ...formatEvidencePreviewContinuation(evidence, hiddenEvidenceCount),
  );
  return lines;
}

function formatEvidencePreviewContinuation(
  evidence: ArchiveOutputEvidencePreview,
  hiddenEvidenceCount: number,
): string[] {
  if (evidence.nextCursor !== null) {
    return [
      "",
      `${hiddenEvidenceCount} more evidence: wikigraph next ${evidence.nextCursor}`,
    ];
  }

  return hiddenEvidenceCount > 0
    ? ["", `${hiddenEvidenceCount} evidence more...`]
    : [];
}

function normalizeSourceText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  while (lines.length > 0 && lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines.at(-1)?.trim() === "") {
    lines.pop();
  }

  const normalizedLines: string[] = [];
  let previousLineWasBlank = false;

  for (const line of lines) {
    if (line.trim() === "") {
      if (!previousLineWasBlank) {
        normalizedLines.push("");
      }
      previousLineWasBlank = true;
      continue;
    }

    normalizedLines.push(line);
    previousLineWasBlank = false;
  }

  return normalizedLines.join("\n");
}

function formatPosition(
  position:
    | {
        readonly chapter: number;
        readonly fragment?: number;
      }
    | undefined,
): string {
  if (position === undefined) {
    return "[unknown]";
  }

  return [
    `chapter ${position.chapter}`,
    position.fragment === undefined
      ? undefined
      : `fragment ${position.fragment}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.round(minutes / 60)}h`;
}

async function formatPackAnchor(
  anchor: ArchivePage,
  context: ArchiveOutputContext,
): Promise<string> {
  switch (anchor.type) {
    case "chapter-title":
    case "chapter":
      return formatPlainObject(await createPageObject(anchor, context));
    case "chapter-tree":
      return `${anchor.id} ${anchor.title}\n${formatCLIJSON(anchor.tree).trimEnd()}`;
    case "fragment":
      return `${anchor.id}\n${anchor.fragment.text}`;
    case "meta":
      return formatPlainObject(await createPageObject(anchor, context));
    case "state":
      return formatPlainObject(await createPageObject(anchor, context));
    case "node":
      return [
        `${anchor.id} ${anchor.title}`,
        "",
        "Generated Node Summary:",
        anchor.generatedNodeSummary,
        "",
        "Source Fragments:",
        ...formatSourceFragmentLines(anchor.sourceFragments),
      ].join("\n");
    case "summary":
      return `${anchor.id} ${anchor.title}\n${anchor.content}`;
    case "entity":
      return await formatEvidenceBackedPageText(
        anchor.id,
        anchor.label,
        anchor.evidence,
        context,
      );
    case "entity-wikipage":
      return formatEntityWikipageText(anchor);
    case "triple":
      return await formatEvidenceBackedPageText(
        anchor.id,
        anchor.label,
        anchor.evidence,
        context,
      );
  }
}

function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }

  return `${text.slice(0, Math.max(0, budget - 20))}\n[truncated]`;
}

async function writeJSONL(items: readonly unknown[]): Promise<void> {
  await writeTextToStdout(
    items.map((item) => formatCLIJSONLine(item)).join("") +
      (items.length === 0 ? "" : ""),
  );
}

function toWikiGraphUri(id: string): string {
  const [type, first, second] = id.split(":");

  switch (type) {
    case "chapter":
      return `wikg://chapter/${first ?? ""}`;
    case "chapter-title":
      return `wikg://chapter/${first ?? ""}/title`;
    case "fragment":
      return `wikg://chapter/${first ?? ""}/source/${second ?? "0"}`;
    case "meta":
      return "wikg://";
    case "node":
      return `wikg://chunk/${first ?? ""}`;
    case "summary":
      return `wikg://chapter/${first ?? ""}/summary`;
    default:
      return id;
  }
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

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatFetchedUrlSource(url: string, text: string): string {
  return [`# ${url}`, "", text].join("\n");
}

async function readAllText(stream: AsyncIterable<string>): Promise<string> {
  let text = "";

  for await (const chunk of stream) {
    text += chunk;
  }

  return text;
}
