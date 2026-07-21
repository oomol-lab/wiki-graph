import { join } from "path";

import type { SqlBindValue } from "../../../../../document/database.js";
import { Database } from "../../../../../document/database.js";
import { listTableNames } from "../database.js";
import type { SentenceIndexRemap } from "./types.js";

export async function migrateLegacySentenceReferences(
  workspacePath: string,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const database = await Database.open(join(workspacePath, "database.db"));

  try {
    const tableNames = await listTableNames(database);

    await database.transaction(async () => {
      if (tableNames.has("chunks")) {
        await migrateLegacyChunks(database, remaps);
      }
      if (tableNames.has("chunk_sentences")) {
        await migrateLegacyChunkSentences(database, remaps);
      }
      if (tableNames.has("mentions")) {
        await migrateLegacyMentions(database, remaps);
      }
      if (tableNames.has("mention_link_evidence_sentences")) {
        await migrateLegacyMentionLinkEvidenceSentences(database, remaps);
      }
      if (tableNames.has("fragment_groups")) {
        await migrateLegacyFragmentGroups(database, remaps);
      }
    });
  } finally {
    await database.close();
  }
}
async function migrateLegacyChunks(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT *
      FROM chunks
      ORDER BY id
    `,
    undefined,
    (row) => row,
  );

  await database.run("ALTER TABLE chunks RENAME TO legacy_chunks");
  await database.run(`
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      generation INTEGER NOT NULL,
      serial_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      retention TEXT,
      importance TEXT,
      wordsCount INTEGER NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0.0
    )
  `);

  for (const row of rows) {
    const serialId = Number(row.serial_id);
    const sentenceIndex = remapSentenceIndex(
      remaps,
      serialId,
      Number(row.fragment_id),
      Number(row.sentence_index),
    );

    await database.run(
      `
        INSERT INTO chunks (
          id, generation, serial_id, sentence_index, label, content,
          retention, importance, wordsCount, weight
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        row.id ?? null,
        row.generation ?? 0,
        serialId,
        sentenceIndex,
        row.label ?? "",
        row.content ?? "",
        row.retention ?? null,
        row.importance ?? null,
        row.wordsCount ?? 0,
        row.weight ?? 0,
      ],
    );
  }

  await database.run("DROP TABLE legacy_chunks");
}

async function migrateLegacyChunkSentences(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT chunk_id, serial_id, fragment_id, sentence_index
      FROM chunk_sentences
    `,
    undefined,
    (row) => row,
  );

  await database.run("DROP TABLE chunk_sentences");
  await database.run(`
    CREATE TABLE chunk_sentences (
      chunk_id INTEGER NOT NULL,
      serial_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES chunks(id),
      PRIMARY KEY (chunk_id, serial_id, sentence_index)
    )
  `);

  for (const row of rows) {
    const serialId = Number(row.serial_id);

    await database.run(
      `
        INSERT OR IGNORE INTO chunk_sentences (
          chunk_id, serial_id, sentence_index
        )
        VALUES (?, ?, ?)
      `,
      [
        getRequiredSqlBindValue(row.chunk_id),
        serialId,
        remapSentenceIndex(
          remaps,
          serialId,
          Number(row.fragment_id),
          Number(row.sentence_index),
        ),
      ],
    );
  }
}

async function migrateLegacyMentions(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT *
      FROM mentions
      ORDER BY id
    `,
    undefined,
    (row) => row,
  );

  await database.run("ALTER TABLE mentions RENAME TO legacy_mentions");
  await database.run(`
    CREATE TABLE mentions (
      id TEXT PRIMARY KEY,
      chapter_id INTEGER NOT NULL,
      sentence_index INTEGER,
      range_start INTEGER NOT NULL,
      range_end INTEGER NOT NULL,
      surface TEXT NOT NULL,
      qid TEXT NOT NULL,
      confidence REAL,
      note TEXT,
      FOREIGN KEY (chapter_id) REFERENCES serials(id)
    )
  `);

  for (const row of rows) {
    const chapterId = Number(row.chapter_id);
    const sentenceIndex =
      row.sentence_index === null || row.sentence_index === undefined
        ? null
        : remapSentenceIndex(
            remaps,
            chapterId,
            Number(row.fragment_id),
            Number(row.sentence_index),
          );

    await database.run(
      `
        INSERT OR REPLACE INTO mentions (
          id, chapter_id, sentence_index, range_start, range_end, surface,
          qid, confidence, note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        getRequiredSqlBindValue(row.id),
        chapterId,
        sentenceIndex,
        row.range_start ?? 0,
        row.range_end ?? 0,
        row.surface ?? "",
        row.qid ?? "",
        row.confidence ?? null,
        row.note ?? null,
      ],
    );
  }

  await database.run("DROP TABLE legacy_mentions");
}

async function migrateLegacyMentionLinkEvidenceSentences(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT link_id, chapter_id, fragment_id, sentence_index
      FROM mention_link_evidence_sentences
    `,
    undefined,
    (row) => row,
  );

  await database.run("DROP TABLE mention_link_evidence_sentences");
  await database.run(`
    CREATE TABLE mention_link_evidence_sentences (
      link_id TEXT NOT NULL,
      chapter_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      FOREIGN KEY (link_id) REFERENCES mention_links(id),
      PRIMARY KEY (link_id, chapter_id, sentence_index)
    )
  `);

  for (const row of rows) {
    const chapterId = Number(row.chapter_id);

    await database.run(
      `
        INSERT OR IGNORE INTO mention_link_evidence_sentences (
          link_id, chapter_id, sentence_index
        )
        VALUES (?, ?, ?)
      `,
      [
        getRequiredSqlBindValue(row.link_id),
        chapterId,
        remapSentenceIndex(
          remaps,
          chapterId,
          Number(row.fragment_id),
          Number(row.sentence_index),
        ),
      ],
    );
  }
}

