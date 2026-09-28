CREATE TABLE IF NOT EXISTS qid_entity (
  qid TEXT PRIMARY KEY,
  wikispine_disambiguation BOOLEAN NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS qid_site (
  qid TEXT NOT NULL REFERENCES qid_entity(qid) ON DELETE CASCADE,
  wiki TEXT NOT NULL,
  source_title TEXT,
  label TEXT,
  description TEXT,
  url TEXT,
  site_exists BOOLEAN NOT NULL DEFAULT FALSE,
  page_id BIGINT,
  revision_id BIGINT,
  is_disambiguation_page BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (qid, wiki)
);
ALTER TABLE qid_site ADD COLUMN IF NOT EXISTS source_title TEXT;
CREATE TABLE IF NOT EXISTS qid_site_disambiguation (
  qid TEXT NOT NULL,
  wiki TEXT NOT NULL,
  page_id BIGINT NOT NULL,
  revision_id BIGINT NOT NULL,
  content_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (qid, wiki, page_id, revision_id),
  FOREIGN KEY (qid, wiki) REFERENCES qid_site(qid, wiki) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS qid_site_disambiguation_profile (
  qid TEXT NOT NULL,
  wiki TEXT NOT NULL,
  page_id BIGINT NOT NULL,
  revision_id BIGINT NOT NULL,
  normalizer_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  result_json JSONB,
  status TEXT NOT NULL,
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (qid, wiki, page_id, revision_id, normalizer_version, model_id),
  FOREIGN KEY (qid, wiki, page_id, revision_id) REFERENCES qid_site_disambiguation(qid, wiki, page_id, revision_id) ON DELETE CASCADE
);
