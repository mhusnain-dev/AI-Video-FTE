CREATE TABLE IF NOT EXISTS project_settings (
  project_id VARCHAR(255) PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_settings_project_id ON project_settings (project_id);