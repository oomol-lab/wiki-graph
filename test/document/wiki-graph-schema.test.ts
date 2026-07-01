import { describe, expect, it } from "vitest";

import {
  Database,
  DirectoryDocument,
  SCHEMA_SQL,
} from "../../src/document/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("document/wiki-graph-schema", () => {
  it("migrates serial state knowledge graph readiness", async () => {
    await withTempDir("spinedigest-wiki-graph-schema-", async (path) => {
      const database = await Database.open(`${path}/database.db`);

      try {
        await database.run(`
          CREATE TABLE serials (
            id INTEGER PRIMARY KEY
          )
        `);
        await database.run(`
          CREATE TABLE serial_states (
            serial_id INTEGER PRIMARY KEY,
            topology_ready INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (serial_id) REFERENCES serials(id)
          )
        `);
        await database.run("INSERT INTO serials (id) VALUES (1)");
        await database.run(
          "INSERT INTO serial_states (serial_id, topology_ready) VALUES (1, 1)",
        );
      } finally {
        await database.close();
      }

      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await expect(
            openedDocument.serials.getById(1),
          ).resolves.toStrictEqual({
            id: 1,
            knowledgeGraphReady: false,
            topologyReady: true,
          });

          await openedDocument.serials.setKnowledgeGraphReady(1);
          await expect(
            openedDocument.serials.getById(1),
          ).resolves.toStrictEqual({
            id: 1,
            knowledgeGraphReady: true,
            topologyReady: true,
          });
        });
      } finally {
        await document.release();
      }
    });
  });

  it("creates mention evidence tables, indexes, and entity relation views", async () => {
    await withTempDir("spinedigest-wiki-graph-schema-", async (path) => {
      const database = await Database.open(`${path}/database.db`, SCHEMA_SQL);

      try {
        await database.run("INSERT INTO serials (id) VALUES (1)");
        await database.run(
          `
            INSERT INTO mentions (
              id,
              chapter_id,
              fragment_id,
              sentence_index,
              range_start,
              range_end,
              surface,
              qid,
              confidence,
              note
            ) VALUES
              ('m1', 1, 10, 0, 0, 2, '恩典', 'Q205194', 0.95, '神学概念'),
              ('m2', 1, 10, 0, 5, 9, '自由意志', 'Q9476', 0.9, NULL),
              ('m3', 1, 11, 0, 0, 3, '伯拉纠', 'Q162593', 0.92, NULL)
          `,
        );
        await database.run(
          `
            INSERT INTO mention_links (
              id,
              source_mention_id,
              target_mention_id,
              predicate,
              confidence,
              note
            ) VALUES
              ('l1', 'm3', 'm2', 'discusses', 0.8, '同段论述'),
              ('l2', 'm3', 'm2', 'discusses', 0.75, NULL),
              ('l3', 'm1', 'm2', 'requires', 0.7, NULL)
          `,
        );
        await database.run(
          `
            INSERT INTO mention_link_evidence_sentences (
              link_id,
              chapter_id,
              fragment_id,
              sentence_index
            ) VALUES
              ('l1', 1, 10, 0),
              ('l2', 1, 10, 1),
              ('l3', 1, 10, 0)
          `,
        );

        await expect(listObjectNames(database, "table")).resolves.toEqual(
          expect.arrayContaining([
            "mentions",
            "mention_links",
            "mention_link_evidence_sentences",
          ]),
        );
        await expect(listObjectNames(database, "index")).resolves.toEqual(
          expect.arrayContaining([
            "idx_chunks_sentence",
            "idx_chunks_serial_fragment_id",
            "idx_chunks_serial_id",
            "idx_mentions_chapter",
            "idx_mentions_chapter_position",
            "idx_mentions_chapter_qid",
            "idx_mentions_fragment",
            "idx_mentions_qid",
            "idx_mentions_qid_position",
            "idx_mentions_sentence",
            "idx_mentions_surface",
            "idx_mentions_surface_position",
            "idx_mention_link_evidence_sentences_sentence",
            "idx_mention_links_predicate",
            "idx_mention_links_predicate_source_target",
            "idx_mention_links_predicate_target_source",
            "idx_mention_links_source",
            "idx_mention_links_source_predicate_target",
            "idx_mention_links_source_target_predicate",
            "idx_mention_links_target",
            "idx_mention_links_target_predicate_source",
            "idx_reading_edges_target",
            "idx_snake_edges_target",
          ]),
        );
        await expect(listObjectNames(database, "view")).resolves.toEqual(
          expect.arrayContaining([
            "book_entities",
            "book_entity_relations",
            "chapter_entities",
            "chapter_entity_relations",
          ]),
        );
        await expect(
          database.queryAll(
            `
              SELECT chapter_id, qid, mention_count
              FROM chapter_entities
              ORDER BY qid
            `,
            undefined,
            (row) => ({
              chapterId: Number(row.chapter_id),
              mentionCount: Number(row.mention_count),
              qid: String(row.qid),
            }),
          ),
        ).resolves.toStrictEqual([
          { chapterId: 1, mentionCount: 1, qid: "Q162593" },
          { chapterId: 1, mentionCount: 1, qid: "Q205194" },
          { chapterId: 1, mentionCount: 1, qid: "Q9476" },
        ]);
        await expect(
          database.queryAll(
            `
              SELECT subject_qid, predicate, object_qid, evidence_count
              FROM book_entity_relations
              ORDER BY subject_qid, predicate, object_qid
            `,
            undefined,
            (row) => ({
              evidenceCount: Number(row.evidence_count),
              objectQid: String(row.object_qid),
              predicate: String(row.predicate),
              subjectQid: String(row.subject_qid),
            }),
          ),
        ).resolves.toStrictEqual([
          {
            evidenceCount: 2,
            objectQid: "Q9476",
            predicate: "discusses",
            subjectQid: "Q162593",
          },
          {
            evidenceCount: 1,
            objectQid: "Q9476",
            predicate: "requires",
            subjectQid: "Q205194",
          },
        ]);
      } finally {
        await database.close();
      }
    });
  });
});

async function listObjectNames(
  database: Database,
  type: "index" | "table" | "view",
): Promise<readonly string[]> {
  return await database.queryAll(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = ?
      ORDER BY name
    `,
    [type],
    (row) => String(row.name),
  );
}
