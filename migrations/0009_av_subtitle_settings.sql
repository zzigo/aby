BEGIN;

ALTER TABLE aby.user_settings
  ADD COLUMN IF NOT EXISTS av_subtitles jsonb NOT NULL
  DEFAULT '{"languages":["en","es"],"includeHearingImpaired":true}'::jsonb;

COMMIT;