async function migrateLegacyFragmentGroups(
  database: Database,
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
): Promise<void> {
  const rows = await database.queryAll(
    `
      SELECT serial_id, group_id, fragment_id
      FROM fragment_groups
      ORDER BY serial_id, group_id, fragment_id
    `,
    undefined,
    (row) => row,
  );

  await database.run("DROP TABLE fragment_groups");
  await database.run(`
    CREATE TABLE sentence_groups (
      serial_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      start_sentence_index INTEGER NOT NULL,
      end_sentence_index INTEGER NOT NULL,
      PRIMARY KEY (serial_id, group_id, start_sentence_index, end_sentence_index)
    )
  `);

  for (const row of rows) {
    const serialId = Number(row.serial_id);
    const startSentenceIndex = remapSentenceIndex(
      remaps,
      serialId,
      Number(row.fragment_id),
      0,
    );
    const endSentenceIndex = findFragmentEndSentenceIndex(
      remaps,
      serialId,
      Number(row.fragment_id),
    );

    await database.run(
      `
        INSERT OR IGNORE INTO sentence_groups (
          serial_id, group_id, start_sentence_index, end_sentence_index
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        serialId,
        getRequiredSqlBindValue(row.group_id),
        startSentenceIndex,
        endSentenceIndex,
      ],
    );
  }
}

function remapSentenceIndex(
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
  serialId: number,
  fragmentId: number,
  sentenceIndex: number,
): number {
  const remap = remaps.get(serialId);
  const mapped = remap?.get(fragmentId, sentenceIndex);

  if (mapped === undefined) {
    throw new Error(
      `Cannot remap legacy sentence ${serialId}:${fragmentId}:${sentenceIndex}.`,
    );
  }

  return mapped;
}

function findFragmentEndSentenceIndex(
  remaps: ReadonlyMap<number, SentenceIndexRemap>,
  serialId: number,
  fragmentId: number,
): number {
  let sentenceIndex = 0;
  let last: number | undefined;

  while (true) {
    const mapped = remaps.get(serialId)?.get(fragmentId, sentenceIndex);

    if (mapped === undefined) {
      break;
    }

    last = mapped;
    sentenceIndex += 1;
  }

  return last ?? remapSentenceIndex(remaps, serialId, fragmentId, 0);
}
function getRequiredSqlBindValue(
  value: SqlBindValue | undefined,
): SqlBindValue {
  if (value === undefined) {
    throw new TypeError("Expected a SQLite bind value.");
  }

  return value;
}
