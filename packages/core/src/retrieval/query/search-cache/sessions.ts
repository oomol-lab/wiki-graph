import { getNumber, getString } from "../../../document/database.js";

import { encodeSearchSessionCursor } from "./cursor.js";
import { openSearchSessionDatabase } from "./database.js";
import {
  insertSearchEvidenceHitEvent,
  mapEntitySearchObjectRow,
  upsertSearchChunkHit,
  upsertSearchEntityHit,
  upsertSearchTripleHit,
} from "./hits.js";
import { createEntitySearchSessionId, createSearchSessionId } from "./ids.js";
import { parseSearchResultItem } from "./parsing.js";
import { SEARCH_SESSION_TTL_MS } from "./schema.js";
import {
  deleteSearchSession,
  hasSearchSession,
  readSearchSessionMetadata,
  touchSearchSession,
} from "./store.js";
import type {
  EntitySearchSessionCacheInput,
  EntitySearchSessionInput,
  EntitySearchSessionPage,
  SearchChunkHitInput,
  SearchEntityHitInput,
  SearchEvidenceHitEventInput,
  SearchSessionCacheInput,
  SearchSessionDescriptor,
  SearchSessionInput,
  SearchSessionPage,
  SearchTripleHitInput,
} from "./types.js";

export async function readCachedSearchSessionPage(
  input: SearchSessionCacheInput,
  offset: number,
  limit: number,
): Promise<SearchSessionPage | undefined> {
  const sessionId = createSearchSessionId(input);

  if (!(await hasSearchSession(sessionId, input.archiveKey))) {
    return undefined;
  }

  return await readSearchSessionPage(
    sessionId,
    offset,
    limit,
    input.archiveKey,
  );
}

export async function readCachedEntitySearchSessionPage(
  input: EntitySearchSessionCacheInput,
  offset: number,
  limit: number,
): Promise<EntitySearchSessionPage | undefined> {
  const sessionId = createEntitySearchSessionId(input);

  if (!(await hasSearchSession(sessionId, input.archiveKey))) {
    return undefined;
  }

  return await readEntitySearchSessionPage(
    sessionId,
    offset,
    limit,
    input.archiveKey,
  );
}

export async function createSearchSession(
  input: SearchSessionInput,
): Promise<string> {
  const database = await openSearchSessionDatabase();

  try {
    const now = Date.now();
    const sessionId = createSearchSessionId(input);
    const optionsJSON = JSON.stringify({
      chapters: input.chapters,
      order: input.order,
      types: input.types,
    });

    await database.transaction(async () => {
      await deleteSearchSession(database, sessionId);
      await database.run(
        `
          INSERT INTO search_sessions (
            session_id, archive_key, query, options_json, terms_json, lens,
            match, created_at, expires_at, accessed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          sessionId,
          input.archiveKey,
          input.query,
          optionsJSON,
          JSON.stringify(input.terms),
          input.lens,
          input.match,
          now,
          now + SEARCH_SESSION_TTL_MS,
          now,
        ],
      );

      for (const [index, item] of (input.items ?? []).entries()) {
        await database.run(
          `
            INSERT INTO search_results (session_id, rank, item_json)
            VALUES (?, ?, ?)
          `,
          [sessionId, index, JSON.stringify(item)],
        );
      }
      for (const event of input.evidenceEvents ?? []) {
        await insertSearchEvidenceHitEvent(database, sessionId, event);
      }
      for (const hit of input.entityHits ?? []) {
        await upsertSearchEntityHit(database, sessionId, hit);
      }
      for (const hit of input.tripleHits ?? []) {
        await upsertSearchTripleHit(database, sessionId, hit);
      }
      for (const hit of input.chunkHits ?? []) {
        await upsertSearchChunkHit(database, sessionId, hit);
      }
    });

    return sessionId;
  } finally {
    await database.close();
  }
}

export async function createEntitySearchSession(
  input: EntitySearchSessionInput,
): Promise<string> {
  const database = await openSearchSessionDatabase();

  try {
    const now = Date.now();
    const sessionId = createEntitySearchSessionId(input);
    const optionsJSON = JSON.stringify({
      chapters: input.chapters,
      order: input.order,
      types: input.types,
    });

    await database.transaction(async () => {
      await deleteSearchSession(database, sessionId);
      await database.run(
        `
          INSERT INTO search_sessions (
            session_id, archive_key, query, options_json, terms_json, lens,
            match, created_at, expires_at, accessed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          sessionId,
          input.archiveKey,
          input.query,
          optionsJSON,
          JSON.stringify(input.terms),
          input.lens,
          input.match,
          now,
          now + SEARCH_SESSION_TTL_MS,
          now,
        ],
      );

      for (const event of input.evidenceEvents ?? []) {
        await insertSearchEvidenceHitEvent(database, sessionId, event);
      }
      for (const hit of input.entityHits ?? []) {
        await upsertSearchEntityHit(database, sessionId, hit);
      }
      for (const hit of input.tripleHits ?? []) {
        await upsertSearchTripleHit(database, sessionId, hit);
      }
      for (const hit of input.chunkHits ?? []) {
        await upsertSearchChunkHit(database, sessionId, hit);
      }
    });

    return sessionId;
  } finally {
    await database.close();
  }
}

