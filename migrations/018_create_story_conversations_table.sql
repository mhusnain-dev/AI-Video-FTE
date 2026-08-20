CREATE TABLE IF NOT EXISTS story_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL UNIQUE REFERENCES stories(id) ON DELETE CASCADE,
  summaries JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_conversations_updated_at ON story_conversations (updated_at DESC);