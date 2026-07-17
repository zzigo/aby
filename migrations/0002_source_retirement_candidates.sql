BEGIN;

CREATE TABLE IF NOT EXISTS aby.source_retirement_candidates (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  preview_id uuid NOT NULL REFERENCES aby.ingest_candidates(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('wasabi', 's3')),
  bucket text NOT NULL,
  source_object_key text NOT NULL,
  canonical_object_key text NOT NULL,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate', 'approved', 'retired', 'rejected')),
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, bucket, source_object_key)
);

CREATE INDEX IF NOT EXISTS source_retirement_state_idx
  ON aby.source_retirement_candidates(state, created_at);

COMMIT;
