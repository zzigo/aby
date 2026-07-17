BEGIN;

ALTER TABLE aby.segments 
  ADD COLUMN IF NOT EXISTS source_context text NOT NULL DEFAULT 'manual_selection';

ALTER TABLE aby.segments
  DROP CONSTRAINT IF EXISTS check_source_context;

ALTER TABLE aby.segments
  ADD CONSTRAINT check_source_context CHECK (source_context IN ('manual_selection', 'mobile_draft', 'studio_validated', 'auto_boundary'));

COMMIT;
