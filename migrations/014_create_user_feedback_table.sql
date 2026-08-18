CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  story_id UUID NOT NULL REFERENCES stories(id),
  shot_id UUID,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  flag_reason VARCHAR(50),
  flag_comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_story_id ON user_feedback (story_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback (user_id);
