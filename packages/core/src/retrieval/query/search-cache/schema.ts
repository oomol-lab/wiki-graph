export const SEARCH_SESSION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS search_sessions (
  session_id TEXT PRIMARY KEY,
  archive_key TEXT NOT NULL,
  query TEXT NOT NULL,
  options_json TEXT NOT NULL,
  terms_json TEXT NOT NULL,
  lens TEXT NOT NULL,
  match TEXT NOT NULL,
  object_caches_populated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_results (
  session_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  item_json TEXT NOT NULL,
  PRIMARY KEY (session_id, rank)
);

CREATE TABLE IF NOT EXISTS predicate_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS search_evidence_hit_events (
  session_id TEXT NOT NULL,
  evidence_kind INTEGER NOT NULL,
  evidence_id TEXT NOT NULL,
  chapter_id INTEGER NOT NULL,
  sentence_index INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (
    session_id,
    evidence_kind,
    evidence_id,
    chapter_id,
    sentence_index
  )
);

CREATE INDEX IF NOT EXISTS idx_search_evidence_hit_events_evidence_rank
ON search_evidence_hit_events(session_id, evidence_kind, evidence_id, score DESC, chapter_id, sentence_index);

CREATE INDEX IF NOT EXISTS idx_search_evidence_hit_events_sentence
ON search_evidence_hit_events(session_id, chapter_id, sentence_index, evidence_kind, evidence_id);

CREATE TABLE IF NOT EXISTS search_entity_hits (
  session_id TEXT NOT NULL,
  qid TEXT NOT NULL,
  property_top_scores_json TEXT NOT NULL DEFAULT '[]',
  evidence_top_scores_json TEXT NOT NULL DEFAULT '[]',
  property_score REAL NOT NULL DEFAULT 0,
  evidence_score REAL NOT NULL DEFAULT 0,
  result_score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, qid)
);

CREATE INDEX IF NOT EXISTS idx_search_entity_hits_rank
ON search_entity_hits(session_id, result_score DESC, qid);

CREATE TABLE IF NOT EXISTS search_triple_hits (
  session_id TEXT NOT NULL,
  subject_qid TEXT NOT NULL,
  predicate_id INTEGER NOT NULL,
  object_qid TEXT NOT NULL,
  evidence_top_scores_json TEXT NOT NULL DEFAULT '[]',
  result_score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, subject_qid, predicate_id, object_qid),
  FOREIGN KEY (predicate_id) REFERENCES predicate_dictionary(id)
);

CREATE INDEX IF NOT EXISTS idx_search_triple_hits_rank
ON search_triple_hits(session_id, result_score DESC, subject_qid, predicate_id, object_qid);

CREATE TABLE IF NOT EXISTS search_chunk_hits (
  session_id TEXT NOT NULL,
  chunk_id INTEGER NOT NULL,
  property_top_scores_json TEXT NOT NULL DEFAULT '[]',
  evidence_top_scores_json TEXT NOT NULL DEFAULT '[]',
  property_score REAL NOT NULL DEFAULT 0,
  evidence_score REAL NOT NULL DEFAULT 0,
  result_score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_search_chunk_hits_rank
ON search_chunk_hits(session_id, result_score DESC, chunk_id);

CREATE INDEX IF NOT EXISTS idx_search_sessions_archive
ON search_sessions(archive_key, session_id);

CREATE INDEX IF NOT EXISTS idx_search_sessions_expires
ON search_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_search_sessions_prune
ON search_sessions(accessed_at DESC, created_at DESC, session_id);
`;

export const SEARCH_RANKING_VERSION = 6;
export const SEARCH_SESSION_MAX_COUNT = 500;
export const SEARCH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SEARCH_TOP_SCORE_COUNT = 10;
