-- Migration: webhook unrecognized log table
-- For tracking unrecognized webhook payloads (EC-007)

CREATE TABLE IF NOT EXISTS webhook_unrecognized_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(100) NOT NULL,
    request_id VARCHAR(200) NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_unrecognized_provider ON webhook_unrecognized_log(provider);
CREATE INDEX idx_webhook_unrecognized_request_id ON webhook_unrecognized_log(request_id);
CREATE INDEX idx_webhook_unrecognized_received_at ON webhook_unrecognized_log(received_at DESC);