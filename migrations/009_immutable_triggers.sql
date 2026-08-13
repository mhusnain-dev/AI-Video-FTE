-- Migration 009: Immutable triggers for audit trail tables
-- Run after 008_face_lock_verifications.sql

-- Immutable trigger function (reusable)
CREATE OR REPLACE FUNCTION enforce_immutable_table()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '% is immutable - % not allowed', TG_TABLE_NAME, TG_OP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply immutable trigger to sacred_entity_audit
DROP TRIGGER IF EXISTS sacred_entity_audit_immutable_trigger ON sacred_entity_audit;
CREATE TRIGGER sacred_entity_audit_immutable_trigger
    BEFORE UPDATE OR DELETE ON sacred_entity_audit
    FOR EACH ROW EXECUTE FUNCTION enforce_immutable_table();

-- Apply immutable trigger to health_metrics
DROP TRIGGER IF EXISTS health_metrics_immutable_trigger ON health_metrics;
CREATE TRIGGER health_metrics_immutable_trigger
    BEFORE UPDATE OR DELETE ON health_metrics
    FOR EACH ROW EXECUTE FUNCTION enforce_immutable_table();

-- Apply immutable trigger to webhook_signatures
DROP TRIGGER IF EXISTS webhook_signatures_immutable_trigger ON webhook_signatures;
CREATE TRIGGER webhook_signatures_immutable_trigger
    BEFORE UPDATE OR DELETE ON webhook_signatures
    FOR EACH ROW EXECUTE FUNCTION enforce_immutable_table();

-- Apply immutable trigger to webhook_unrecognized_log
DROP TRIGGER IF EXISTS webhook_unrecognized_log_immutable_trigger ON webhook_unrecognized_log;
CREATE TRIGGER webhook_unrecognized_log_immutable_trigger
    BEFORE UPDATE OR DELETE ON webhook_unrecognized_log
    FOR EACH ROW EXECUTE FUNCTION enforce_immutable_table();

-- Create audit_archives table (referenced by AuditArchiverConsumer) with immutable trigger
CREATE TABLE IF NOT EXISTS audit_archives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    object_key VARCHAR(500) NOT NULL,
    storage_backend VARCHAR(20) NOT NULL, -- 's3', 'gcs', 'local'
    bucket_name VARCHAR(200) NOT NULL,
    event_count INTEGER NOT NULL,
    bytes BIGINT NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_event_id UUID NOT NULL,
    last_event_id UUID NOT NULL
);

CREATE INDEX idx_audit_archives_archived_at ON audit_archives(archived_at DESC);
CREATE INDEX idx_audit_archives_storage_backend ON audit_archives(storage_backend);

DROP TRIGGER IF EXISTS audit_archives_immutable_trigger ON audit_archives;
CREATE TRIGGER audit_archives_immutable_trigger
    BEFORE UPDATE OR DELETE ON audit_archives
    FOR EACH ROW EXECUTE FUNCTION enforce_immutable_table();

-- Create alerts table (referenced by AlertEvaluatorConsumer) with immutable trigger
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- 'critical', 'warning', 'info'
    labels JSONB NOT NULL DEFAULT '{}',
    annotations JSONB NOT NULL DEFAULT '{}',
    fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    runbook VARCHAR(200),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID
);

CREATE INDEX idx_alerts_fired_at ON alerts(fired_at DESC);
CREATE INDEX idx_alerts_name ON alerts(name);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_acknowledged ON alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

DROP TRIGGER IF EXISTS alerts_immutable_trigger ON alerts;
CREATE TRIGGER alerts_immutable_trigger
    BEFORE UPDATE OR DELETE ON alerts
    FOR EACH ROW EXECUTE FUNCTION enforce_immutable_table();