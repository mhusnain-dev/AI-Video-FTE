-- Migration 002: Core tables - stories, shots, characters
-- Run after 001_extensions.sql

-- Stories table (FR-001, FR-003, FR-004, FR-031)
CREATE TABLE IF NOT EXISTS stories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    brief JSONB NOT NULL, -- StoryBrief (narrative, duration, aspect_ratio, character_refs, style_refs, negative_prompts)
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9',
    target_duration_seconds INTEGER NOT NULL,
    resolution VARCHAR(10) NOT NULL DEFAULT '1080p',
    global_transition JSONB, -- TransitionConfig
    audio_config JSONB, -- AudioConfig
    total_estimated_cost DECIMAL(12, 4) DEFAULT 0,
    total_actual_cost DECIMAL(12, 4) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_stories_user_id ON stories(user_id);
CREATE INDEX idx_stories_status ON stories(status);
CREATE INDEX idx_stories_created_at ON stories(created_at DESC);

-- Shots table (FR-002, FR-003, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021)
CREATE TABLE IF NOT EXISTS shots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    visual_description TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    camera_motion TEXT NOT NULL,
    characters TEXT[] NOT NULL DEFAULT '{}', -- Character names from registry
    key_objects TEXT[] NOT NULL DEFAULT '{}',
    key_actions TEXT[] NOT NULL DEFAULT '{}',
    audio_cues TEXT[],
    style_references TEXT[],
    negative_prompts TEXT[],
    model_override VARCHAR(100), -- Manual model pin (FR-008)
    transition JSONB, -- TransitionConfig per shot
    status VARCHAR(50) NOT NULL DEFAULT 'planned',
    selected_model_id VARCHAR(100),
    estimated_cost DECIMAL(12, 4) DEFAULT 0,
    actual_cost DECIMAL(12, 4) DEFAULT 0,
    provider_request_id VARCHAR(200),
    generation_started_at TIMESTAMPTZ,
    generation_completed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    fallback_from_shot_id UUID REFERENCES shots(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shots_story_id ON shots(story_id);
CREATE INDEX idx_shots_status ON shots(status);
CREATE INDEX idx_shots_order ON shots(story_id, order_index);
CREATE INDEX idx_shots_provider_request_id ON shots(provider_request_id);

-- Character registry (FR-022, NFR-006, CON-003, CON-004)
-- Biometric embeddings encrypted at rest via Vault Transit (application layer)
CREATE TABLE IF NOT EXISTS characters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    face_embedding_vector VECTOR(512), -- ArcFace 512-dim, stored encrypted via app
    voice_embedding_vector VECTOR(256), -- ECAPA-TDNN 256-dim, stored encrypted via app
    reference_image_hash VARCHAR(64) NOT NULL, -- SHA-256 for deduplication
    reference_image_url TEXT, -- Optional: reference to stored image
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(story_id, name)
);

CREATE INDEX idx_characters_user_id ON characters(user_id);
CREATE INDEX idx_characters_story_id ON characters(story_id);
CREATE INDEX idx_characters_face_embedding ON characters USING ivfflat (face_embedding_vector vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_characters_voice_embedding ON characters USING ivfflat (voice_embedding_vector vector_cosine_ops) WITH (lists = 100);