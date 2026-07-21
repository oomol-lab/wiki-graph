import {
  createContinuationCursor,
  type ContinuationCursor,
} from "wiki-graph-core";

import type { ArchiveOutputContext } from "./types.js";

export async function createOutputContinuationCursor(
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
      order: context.order ?? "doc-asc",
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
      order: context.order ?? "doc-asc",
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
