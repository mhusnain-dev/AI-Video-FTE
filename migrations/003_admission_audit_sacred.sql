-- Migration 003: Admission audit logs and Sacred Guard
-- Run after 002_core_tables.sql

-- Admission audit log (FR-015, FR-032, AC-027)
-- Immutable audit record for every admission decision
CREATE TABLE IF NOT EXISTS admission_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    shot_id UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    gate VARCHAR(50) NOT NULL, -- 'moderation', 'sacred_guard', 'cost_guard', 'rate_limit'
    decision VARCHAR(20) NOT NULL, -- 'pass', 'fail', 'warn'
    reason TEXT,
    category VARCHAR(100),
    rule_triggered VARCHAR(200),
    full_context JSONB NOT NULL, -- Complete AdmissionContext snapshot
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Immutable: no UPDATE/DELETE allowed after insert
    CONSTRAINT admission_audit_immutable CHECK (false) -- Enforced via trigger
);

CREATE INDEX idx_admission_audit_story_id ON admission_audit(story_id);
CREATE INDEX idx_admission_audit_shot_id ON admission_audit(shot_id);
CREATE INDEX idx_admission_audit_gate ON admission_audit(gate);
CREATE INDEX idx_admission_audit_timestamp ON admission_audit(timestamp DESC);

-- Sacred Guard denylist (FR-011, FR-012, CON-001, CON-002)
-- Multi-stage denylist: exact, transliterated, fuzzy, visual/semantic
CREATE TABLE IF NOT EXISTS sacred_denylist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_name VARCHAR(500) NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- 'person', 'title', 'variant'
    match_type VARCHAR(50) NOT NULL, -- 'exact', 'transliterated', 'fuzzy', 'visual_semantic'
    embedding VECTOR(512), -- For visual/semantic matching
    added_by UUID NOT NULL, -- User ID who added
    approved_by_1 UUID NOT NULL, -- First approver (dual-auth)
    approved_by_2 UUID, -- Second approver (dual-auth) - NULL until approved
    approved_at_1 TIMESTAMPTZ NOT NULL,
    approved_at_2 TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sacred_denylist_active ON sacred_denylist(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_sacred_denylist_entity_name ON sacred_denylist USING gin (entity_name gin_trgm_ops);
CREATE INDEX idx_sacred_denylist_embedding ON sacred_denylist USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Sacred Entity Audit (FR-032, CL-009, AC-010, AC-033)
-- Immutable log of all denylist changes and appeals
CREATE TABLE IF NOT EXISTS sacred_entity_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    denylist_id UUID REFERENCES sacred_denylist(id),
    action VARCHAR(50) NOT NULL, -- 'add', 'remove', 'appeal', 'appeal_approved', 'appeal_rejected'
    requested_by UUID NOT NULL,
    approver_1 UUID,
    approver_2 UUID,
    reason TEXT,
    previous_state JSONB,
    new_state JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sacred_entity_audit_denylist_id ON sacred_entity_audit(denylist_id);
CREATE INDEX idx_sacred_entity_audit_timestamp ON sacred_entity_audit(timestamp DESC);

-- Trigger to enforce immutability on admission_audit
CREATE OR REPLACE FUNCTION enforce_admission_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'admission_audit is immutable - % not allowed', TG_OP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admission_audit_immutable_trigger ON admission_audit;
CREATE TRIGGER admission_audit_immutable_trigger
    BEFORE UPDATE OR DELETE ON admission_audit
    FOR EACH ROW EXECUTE FUNCTION enforce_admission_audit_immutable();