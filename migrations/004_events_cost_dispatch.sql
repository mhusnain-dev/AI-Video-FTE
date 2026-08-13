-- Migration 004: Story events, cost tracking, dispatch records
-- Run after 003_admission_audit_sacred.sql

-- Story Events (FR-031, NFR-004, CON-004)
-- Immutable event log for all state changes (RPO=0)
CREATE TABLE IF NOT EXISTS story_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(50) NOT NULL, -- 'story', 'shot', 'character'
    entity_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL, -- e.g., 'story_created', 'shot_approved', 'admission_passed', 'generation_completed'
    from_state VARCHAR(50),
    to_state VARCHAR(50),
    payload JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Immutable: no UPDATE/DELETE
    CONSTRAINT story_events_immutable CHECK (false)
);

CREATE INDEX idx_story_events_entity ON story_events(entity_type, entity_id);
CREATE INDEX idx_story_events_type ON story_events(event_type);
CREATE INDEX idx_story_events_timestamp ON story_events(timestamp DESC);
CREATE INDEX idx_story_events_story_shot ON story_events((payload->>'story_id'), (payload->>'shot_id'));

-- Cost tracking (FR-021, FR-033, CL-011, AC-028)
-- Every cost unit attributed to story, shot, model, user, timestamp
CREATE TABLE IF NOT EXISTS cost_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    shot_id UUID REFERENCES shots(id) ON DELETE SET NULL,
    model_id VARCHAR(100) NOT NULL,
    user_id UUID NOT NULL,
    cost_type VARCHAR(50) NOT NULL, -- 'estimated', 'actual', 'drift_alert'
    amount_usd DECIMAL(12, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    metadata JSONB DEFAULT '{}', -- e.g., duration_seconds, drift_percentage
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cost_records_story_id ON cost_records(story_id);
CREATE INDEX idx_cost_records_shot_id ON cost_records(shot_id);
CREATE INDEX idx_cost_records_model_id ON cost_records(model_id);
CREATE INDEX idx_cost_records_user_id ON cost_records(user_id);
CREATE INDEX idx_cost_records_timestamp ON cost_records(timestamp DESC);
CREATE INDEX idx_cost_records_type ON cost_records(cost_type);

-- Dispatch records (FR-017, FR-018, FR-019, FR-020)
-- Tracks all dispatch attempts including fallbacks
CREATE TABLE IF NOT EXISTS dispatch_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shot_id UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    model_id VARCHAR(100) NOT NULL,
    provider_request_id VARCHAR(200),
    status VARCHAR(50) NOT NULL, -- 'pending', 'dispatched', 'completed', 'failed', 'timeout', 'fallback'
    dispatched_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    fallback_from_dispatch_id UUID REFERENCES dispatch_records(id),
    webhook_received_at TIMESTAMPTZ,
    webhook_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispatch_records_shot_id ON dispatch_records(shot_id);
CREATE INDEX idx_dispatch_records_provider_request_id ON dispatch_records(provider_request_id);
CREATE INDEX idx_dispatch_records_status ON dispatch_records(status);

-- Face-Lock verification records (FR-024, FR-025, FR-026, AC-019, AC-020)
CREATE TABLE IF NOT EXISTS face_lock_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    shot_id UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    character_name VARCHAR(200) NOT NULL,
    model_id VARCHAR(100) NOT NULL,
    similarity_score DECIMAL(6, 4) NOT NULL,
    threshold_used DECIMAL(6, 4) NOT NULL,
    passed BOOLEAN NOT NULL,
    retry_count INTEGER DEFAULT 0,
    verification_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_face_lock_verifications_shot_id ON face_lock_verifications(shot_id);
CREATE INDEX idx_face_lock_verifications_character ON face_lock_verifications(character_name);
CREATE INDEX idx_face_lock_verifications_passed ON face_lock_verifications(passed);

-- Trigger to enforce immutability on story_events
CREATE OR REPLACE FUNCTION enforce_story_events_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'story_events is immutable - % not allowed', TG_OP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS story_events_immutable_trigger ON story_events;
CREATE TRIGGER story_events_immutable_trigger
    BEFORE UPDATE OR DELETE ON story_events
    FOR EACH ROW EXECUTE FUNCTION enforce_story_events_immutable();

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_stories_updated_at ON stories;
CREATE TRIGGER update_stories_updated_at
    BEFORE UPDATE ON stories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_shots_updated_at ON shots;
CREATE TRIGGER update_shots_updated_at
    BEFORE UPDATE ON shots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_characters_updated_at ON characters;
CREATE TRIGGER update_characters_updated_at
    BEFORE UPDATE ON characters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sacred_denylist_updated_at ON sacred_denylist;
CREATE TRIGGER update_sacred_denylist_updated_at
    BEFORE UPDATE ON sacred_denylist
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();