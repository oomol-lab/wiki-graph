import type { Database } from "./database.js";

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS serials (
    id INTEGER PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS serial_states (
    serial_id INTEGER PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    topology_ready INTEGER NOT NULL DEFAULT 0,
    topology_parameter_hash TEXT,
    knowledge_graph_ready INTEGER NOT NULL DEFAULT 0,
    knowledge_graph_parameter_hash TEXT,
    FOREIGN KEY (serial_id) REFERENCES serials(id)
  );

  CREATE TABLE IF NOT EXISTS archive_revisions (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS graph_build_parameters (
    hash TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    language TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
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
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_sentence
  ON chunks(serial_id, sentence_index);

  CREATE INDEX IF NOT EXISTS idx_chunks_serial_id
  ON chunks(serial_id, id);

  CREATE TABLE IF NOT EXISTS chunk_sentences (
    chunk_id INTEGER NOT NULL,
    serial_id INTEGER NOT NULL,
    sentence_index INTEGER NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id),
    PRIMARY KEY (chunk_id, serial_id, sentence_index)
  );

  CREATE TABLE IF NOT EXISTS reading_edges (
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    strength TEXT,
    weight REAL NOT NULL DEFAULT 0.1,
    PRIMARY KEY (from_id, to_id),
    FOREIGN KEY (from_id) REFERENCES chunks(id),
    FOREIGN KEY (to_id) REFERENCES chunks(id)
  );

  CREATE TABLE IF NOT EXISTS snakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    local_snake_id INTEGER NOT NULL,
    size INTEGER NOT NULL,
    first_label TEXT NOT NULL,
    last_label TEXT NOT NULL,
    wordsCount INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0.0,
    UNIQUE(serial_id, group_id, local_snake_id)
  );

  CREATE TABLE IF NOT EXISTS snake_chunks (
    snake_id INTEGER NOT NULL,
    chunk_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (snake_id) REFERENCES snakes(id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id),
    PRIMARY KEY (snake_id, chunk_id)
  );

  CREATE TABLE IF NOT EXISTS snake_edges (
    from_snake_id INTEGER NOT NULL,
    to_snake_id INTEGER NOT NULL,
    weight REAL NOT NULL DEFAULT 0.1,
    PRIMARY KEY (from_snake_id, to_snake_id),
    FOREIGN KEY (from_snake_id) REFERENCES snakes(id),
    FOREIGN KEY (to_snake_id) REFERENCES snakes(id)
  );

  CREATE TABLE IF NOT EXISTS sentence_groups (
    serial_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    start_sentence_index INTEGER NOT NULL,
    end_sentence_index INTEGER NOT NULL,
    PRIMARY KEY (serial_id, group_id, start_sentence_index, end_sentence_index)
  );

  CREATE TABLE IF NOT EXISTS mentions (
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
  );

  CREATE INDEX IF NOT EXISTS idx_mentions_chapter
  ON mentions(chapter_id);

  CREATE INDEX IF NOT EXISTS idx_mentions_chapter_position
  ON mentions(chapter_id, sentence_index, range_start, range_end, id);

  CREATE INDEX IF NOT EXISTS idx_mentions_chapter_qid
  ON mentions(chapter_id, qid);

  CREATE INDEX IF NOT EXISTS idx_mentions_qid
  ON mentions(qid);

  CREATE INDEX IF NOT EXISTS idx_mentions_qid_position
  ON mentions(qid, chapter_id, sentence_index, range_start, range_end, id);

  CREATE INDEX IF NOT EXISTS idx_mentions_surface
  ON mentions(surface);

  CREATE INDEX IF NOT EXISTS idx_mentions_surface_position
  ON mentions(surface, chapter_id, sentence_index, range_start, range_end, id);

  CREATE INDEX IF NOT EXISTS idx_mentions_sentence
  ON mentions(chapter_id, sentence_index);

  CREATE TABLE IF NOT EXISTS mention_links (
    id TEXT PRIMARY KEY,
    source_mention_id TEXT NOT NULL,
    target_mention_id TEXT NOT NULL,
    predicate TEXT NOT NULL,
    confidence REAL,
    note TEXT,
    FOREIGN KEY (source_mention_id) REFERENCES mentions(id),
    FOREIGN KEY (target_mention_id) REFERENCES mentions(id)
  );

  CREATE TABLE IF NOT EXISTS mention_link_evidence_sentences (
    link_id TEXT NOT NULL,
    chapter_id INTEGER NOT NULL,
    sentence_index INTEGER NOT NULL,
    FOREIGN KEY (link_id) REFERENCES mention_links(id),
    PRIMARY KEY (link_id, chapter_id, sentence_index)
  );

  CREATE INDEX IF NOT EXISTS idx_mention_link_evidence_sentences_sentence
  ON mention_link_evidence_sentences(chapter_id, sentence_index);

  CREATE INDEX IF NOT EXISTS idx_mention_links_source
  ON mention_links(source_mention_id);

  CREATE INDEX IF NOT EXISTS idx_mention_links_target
  ON mention_links(target_mention_id);

  CREATE INDEX IF NOT EXISTS idx_mention_links_predicate
  ON mention_links(predicate);

  CREATE INDEX IF NOT EXISTS idx_mention_links_predicate_source_target
  ON mention_links(predicate, source_mention_id, target_mention_id);

  CREATE INDEX IF NOT EXISTS idx_mention_links_predicate_target_source
  ON mention_links(predicate, target_mention_id, source_mention_id);

  CREATE INDEX IF NOT EXISTS idx_mention_links_source_predicate_target
  ON mention_links(source_mention_id, predicate, target_mention_id);

  CREATE INDEX IF NOT EXISTS idx_mention_links_target_predicate_source
  ON mention_links(target_mention_id, predicate, source_mention_id);

  CREATE INDEX IF NOT EXISTS idx_mention_links_source_target_predicate
  ON mention_links(source_mention_id, target_mention_id, predicate);

  CREATE INDEX IF NOT EXISTS idx_reading_edges_target
  ON reading_edges(to_id, from_id);

  CREATE INDEX IF NOT EXISTS idx_snake_edges_target
  ON snake_edges(to_snake_id, from_snake_id);

  CREATE VIEW IF NOT EXISTS chapter_entities AS
  SELECT
    chapter_id,
    qid,
    COUNT(*) AS mention_count
  FROM mentions
  GROUP BY chapter_id, qid;

  CREATE VIEW IF NOT EXISTS book_entities AS
  SELECT
    qid,
    SUM(mention_count) AS mention_count
  FROM chapter_entities
  GROUP BY qid;

  CREATE VIEW IF NOT EXISTS chapter_entity_relations AS
  SELECT
    source_mentions.chapter_id AS chapter_id,
    source_mentions.qid AS subject_qid,
    mention_links.predicate AS predicate,
    target_mentions.qid AS object_qid,
    COUNT(*) AS evidence_count
  FROM mention_links
  JOIN mentions AS source_mentions
    ON source_mentions.id = mention_links.source_mention_id
  JOIN mentions AS target_mentions
    ON target_mentions.id = mention_links.target_mention_id
  WHERE source_mentions.chapter_id = target_mentions.chapter_id
  GROUP BY
    source_mentions.chapter_id,
    source_mentions.qid,
    mention_links.predicate,
    target_mentions.qid;

  CREATE VIEW IF NOT EXISTS book_entity_relations AS
  SELECT
    subject_qid,
    predicate,
    object_qid,
    SUM(evidence_count) AS evidence_count
  FROM chapter_entity_relations
  GROUP BY subject_qid, predicate, object_qid;

  CREATE TABLE IF NOT EXISTS search_index_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS text_sentence_records (
    id INTEGER PRIMARY KEY,
    kind INTEGER NOT NULL,
    chapter_id INTEGER NOT NULL,
    sentence_index INTEGER NOT NULL,
    words_count INTEGER NOT NULL DEFAULT 0,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    byte_length INTEGER NOT NULL DEFAULT 0,
    UNIQUE(kind, chapter_id, sentence_index)
  );

  CREATE INDEX IF NOT EXISTS idx_text_sentence_records_chapter
  ON text_sentence_records(kind, chapter_id, sentence_index);

  CREATE VIRTUAL TABLE IF NOT EXISTS text_sentence_fts USING fts5(
    tier1,
    tier2,
    tier3,
    tokenize='ascii'
  );

  CREATE TABLE IF NOT EXISTS search_object_properties_records (
    id INTEGER PRIMARY KEY,
    owner_kind INTEGER NOT NULL,
    owner_id TEXT NOT NULL,
    property_kind INTEGER NOT NULL,
    chapter_id INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_search_object_properties_records_owner
  ON search_object_properties_records(owner_kind, owner_id);

  CREATE INDEX IF NOT EXISTS idx_search_object_properties_records_chapter
  ON search_object_properties_records(chapter_id, owner_kind, owner_id);

  CREATE VIRTUAL TABLE IF NOT EXISTS search_object_properties_fts USING fts5(
    tier1,
    tier2,
    tier3,
    tokenize='ascii'
  );
`;

export async function initializeDocumentSchema(
  database: Database,
): Promise<void> {
  await ensureGraphBuildParameterTable(database);
  await migrateSerialStateRevision(database);
  await migrateSerialStateKnowledgeGraphReady(database);
  await migrateSerialStateGraphParameterHashes(database);
  await ensureGraphBuildParameterIndexes(database);
}

async function migrateSerialStateRevision(database: Database): Promise<void> {
  const columns = await listTableColumns(database, "serial_states");

  if (columns.has("revision")) {
    return;
  }

  await database.transaction(async () => {
    const transactionColumns = await listTableColumns(
      database,
      "serial_states",
    );

    if (transactionColumns.has("revision")) {
      return;
    }

    await database.run(`
      ALTER TABLE serial_states
      ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
    `);
  });
}

async function ensureGraphBuildParameterTable(
  database: Database,
): Promise<void> {
  await database.run(`
    CREATE TABLE IF NOT EXISTS graph_build_parameters (
      hash TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      language TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

async function ensureGraphBuildParameterIndexes(
  database: Database,
): Promise<void> {
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_serial_states_topology_parameter_hash
    ON serial_states(topology_parameter_hash)
  `);
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_serial_states_knowledge_graph_parameter_hash
    ON serial_states(knowledge_graph_parameter_hash)
  `);
}

async function migrateSerialStateKnowledgeGraphReady(
  database: Database,
): Promise<void> {
  const columns = await listTableColumns(database, "serial_states");

  if (columns.has("knowledge_graph_ready")) {
    return;
  }

  await database.transaction(async () => {
    const transactionColumns = await listTableColumns(
      database,
      "serial_states",
    );

    if (transactionColumns.has("knowledge_graph_ready")) {
      return;
    }

    await database.run(`
      ALTER TABLE serial_states
      ADD COLUMN knowledge_graph_ready INTEGER NOT NULL DEFAULT 0
    `);
  });
}

async function migrateSerialStateGraphParameterHashes(
  database: Database,
): Promise<void> {
  const columns = await listTableColumns(database, "serial_states");
  const parameterColumns = [
    ["topology_parameter_hash", "TEXT"],
    ["knowledge_graph_parameter_hash", "TEXT"],
  ] as const;
  const missingColumns: Array<(typeof parameterColumns)[number]> = [];

  for (const column of parameterColumns) {
    if (!columns.has(column[0])) {
      missingColumns.push(column);
    }
  }

  if (missingColumns.length === 0) {
    return;
  }

  await database.transaction(async () => {
    const transactionColumns = await listTableColumns(
      database,
      "serial_states",
    );

    for (const [name, type] of missingColumns) {
      if (transactionColumns.has(name)) {
        continue;
      }

      await database.run(`
        ALTER TABLE serial_states
        ADD COLUMN ${name} ${type}
      `);
    }
  });
}

async function listTableColumns(
  database: Database,
  table: string,
): Promise<ReadonlySet<string>> {
  const columns = await database.queryAll(
    `PRAGMA table_info(${table})`,
    undefined,
    (row) => String(row.name),
  );

  return new Set(columns);
}
