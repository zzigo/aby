BEGIN;

CREATE SCHEMA IF NOT EXISTS aby;

CREATE TABLE IF NOT EXISTS aby.works (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aby.recordings (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  work_id uuid NOT NULL REFERENCES aby.works(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aby.assets (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  recording_id uuid NOT NULL REFERENCES aby.recordings(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('wasabi', 's3', 'local-fixture')),
  bucket text,
  object_key text NOT NULL,
  original_filename text NOT NULL,
  original_object_key text NOT NULL,
  original_directory text NOT NULL DEFAULT '',
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  import_batch text,
  imported_at timestamptz NOT NULL,
  technical_metadata jsonb NOT NULL,
  canonical_metadata jsonb NOT NULL,
  provenance jsonb NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'quarantined', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider, bucket, object_key),
  UNIQUE (owner_id, checksum_sha256)
);

CREATE TABLE IF NOT EXISTS aby.segments (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  asset_id uuid NOT NULL REFERENCES aby.assets(id) ON DELETE RESTRICT,
  start_time_ms bigint NOT NULL CHECK (start_time_ms >= 0),
  end_time_ms bigint NOT NULL,
  channel_selection integer[] NOT NULL DEFAULT '{}',
  fade_in_ms integer NOT NULL DEFAULT 0 CHECK (fade_in_ms >= 0),
  fade_out_ms integer NOT NULL DEFAULT 0 CHECK (fade_out_ms >= 0),
  label text,
  state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate', 'accepted', 'rejected')),
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time_ms > start_time_ms),
  CHECK (fade_in_ms + fade_out_ms <= end_time_ms - start_time_ms)
);

CREATE TABLE IF NOT EXISTS aby.ingest_candidates (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('wasabi', 's3', 'local-fixture')),
  bucket text,
  object_key text NOT NULL,
  original_filename text NOT NULL,
  original_directory text NOT NULL DEFAULT '',
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  technical_metadata jsonb NOT NULL,
  candidate_metadata jsonb NOT NULL,
  provenance jsonb NOT NULL,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'committed', 'rejected')),
  committed_asset_id uuid REFERENCES aby.assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aby.annotations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  asset_id uuid REFERENCES aby.assets(id) ON DELETE RESTRICT,
  segment_id uuid REFERENCES aby.segments(id) ON DELETE RESTRICT,
  start_time_ms bigint,
  end_time_ms bigint,
  channel_selection integer[] NOT NULL DEFAULT '{}',
  body jsonb NOT NULL,
  classification text,
  color text,
  state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate', 'accepted', 'rejected')),
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (asset_id IS NOT NULL OR segment_id IS NOT NULL),
  CHECK (start_time_ms IS NULL OR (end_time_ms IS NOT NULL AND end_time_ms > start_time_ms))
);

CREATE TABLE IF NOT EXISTS aby.jobs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  analyze boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  result jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aby.analysis (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  asset_id uuid REFERENCES aby.assets(id) ON DELETE RESTRICT,
  segment_id uuid REFERENCES aby.segments(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES aby.jobs(id) ON DELETE RESTRICT,
  tool text NOT NULL,
  tool_version text NOT NULL,
  parameters jsonb NOT NULL,
  source_asset_checksum text NOT NULL,
  summary jsonb NOT NULL,
  artifact_object_key text,
  confidence double precision CHECK (confidence BETWEEN 0 AND 1),
  review_state text NOT NULL DEFAULT 'candidate' CHECK (review_state IN ('candidate', 'accepted', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (asset_id IS NOT NULL OR segment_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS aby.embeddings (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  asset_id uuid REFERENCES aby.assets(id) ON DELETE RESTRICT,
  segment_id uuid REFERENCES aby.segments(id) ON DELETE RESTRICT,
  analysis_id uuid NOT NULL REFERENCES aby.analysis(id) ON DELETE RESTRICT,
  model text NOT NULL,
  model_version text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions > 0),
  qdrant_collection text NOT NULL,
  qdrant_point_id text NOT NULL,
  source_asset_checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qdrant_collection, qdrant_point_id),
  CHECK (asset_id IS NOT NULL OR segment_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS aby.transcripts (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  asset_id uuid NOT NULL REFERENCES aby.assets(id) ON DELETE RESTRICT,
  job_id uuid REFERENCES aby.jobs(id) ON DELETE RESTRICT,
  language text,
  text_content text NOT NULL,
  webvtt_object_key text,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aby.working_sets (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  title text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aby.working_set_items (
  working_set_id uuid NOT NULL REFERENCES aby.working_sets(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('work', 'recording', 'asset', 'segment')),
  entity_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (working_set_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS aby.external_identifiers (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('work', 'recording', 'asset', 'segment')),
  entity_id uuid NOT NULL,
  authority text NOT NULL,
  external_id text NOT NULL,
  canonical_url text,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (authority, external_id, entity_type)
);

CREATE TABLE IF NOT EXISTS aby.relations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  predicate text NOT NULL,
  object_context text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  provenance jsonb NOT NULL,
  state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, predicate, object_context, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS recordings_owner_work_idx ON aby.recordings(owner_id, work_id);
CREATE INDEX IF NOT EXISTS assets_owner_recording_idx ON aby.assets(owner_id, recording_id);
CREATE INDEX IF NOT EXISTS segments_owner_asset_time_idx ON aby.segments(owner_id, asset_id, start_time_ms);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON aby.jobs(state, available_at, created_at);
CREATE INDEX IF NOT EXISTS relations_subject_idx ON aby.relations(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS relations_object_idx ON aby.relations(object_context, object_type, object_id);

COMMIT;

