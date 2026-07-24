import type { Database } from "../../../document/database.js";
import type { Document } from "../../../document/index.js";
import { createSearchTokenPlan } from "./tokenizer.js";
import {
  createSearchIndexFingerprint,
  readSearchIndexFingerprintFromDatabase,
} from "./fingerprint.js";
import {
  insertFtsRecord,
  insertSearchObjectPropertyRecord,
  insertTextSentenceRecord,
} from "./write.js";
import type { SearchIndexInput, SearchIndexProgressReporter } from "./types.js";
import { SEARCH_INDEX_VERSION } from "./types.js";

export type ArchiveIndexProjection = SearchIndexInput;
export type SearchIndexWriteBatch = SearchIndexInput;
export interface SearchIndexWriteCounters {
  readonly objectDone: number;
  readonly textDone: number;
}

export async function writeArchiveIndexProjection(
  document: Document,
  projection: ArchiveIndexProjection,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  await ensureSearchIndex(document, projection, progress);
}

export async function ensureSearchIndex(
  document: Document,
  input: SearchIndexInput,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  const chaptersRevision = await document.serials.getChaptersRevision();

  await document.writeSearchIndexDatabase(async (database) => {
    const fingerprint = createSearchIndexFingerprint(input);
    const indexedFingerprint =
      await readSearchIndexFingerprintFromDatabase(database);

    if (indexedFingerprint === fingerprint) {
      return;
    }

    await database.transaction(async () => {
      await progress?.({ phase: "clearing" });
      await database.run("DELETE FROM text_sentence_fts");
      await database.run("DELETE FROM search_object_properties_fts");
      await database.run("DELETE FROM text_sentence_records");
      await database.run("DELETE FROM search_object_properties_records");
      await database.run("DELETE FROM index_dirty_chapters");
      await database.run("DELETE FROM search_index_state");

      let textDone = 0;
      for (const record of input.textSentences) {
        const plan = createSearchTokenPlan(record.text);
        const rowId = await insertTextSentenceRecord(database, record);

        await insertFtsRecord(database, "text_sentence_fts", rowId, plan);
        textDone += 1;
        await progress?.({
          done: textDone,
          phase: "indexing-text",
          total: input.textSentences.length,
          unit: "sentence",
        });
      }

      let objectDone = 0;
      for (const record of input.objectProperties) {
        const plan = createSearchTokenPlan(record.text);
        const rowId = await insertSearchObjectPropertyRecord(database, record);

        await insertFtsRecord(
          database,
          "search_object_properties_fts",
          rowId,
          plan,
        );
        objectDone += 1;
        await progress?.({
          done: objectDone,
          phase: "indexing-objects",
          total: input.objectProperties.length,
          unit: "object",
        });
      }

      await progress?.({ phase: "finalizing" });
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('version', ?)
        `,
        [SEARCH_INDEX_VERSION],
      );
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('fingerprint', ?)
        `,
        [fingerprint],
      );
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('chaptersRevision', ?)
        `,
        [String(chaptersRevision)],
      );
    });
  });
}

export async function replaceSearchIndex(
  document: Document,
  batches: AsyncIterable<SearchIndexWriteBatch>,
  fingerprint: string,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  const chaptersRevision = await document.serials.getChaptersRevision();

  await document.writeSearchIndexDatabase(async (database) => {
    await prepareSearchIndexReplacement(database, progress);

    let counters: SearchIndexWriteCounters = { objectDone: 0, textDone: 0 };
    for await (const batch of batches) {
      counters = await writeSearchIndexBatch(
        database,
        batch,
        counters,
        progress,
      );
    }

    await finalizeSearchIndexReplacement(
      database,
      fingerprint,
      chaptersRevision,
      progress,
    );
  });
}

export async function prepareSearchIndexReplacement(
  database: Database,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  await database.transaction(async () => {
    await progress?.({ phase: "clearing" });
    await database.run("DELETE FROM text_sentence_fts");
    await database.run("DELETE FROM search_object_properties_fts");
    await database.run("DELETE FROM text_sentence_records");
    await database.run("DELETE FROM search_object_properties_records");
    await database.run("DELETE FROM index_dirty_chapters");
    await database.run("DELETE FROM search_index_state");
    await database.run(
      `
        INSERT INTO index_dirty_chapters(archive_id, chapter_id, updated_at)
        VALUES (0, 0, ?)
      `,
      [Date.now()],
    );
  });
}

export async function writeSearchIndexBatch(
  database: Database,
  batch: SearchIndexWriteBatch,
  counters: SearchIndexWriteCounters,
  progress?: SearchIndexProgressReporter,
): Promise<SearchIndexWriteCounters> {
  let { objectDone, textDone } = counters;

  await database.transaction(async () => {
    for (const record of batch.textSentences) {
      const plan = createSearchTokenPlan(record.text);
      const rowId = await insertReplacementTextSentenceRecord(database, record);

      await insertFtsRecord(database, "text_sentence_fts", rowId, plan);
      textDone += 1;
      await progress?.({
        done: textDone,
        phase: "indexing-text",
        unit: "sentence",
      });
    }

    for (const record of batch.objectProperties) {
      const plan = createSearchTokenPlan(record.text);
      const rowId = await insertSearchObjectPropertyRecord(database, record);

      await insertFtsRecord(
        database,
        "search_object_properties_fts",
        rowId,
        plan,
      );
      objectDone += 1;
      await progress?.({
        done: objectDone,
        phase: "indexing-objects",
        unit: "object",
      });
    }
  });

  return { objectDone, textDone };
}

async function insertReplacementTextSentenceRecord(
  database: Database,
  record: SearchIndexWriteBatch["textSentences"][number],
): Promise<number> {
  await database.run(
    `
      INSERT INTO text_sentence_records (
        archive_id, kind, chapter_id, sentence_index, words_count, byte_offset, byte_length
      )
      VALUES (?, ?, ?, ?, ?, 0, 0)
    `,
    [
      record.archiveId,
      record.kind,
      record.chapterId,
      record.sentenceIndex,
      record.wordsCount,
    ],
  );

  return await database.getLastInsertRowId();
}

export async function finalizeSearchIndexReplacement(
  database: Database,
  fingerprint: string,
  chaptersRevision: number,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  await database.transaction(async () => {
    await progress?.({ phase: "finalizing" });
    await database.run("DELETE FROM index_dirty_chapters");
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('version', ?)
      `,
      [SEARCH_INDEX_VERSION],
    );
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('fingerprint', ?)
      `,
      [fingerprint],
    );
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('chaptersRevision', ?)
      `,
      [String(chaptersRevision)],
    );
  });
}
