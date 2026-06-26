export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS serials (
    id INTEGER PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS serial_states (
    serial_id INTEGER PRIMARY KEY,
    topology_ready INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (serial_id) REFERENCES serials(id)
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    generation INTEGER NOT NULL,
    serial_id INTEGER NOT NULL,
    fragment_id INTEGER NOT NULL,
    sentence_index INTEGER NOT NULL,
    label TEXT NOT NULL,
    content TEXT NOT NULL,
    retention TEXT,
    importance TEXT,
    wordsCount INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0.0
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_sentence
  ON chunks(serial_id, fragment_id, sentence_index);

  CREATE TABLE IF NOT EXISTS chunk_sentences (
    chunk_id INTEGER NOT NULL,
    serial_id INTEGER NOT NULL,
    fragment_id INTEGER NOT NULL,
    sentence_index INTEGER NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id),
    PRIMARY KEY (chunk_id, serial_id, fragment_id, sentence_index)
  );

  CREATE TABLE IF NOT EXISTS knowledge_edges (
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

  CREATE TABLE IF NOT EXISTS fragment_groups (
    serial_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    fragment_id INTEGER NOT NULL,
    PRIMARY KEY (serial_id, group_id, fragment_id)
  );

  CREATE TABLE IF NOT EXISTS mentions (
    id TEXT PRIMARY KEY,
    chapter_id INTEGER NOT NULL,
    fragment_id INTEGER NOT NULL,
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

  CREATE INDEX IF NOT EXISTS idx_mentions_qid
  ON mentions(qid);

  CREATE INDEX IF NOT EXISTS idx_mentions_fragment
  ON mentions(fragment_id);

  CREATE INDEX IF NOT EXISTS idx_mentions_sentence
  ON mentions(chapter_id, fragment_id, sentence_index);

  CREATE TABLE IF NOT EXISTS mention_links (
    id TEXT PRIMARY KEY,
    source_mention_id TEXT NOT NULL,
    target_mention_id TEXT NOT NULL,
    predicate TEXT NOT NULL,
    evidence_start INTEGER,
    evidence_end INTEGER,
    confidence REAL,
    note TEXT,
    FOREIGN KEY (source_mention_id) REFERENCES mentions(id),
    FOREIGN KEY (target_mention_id) REFERENCES mentions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_mention_links_source
  ON mention_links(source_mention_id);

  CREATE INDEX IF NOT EXISTS idx_mention_links_target
  ON mention_links(target_mention_id);

  CREATE INDEX IF NOT EXISTS idx_mention_links_predicate
  ON mention_links(predicate);

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
`;
