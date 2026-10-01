import type { ContinuationCursor } from "wiki-graph-sdk";

import type { CLIArchiveArguments } from "../../../args/index.js";
import { getWikiGraphSDK } from "../../../runtime/context.js";
import {
  writeEvidence,
  writeFindHits,
  writeList,
  writeSourceLocators,
} from "../../archive-output/index.js";
import { createCollectionFindResult } from "./options.js";
import type { ArchiveOutputContext } from "./types.js";

export async function runNextArchivePage(
  args: CLIArchiveArguments,
): Promise<void> {
  const cursorId = args.cursor ?? args.archivePath;
  const page = await getWikiGraphSDK().continuations.next({
    ...(args.cursor === undefined ? {} : { archive: args.archivePath }),
    cursor: cursorId,
    ...(args.format === undefined ? {} : { format: args.format }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
  });
  const format = args.format ?? page.format;
  const context = {
    ...createCursorOutputContext(page.cursor, format, page.limit),
    continuationCursorIsDurable: true,
  };

  switch (page.kind) {
    case "source-locators":
      await writeSourceLocators(page.result, context, format);
      return;
    case "collection":
      await writeFindHits(
        createCollectionFindResult(page.result),
        context,
        format,
      );
      return;
    case "search":
      await writeFindHits(page.result, context, format);
      return;
    case "evidence":
      await writeEvidence(page.result, context, format);
      return;
    case "related":
      await writeList(page.result, context, format);
      return;
  }
}

function createCursorOutputContext(
  cursor: ContinuationCursor,
  format: "json" | "jsonl" | "text",
  limit: number,
): ArchiveOutputContext {
  return {
    archiveKey: cursor.archiveKey,
    archivePath: cursor.archivePath,
    continuationKind: cursor.kind,
    format,
    indexScope: cursor.indexScope,
    limit,
    types:
      cursor.kind === "collection" || cursor.kind === "search"
        ? cursor.types
        : null,
    ...(cursor.kind === "collection" || cursor.kind === "search"
      ? cursor.backlinks === undefined
        ? {}
        : { backlinks: cursor.backlinks }
      : {}),
    ...(cursor.kind === "collection"
      ? {
          ...(cursor.chapters === null ? {} : { chapters: cursor.chapters }),
          ...(cursor.ids === null ? {} : { ids: cursor.ids }),
          order: cursor.order,
          ...(cursor.triplePattern === undefined
            ? {}
            : { triplePattern: cursor.triplePattern }),
        }
      : {}),
    ...(cursor.kind === "search"
      ? {
          ...(cursor.chapters == null ? {} : { chapters: cursor.chapters }),
          ...(cursor.query === undefined ? {} : { query: cursor.query }),
          ...(cursor.skipUnindexed === undefined
            ? {}
            : { skipUnindexed: cursor.skipUnindexed }),
          ...(cursor.triplePattern === undefined
            ? {}
            : { triplePattern: cursor.triplePattern }),
        }
      : {}),
    ...(cursor.kind === "evidence" || cursor.kind === "related"
      ? {
          order: cursor.order,
          ...(cursor.query === undefined ? {} : { query: cursor.query }),
          ...(cursor.skipUnindexed === undefined
            ? {}
            : { skipUnindexed: cursor.skipUnindexed }),
          targetUri: cursor.targetUri,
        }
      : {}),
    ...(cursor.kind === "related" && cursor.role !== undefined
      ? { role: cursor.role }
      : {}),
    ...(cursor.kind === "source-locators"
      ? { targetUri: cursor.targetUri }
      : {}),
    ...("evidenceLimit" in cursor && cursor.evidenceLimit !== undefined
      ? { evidenceLimit: cursor.evidenceLimit }
      : {}),
    ...("sourceContext" in cursor && cursor.sourceContext !== undefined
      ? { sourceContext: cursor.sourceContext }
      : {}),
  };
}
