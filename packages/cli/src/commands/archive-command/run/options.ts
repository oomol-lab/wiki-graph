import {
  parseLocatedWikiGraphUri,
  type ArchiveCollectionOptions,
  type ArchiveCollectionResult,
  type ArchiveFindOptions,
  type ArchiveFindResult,
} from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../../args/index.js";
import {
  DEFAULT_GET_EVIDENCE_LIMIT,
  DEFAULT_OUTPUT_LIMIT,
  type ArchiveOutputContext,
} from "./types.js";
import { getArchivePath, parseChapterScope } from "./uri.js";

export function createFindOptions(
  args: CLIArchiveArguments,
): ArchiveFindOptions {
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

export function createArchiveOutputContext(
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

export function getSingleObjectEvidenceLimit(
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

export function createOptionalEvidenceLimit(args: CLIArchiveArguments): {
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

export function createOptionalSourceContext(args: CLIArchiveArguments): {
  readonly sourceContext?: number;
} {
  return args.context === undefined ? {} : { sourceContext: args.context };
}

function isEvidenceBackedObjectUri(uri: string): boolean {
  return /^wikg:\/\/(?:(?:chapter\/[1-9][0-9]*\/)?entity\/Q[1-9][0-9]*|(?:chapter\/[1-9][0-9]*\/)?triple\/Q[1-9][0-9]*\/[^/]+\/Q[1-9][0-9]*)\/?$/u.test(
    uri,
  );
}

export function createCollectionOptions(
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

export function createCollectionFindResult(
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

export function createScopeOptions(uri: string): {
  readonly chapters?: readonly number[];
} {
  const objectUri = parseLocatedWikiGraphUri(uri).objectUri;

  if (objectUri === undefined) {
    return {};
  }

  const chapterId = parseChapterScope(objectUri);

  return chapterId === undefined ? {} : { chapters: [chapterId] };
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
