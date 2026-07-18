BEGIN;

WITH parsed AS (
  SELECT
    r.id,
    ((regexp_match(r.title, '^[[:space:]]*([0-9]{1,3})([[:space:]]*[._:)–—-]+[[:space:]]*|[[:space:]]+)(.+)$'))[1])::integer AS track_number,
    btrim((regexp_match(r.title, '^[[:space:]]*([0-9]{1,3})([[:space:]]*[._:)–—-]+[[:space:]]*|[[:space:]]+)(.+)$'))[3]) AS clean_title
  FROM aby.recordings r
  WHERE r.title ~ '^[[:space:]]*[0-9]{1,3}([[:space:]]*[._:)–—-]+[[:space:]]*|[[:space:]]+).+$'
)
UPDATE aby.assets a
SET
  canonical_metadata = jsonb_set(
    jsonb_set(a.canonical_metadata, '{recordingTitle}', to_jsonb(parsed.clean_title), true),
    '{trackNumber}', to_jsonb(parsed.track_number), true
  ),
  updated_at = now()
FROM parsed
WHERE a.recording_id = parsed.id;

WITH parsed AS (
  SELECT
    r.id,
    ((regexp_match(r.title, '^[[:space:]]*([0-9]{1,3})([[:space:]]*[._:)–—-]+[[:space:]]*|[[:space:]]+)(.+)$'))[1])::integer AS track_number,
    btrim((regexp_match(r.title, '^[[:space:]]*([0-9]{1,3})([[:space:]]*[._:)–—-]+[[:space:]]*|[[:space:]]+)(.+)$'))[3]) AS clean_title
  FROM aby.recordings r
  WHERE r.title ~ '^[[:space:]]*[0-9]{1,3}([[:space:]]*[._:)–—-]+[[:space:]]*|[[:space:]]+).+$'
)
UPDATE aby.recordings r
SET
  title = parsed.clean_title,
  metadata = jsonb_set(r.metadata, '{trackNumber}', to_jsonb(parsed.track_number), true),
  updated_at = now()
FROM parsed
WHERE r.id = parsed.id;

COMMIT;
