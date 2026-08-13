-- Migration 005: Delivery and observability
-- Run after 004_events_cost_dispatch.sql

-- Delivery packages (FR-030, FR-029, AC-025)
CREATE TABLE IF NOT EXISTS delivery_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    video_url TEXT NOT NULL, -- Signed URL with 7-day TTL
    resolution VARCHAR(10) NOT NULL,
    format VARCHAR(10) NOT NULL DEFAULT 'mp4',
    subtitles JSONB, -- SubtitlePackage
    metadata JSONB NOT NULL, -- StoryMetadata
    cost_summary JSONB NOT NULL, -- CostSummary
    logs JSONB NOT NULL, -- GenerationLog[]
    verification_reports JSONB NOT NULL, -- VerificationReport[]
    expires_at TIMESTAMPTZ NOT NULL, -- 7-day TTL from creation
    downloaded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_delivery_packages_story_id ON delivery_packages(story_id);
CREATE INDEX idx_delivery_packages_expires_at ON delivery_packages(expires_at);

-- Rate limit tracking (FR-014, CL-012)
-- Sliding window rate limits per model, per user, global
CREATE TABLE IF NOT EXISTS rate_limit_counters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope_type VARCHAR(50) NOT NULL, -- 'model', 'user', 'global', 'project'
    scope_key VARCHAR(200) NOT NULL, -- model_id, user_id, 'global', project_id
    window_start TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scope_type, scope_key, window_start)
);

CREATE INDEX idx_rate_limit_counters_scope ON rate_limit_counters(scope_type, scope_key);
CREATE INDEX idx_rate_limit_counters_window ON rate_limit_counters(window_start);

-- Health metrics snapshots (FR-034, NFR-001, AC-029)
CREATE TABLE IF NOT EXISTS health_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    component VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'healthy', 'degraded', 'unhealthy'
    latency_ms INTEGER,
    details JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_health_metrics_component ON health_metrics(component);
CREATE INDEX idx_health_metrics_timestamp ON health_metrics(timestamp DESC);

-- Model provider webhook signatures for idempotency (EC-008)
CREATE TABLE IF NOT EXISTS webhook_signatures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(100) NOT NULL,
    request_id VARCHAR(200) NOT NULL,
    signature_hash VARCHAR(64) NOT NULL, -- HMAC-SHA256
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, request_id, signature_hash)
);

CREATE INDEX idx_webhook_signatures_provider_request ON webhook_signatures(provider, request_id);