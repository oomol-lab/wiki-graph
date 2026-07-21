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
      await database.run("DELETE FROM search_object_properties_records");
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
