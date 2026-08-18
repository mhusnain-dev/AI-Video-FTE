-- Add model_id column to shots table for dashboard metrics
ALTER TABLE shots ADD COLUMN IF NOT EXISTS model_id VARCHAR(100);

-- Create index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_shots_model_id ON shots (model_id);
