BEGIN;

CREATE TABLE IF NOT EXISTS aby.media_relocation_operations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  media_kind text NOT NULL CHECK (media_kind IN ('audio','video')),
  entity_type text NOT NULL CHECK (entity_type IN ('album','work','av_item')),
  entity_id text NOT NULL,
  title text NOT NULL,
  source_prefix text NOT NULL,
  destination_prefix text NOT NULL,
  collection_code text,
  entity_slug text,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN (
    'draft','copying','verifying','retirement_pending','retiring','succeeded','failed','cancelled'
  )),
  stage text NOT NULL DEFAULT 'planned',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  transferred_bytes bigint NOT NULL DEFAULT 0 CHECK (transferred_bytes >= 0),
  speed_bytes_per_second double precision NOT NULL DEFAULT 0 CHECK (speed_bytes_per_second >= 0),
  eta_seconds integer CHECK (eta_seconds >= 0),
  beacon_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  verified_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS media_relocation_owner_state_idx
  ON aby.media_relocation_operations(owner_id,state,created_at DESC);

CREATE INDEX IF NOT EXISTS media_relocation_entity_idx
  ON aby.media_relocation_operations(owner_id,media_kind,entity_type,entity_id,created_at DESC);

COMMIT;