export async function populateSearchSessionObjectCaches(input: {
  readonly chunkHits?: readonly SearchChunkHitInput[];
  readonly entityHits?: readonly SearchEntityHitInput[];
  readonly evidenceEvents?: readonly SearchEvidenceHitEventInput[];
  readonly sessionId: string;
  readonly tripleHits?: readonly SearchTripleHitInput[];
}): Promise<void> {
  const database = await openSearchSessionDatabase();

  try {
    await database.transaction(async () => {
      for (const event of input.evidenceEvents ?? []) {
        await insertSearchEvidenceHitEvent(database, input.sessionId, event);
      }
      for (const hit of input.entityHits ?? []) {
        await upsertSearchEntityHit(database, input.sessionId, hit);
      }
      for (const hit of input.tripleHits ?? []) {
        await upsertSearchTripleHit(database, input.sessionId, hit);
      }
      for (const hit of input.chunkHits ?? []) {
        await upsertSearchChunkHit(database, input.sessionId, hit);
      }
      await database.run(
        `
          UPDATE search_sessions
          SET object_caches_populated = 1
          WHERE session_id = ?
        `,
        [input.sessionId],
      );
    });
  } finally {
    await database.close();
  }
}

export async function readSearchSessionPage(
  sessionId: string,
  offset: number,
  limit: number,
  expectedArchiveKey?: string,
  expectedCreatedAt?: number,
): Promise<SearchSessionPage> {
  const database = await openSearchSessionDatabase();

  try {
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
      expectedCreatedAt,
    );

    await touchSearchSession(database, sessionId);

    const rows = await database.queryAll(
      `
        SELECT rank, item_json
        FROM search_results
        WHERE session_id = ? AND rank >= ?
        ORDER BY rank
        LIMIT ?
      `,
      [sessionId, offset, limit + 1],
      (row) => ({
        item: parseSearchResultItem(getString(row, "item_json")),
        rank: getNumber(row, "rank"),
      }),
    );
    const items = rows.slice(0, limit).map((row) => row.item);
    const last = rows.at(limit - 1);

    return {
      chapters: session.options.chapters,
      items,
      lens: session.lens,
      match: session.match,
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeSearchSessionCursor(
              sessionId,
              last.rank + 1,
              session.createdAt,
            )
          : null,
      query: session.query,
      sessionId,
      terms: session.terms,
      types: session.options.types,
    };
  } finally {
    await database.close();
  }
}

export async function readEntitySearchSessionPage(
  sessionId: string,
  offset: number,
  limit: number,
  expectedArchiveKey?: string,
  expectedCreatedAt?: number,
): Promise<EntitySearchSessionPage> {
  const database = await openSearchSessionDatabase();

  try {
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
      expectedCreatedAt,
    );

    await touchSearchSession(database, sessionId);

    const rows = await database.queryAll(
      `
        SELECT
          archive_id,
          qid,
          result_score
        FROM search_entity_hits
        WHERE session_id = ?
        ORDER BY result_score DESC, archive_id, qid
        LIMIT ? OFFSET ?
      `,
      [sessionId, limit + 1, offset],
      mapEntitySearchObjectRow,
    );
    const items = rows.slice(0, limit);
    const nextOffset = offset + items.length;

    return {
      chapters: session.options.chapters,
      items,
      lens: session.lens,
      match: session.match,
      nextCursor:
        rows.length > limit
          ? encodeSearchSessionCursor(sessionId, nextOffset, session.createdAt)
          : null,
      query: session.query,
      sessionId,
      terms: session.terms,
      types: session.options.types,
    };
  } finally {
    await database.close();
  }
}

export async function readSearchSessionDescriptor(
  sessionId: string,
  expectedArchiveKey?: string,
): Promise<SearchSessionDescriptor> {
  const database = await openSearchSessionDatabase();

  try {
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
    );

    await touchSearchSession(database, sessionId);

    return {
      chapters: session.options.chapters,
      createdAt: session.createdAt,
      lens: session.lens,
      match: session.match,
      objectCachesPopulated: session.objectCachesPopulated,
      query: session.query,
      sessionId,
      terms: session.terms,
      types: session.options.types,
    };
  } finally {
    await database.close();
  }
}

export async function readSearchSessionMetadataForCursor(
  sessionId: string,
  expectedArchiveKey?: string,
  expectedCreatedAt?: number,
): Promise<SearchSessionDescriptor> {
  const database = await openSearchSessionDatabase();

  try {
    const session = await readSearchSessionMetadata(
      database,
      sessionId,
      expectedArchiveKey,
      expectedCreatedAt,
    );

    await touchSearchSession(database, sessionId);

    return {
      chapters: session.options.chapters,
      createdAt: session.createdAt,
      lens: session.lens,
      match: session.match,
      objectCachesPopulated: session.objectCachesPopulated,
      query: session.query,
      sessionId,
      terms: session.terms,
      types: session.options.types,
    };
  } finally {
    await database.close();
  }
}
