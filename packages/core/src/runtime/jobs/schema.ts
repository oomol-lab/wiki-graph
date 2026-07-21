export const BUILD_QUEUE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS build_jobs (
  job_id TEXT PRIMARY KEY,
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  chapter_id INTEGER NOT NULL,
  target TEXT NOT NULL,
  current_step TEXT,
  state TEXT NOT NULL,
  queue_rank INTEGER NOT NULL,
  workspace_path TEXT NOT NULL,
  cache_path TEXT NOT NULL,
  log_path TEXT NOT NULL,
  events_path TEXT NOT NULL,
  input_revision INTEGER,
  llm_json TEXT,
  prompt TEXT,
  owner_id TEXT,
  owner_pid INTEGER,
  reading_summary_started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_json TEXT
);

DROP INDEX IF EXISTS idx_build_jobs_active_chapter;

CREATE UNIQUE INDEX IF NOT EXISTS idx_build_jobs_active_knowledge_chapter
ON build_jobs(archive_key, chapter_id)
WHERE target = 'knowledge-graph'
  AND state IN ('queued', 'running', 'canceling', 'paused');

CREATE UNIQUE INDEX IF NOT EXISTS idx_build_jobs_active_reading_chapter
ON build_jobs(archive_key, chapter_id)
WHERE target IN ('reading-graph', 'reading-summary')
  AND state IN ('queued', 'running', 'canceling', 'paused');

CREATE INDEX IF NOT EXISTS idx_build_jobs_queue
ON build_jobs(state, queue_rank, updated_at);

CREATE TABLE IF NOT EXISTS build_worker_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_id TEXT,
  owner_pid INTEGER,
  heartbeat_at INTEGER
);

INSERT OR IGNORE INTO build_worker_lease (id)
VALUES (1);
`;
