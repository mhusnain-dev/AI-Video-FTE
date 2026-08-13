-- Migration 007: Add reference_image_base64 column to characters table
-- Run after 002_core_tables.sql
-- Stores the actual base64 image data for Face-Lock conditioning

ALTER TABLE characters 
ADD COLUMN IF NOT EXISTS reference_image_base64 TEXT;

-- Add comment for documentation
COMMENT ON COLUMN characters.reference_image_base64 IS 
'Base64 encoded reference image for Face-Lock conditioning. 
Production: consider moving to object storage (S3/GCS) for large images.';

-- Create index if needed for querying (optional, for migrations that check this column)
-- CREATE INDEX IF NOT EXISTS idx_characters_has_ref_image ON characters(reference_image_base64) 
-- WHERE reference_image_base64 IS NOT NULL;
