BEGIN;

ALTER TABLE aby.segments 
  ADD COLUMN source_context text NOT NULL DEFAULT 'manual_selection' 
  CONSTRAINT check_source_context CHECK (source_context IN ('manual_selection', 'mobile_draft', 'studio_validated', 'auto_boundary'));

COMMIT;
