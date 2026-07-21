import { getNumber } from "../../../document/database.js";

import type { ArchiveFindHit } from "../archive-view.js";

import { openSearchSessionDatabase } from "./database.js";
import {
  compareObjectBucketHits,
  readSearchSessionEntityBucketRows,
  readSearchSessionTripleBucketRows,
} from "./hits.js";
import type { SearchChunkCursorKey, SearchObjectCursorKey } from "./types.js";

export async function readSearchSessionObjectBucketPage(
  sessionId: string,
  bucket: 1,
  after: SearchObjectCursorKey | undefined,
  limit: number,
): Promise<readonly ArchiveFindHit[]> {
  const database = await openSearchSessionDatabase();

  try {
    const entityRows = await readSearchSessionEntityBucketRows(
      database,
      sessionId,
      after,
      limit + 1,
    );
    const tripleRows = await readSearchSessionTripleBucketRows(
      database,
      sessionId,
      after,
      limit + 1,
    );

    return [...entityRows, ...tripleRows]
      .sort(compareObjectBucketHits)
      .slice(0, limit + 1);
  } finally {
    await database.close();
  }
}

export async function readSearchSessionChunkBucketPage(
  sessionId: string,
  after: SearchChunkCursorKey | undefined,
  limit: number,
): Promise<readonly ArchiveFindHit[]> {
  const database = await openSearchSessionDatabase();

  try {
    return await database.queryAll(
      `
        SELECT
          chunk_id,
          result_score
        FROM search_chunk_hits
        WHERE session_id = ?
          ${
            after === undefined
              ? ""
              : `
                AND (
                  result_score < ?
                  OR (result_score = ? AND chunk_id > ?)
                )
              `
          }
        ORDER BY result_score DESC, chunk_id
        LIMIT ?
      `,
      [
        sessionId,
        ...(after === undefined
          ? []
          : [after.score, after.score, after.chunkId]),
        limit + 1,
      ],
      (row) => {
        const chunkId = getNumber(row, "chunk_id");

        return {
          field: "title",
          id: `wikg://chunk/${chunkId}`,
          score: getNumber(row, "result_score"),
          snippet: `chunk ${chunkId}`,
          title: `chunk ${chunkId}`,
          type: "node",
        };
      },
    );
  } finally {
    await database.close();
  }
}

