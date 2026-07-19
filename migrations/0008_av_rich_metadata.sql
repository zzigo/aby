BEGIN;

ALTER TABLE aby.av_catalog_items
  ADD COLUMN IF NOT EXISTS composer text,
  ADD COLUMN IF NOT EXISTS countries jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS edition_notes text;

UPDATE aby.av_catalog_items
SET countries = to_jsonb(regexp_split_to_array(country, '\s*,\s*'))
WHERE country IS NOT NULL
  AND trim(country) <> ''
  AND countries = '[]'::jsonb;

COMMIT;
