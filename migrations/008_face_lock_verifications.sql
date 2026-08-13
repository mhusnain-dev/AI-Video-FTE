-- Migration 008: Face-Lock verification results table
-- Stores verification results for post-generation Face-Lock checks
-- Modifies existing table created by migration 004 to add 008 schema columns
-- Run after 004_events_cost_dispatch.sql

-- Add missing columns from 008 schema to existing table
-- The table already has: story_id, shot_id, character_name, model_id,
-- similarity_score, threshold_used, passed, retry_count, verification_timestamp
-- We need to add: id (PK), similarity, threshold, created_at

ALTER TABLE face_lock_verifications
    ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();

-- Make id the primary key if not already
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'face_lock_verifications'
        AND constraint_type = 'PRIMARY KEY'
    ) THEN
        ALTER TABLE face_lock_verifications ADD PRIMARY KEY (id);
    END IF;
END $$;

-- Add similarity column (alias for similarity_score for 008 schema compatibility)
ALTER TABLE face_lock_verifications
    ADD COLUMN IF NOT EXISTS similarity DECIMAL(5, 4);

-- Add threshold column (alias for threshold_used for 008 schema compatibility)
ALTER TABLE face_lock_verifications
    ADD COLUMN IF NOT EXISTS threshold DECIMAL(5, 4);

-- Add created_at column (alias for verification_timestamp for 008 schema compatibility)
ALTER TABLE face_lock_verifications
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS idx_face_lock_verifications_shot_id ON face_lock_verifications(shot_id);
CREATE INDEX IF NOT EXISTS idx_face_lock_verifications_character ON face_lock_verifications(character_name);
CREATE INDEX IF NOT EXISTS idx_face_lock_verifications_model ON face_lock_verifications(model_id);
CREATE INDEX IF NOT EXISTS idx_face_lock_verifications_passed ON face_lock_verifications(passed);
CREATE INDEX IF NOT EXISTS idx_face_lock_verifications_created_at ON face_lock_verifications(created_at);

COMMENT ON TABLE face_lock_verifications IS
'Stores Face-Lock post-generation verification results per character per shot';

COMMENT ON COLUMN face_lock_verifications.similarity IS 'Cosine similarity between generated frame embedding and reference embedding (0-1)';
COMMENT ON COLUMN face_lock_verifications.threshold IS 'Configured threshold for this model/character (per CL-002)';
COMMENT ON COLUMN face_lock_verifications.passed IS 'Whether verification passed (similarity >= threshold)';
COMMENT ON COLUMN face_lock_verifications.retry_count IS 'Number of regeneration attempts for this verification';