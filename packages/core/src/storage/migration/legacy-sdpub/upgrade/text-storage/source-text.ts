import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

import type { Database } from "../../../../../document/database.js";
import type { LegacyFragmentRecord } from "./types.js";

export async function writeLegacySourceTextStream(
  database: Database,
  workspacePath: string,
  input: {
    readonly fragments: readonly LegacyFragmentRecord[];
    readonly serialId: number;
    readonly text: string;
  },
): Promise<void> {
  await database.run(`
    CREATE TABLE IF NOT EXISTS text_sentence_records (
      id INTEGER PRIMARY KEY,
      kind INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      words_count INTEGER NOT NULL DEFAULT 0,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      byte_length INTEGER NOT NULL DEFAULT 0,
      UNIQUE(kind, chapter_id, sentence_index)
    )
  `);
  await mkdir(join(workspacePath, "texts", "source"), { recursive: true });
  await writeFile(
    join(workspacePath, "texts", "source", `${input.serialId}.txt`),
    input.text,
    "utf8",
  );
  await database.run(
    `
      DELETE FROM text_sentence_records
      WHERE kind = 1 AND chapter_id = ?
    `,
    [input.serialId],
  );

  let byteOffset = 0;
  let sentenceIndex = 0;

  for (const fragment of input.fragments) {
    for (const sentence of fragment.content.sentences) {
      const byteLength = Buffer.byteLength(sentence.text, "utf8");

      await database.run(
        `
          INSERT OR REPLACE INTO text_sentence_records (
            kind,
            chapter_id,
            sentence_index,
            words_count,
            byte_offset,
            byte_length
          )
          VALUES (1, ?, ?, ?, ?, ?)
        `,
        [
          input.serialId,
          sentenceIndex,
          sentence.wordsCount,
          byteOffset,
          byteLength,
        ],
      );

      byteOffset += byteLength;
      sentenceIndex += 1;
    }
  }
}
