import {
  findArchiveObjects,
  listArchiveCollection,
  listArchiveEvidence,
  listRelatedArchiveObjects,
  readContinuationCursor,
  type ArchiveCollectionOptions,
  type ArchiveFindOptions,
} from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../../args/index.js";
import {
  writeEvidence,
  writeFindHits,
  writeList,
} from "../../archive-output/index.js";
import { readArchiveDocument } from "./document.js";
import { createCollectionFindResult } from "./options.js";
import { DEFAULT_OUTPUT_LIMIT } from "./types.js";
import { getArchivePath } from "./uri.js";

export async function runNextArchivePage(
  args: CLIArchiveArguments,
): Promise<void> {
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
