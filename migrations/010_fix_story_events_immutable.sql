-- Migration 010: Fix story_events immutable constraint
-- Run after 009_immutable_triggers.sql
-- The original migration 004 added CHECK (false) which blocks ALL operations including INSERT.
-- The trigger already handles UPDATE/DELETE prevention. Remove the invalid constraint.

ALTER TABLE story_events DROP CONSTRAINT IF EXISTS story_events_immutable;

-- Ensure the immutable trigger is applied to story_events (if not already)
DROP TRIGGER IF EXISTS story_events_immutable_trigger ON story_events;
CREATE TRIGGER story_events_immutable_trigger
    BEFORE UPDATE OR DELETE ON story_events
    FOR EACH ROW EXECUTE FUNCTION enforce_immutable_table();