BEGIN;

CREATE TABLE IF NOT EXISTS aby.albums (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  work_id uuid NOT NULL REFERENCES aby.works(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE aby.recordings ADD COLUMN IF NOT EXISTS album_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recordings_album_id_fkey'
      AND conrelid = 'aby.recordings'::regclass
  ) THEN
    ALTER TABLE aby.recordings
      ADD CONSTRAINT recordings_album_id_fkey
      FOREIGN KEY (album_id) REFERENCES aby.albums(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS aby.user_settings (
  owner_id text PRIMARY KEY,
  conversion jsonb NOT NULL DEFAULT '{"container":"ogg","codec":"libvorbis","quality":6}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS albums_owner_work_idx ON aby.albums(owner_id, work_id);
CREATE INDEX IF NOT EXISTS recordings_owner_album_idx ON aby.recordings(owner_id, album_id);

COMMIT;
