BEGIN;

CREATE TABLE IF NOT EXISTS aby.av_catalog_items (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  provider text NOT NULL DEFAULT 'wasabi' CHECK (provider = 'wasabi'),
  bucket text NOT NULL,
  source_object_key text NOT NULL,
  destination_object_key text NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  original_title text,
  kind text NOT NULL DEFAULT 'film' CHECK (kind IN ('film','episode','video','personal','archive')),
  year integer CHECK (year BETWEEN 1800 AND 2200),
  director text,
  entity text,
  saga text,
  country text,
  languages jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  poster_url text,
  credits jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  technical_metadata jsonb NOT NULL,
  tree_strategy text NOT NULL CHECK (tree_strategy IN ('author','decade','entity','saga','custom')),
  tree_value text NOT NULL,
  state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged','queued','copying','available','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, provider, bucket, source_object_key),
  UNIQUE(owner_id, provider, bucket, destination_object_key)
);

CREATE INDEX IF NOT EXISTS av_catalog_owner_state_idx ON aby.av_catalog_items(owner_id,state,created_at DESC);

CREATE TABLE IF NOT EXISTS aby.storage_operations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  av_item_id uuid NOT NULL REFERENCES aby.av_catalog_items(id) ON DELETE RESTRICT,
  operation text NOT NULL DEFAULT 'copy' CHECK (operation = 'copy'),
  source_object_key text NOT NULL,
  destination_object_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','succeeded','failed','cancelled')),
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  transferred_bytes bigint NOT NULL DEFAULT 0 CHECK (transferred_bytes >= 0),
  speed_bytes_per_second double precision NOT NULL DEFAULT 0 CHECK (speed_bytes_per_second >= 0),
  eta_seconds integer CHECK (eta_seconds >= 0),
  beacon_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE(av_item_id)
);

CREATE INDEX IF NOT EXISTS storage_operations_owner_state_idx ON aby.storage_operations(owner_id,state,created_at DESC);

CREATE TABLE IF NOT EXISTS aby.captures (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  media_kind text NOT NULL CHECK (media_kind IN ('audio','video')),
  asset_id uuid REFERENCES aby.assets(id) ON DELETE RESTRICT,
  av_item_id uuid REFERENCES aby.av_catalog_items(id) ON DELETE RESTRICT,
  start_time_ms bigint NOT NULL CHECK (start_time_ms >= 0),
  end_time_ms bigint NOT NULL,
  label text,
  annotations jsonb NOT NULL DEFAULT '[]'::jsonb,
  share_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time_ms > start_time_ms),
  CHECK ((asset_id IS NOT NULL)::integer + (av_item_id IS NOT NULL)::integer = 1)
);

CREATE INDEX IF NOT EXISTS captures_owner_created_idx ON aby.captures(owner_id,created_at DESC);

COMMIT;
