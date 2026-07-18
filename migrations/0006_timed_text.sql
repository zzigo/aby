BEGIN;

CREATE TABLE IF NOT EXISTS aby.timed_text_documents (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  asset_id uuid NOT NULL REFERENCES aby.assets(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_item_id text,
  text_type text NOT NULL CHECK (text_type IN ('lyrics', 'subtitles', 'transcript')),
  language text NOT NULL DEFAULT 'und',
  original_format text NOT NULL CHECK (original_format IN ('plain', 'lrc', 'enhanced-lrc', 'srt', 'vtt', 'ass', 'ttml', 'json')),
  sync_level text NOT NULL CHECK (sync_level IN ('none', 'line', 'word')),
  original_text text,
  plain_text text NOT NULL DEFAULT '',
  offset_ms bigint NOT NULL DEFAULT 0,
  time_scale double precision NOT NULL DEFAULT 1.0 CHECK (time_scale > 0),
  match_confidence double precision CHECK (match_confidence BETWEEN 0 AND 1),
  human_verified boolean NOT NULL DEFAULT false,
  license_status text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  provenance jsonb NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS timed_text_current_asset_type_idx
  ON aby.timed_text_documents(owner_id, asset_id, text_type) WHERE is_current;
CREATE INDEX IF NOT EXISTS timed_text_asset_history_idx
  ON aby.timed_text_documents(owner_id, asset_id, text_type, created_at DESC);

CREATE TABLE IF NOT EXISTS aby.timed_text_cues (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES aby.timed_text_documents(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  start_ms bigint,
  end_ms bigint,
  text text NOT NULL CHECK (length(trim(text)) > 0),
  speaker text,
  words jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, position),
  CHECK (start_ms IS NULL OR start_ms >= 0),
  CHECK (end_ms IS NULL OR (start_ms IS NOT NULL AND end_ms > start_ms))
);

CREATE INDEX IF NOT EXISTS timed_text_cues_time_idx
  ON aby.timed_text_cues(document_id, start_ms, position);

COMMIT;
