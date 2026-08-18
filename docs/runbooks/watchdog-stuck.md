# Runbook: Watchdog Stuck Dispatches

**Alert**: `WatchdogStuckDispatches`
**Severity**: Warning
**Prometheus Rule**: `ai_video_watchdog_stuck_dispatches_gauge > 10`

---

## Description

The Webhook Watchdog has detected more than 10 dispatches that have been in `dispatched` or `generating` state for longer than the configured timeout (default 10 minutes). These shots may need manual intervention.

## Impact

- **Immediate**: Affected shots are not progressing
- **User-facing**: Story appears stuck
- **Cost**: Stuck shots may be consuming resources without progress

## Diagnosis

1. **Check stuck dispatches**:
   ```sql
   SELECT s.id, s.story_id, s.selected_model_id, s.status,
          s.generation_started_at, s.provider_request_id,
          EXTRACT(EPOCH FROM (NOW() - s.generation_started_at)) as stuck_seconds
   FROM shots s
   WHERE s.status IN ('dispatched', 'generating')
   AND s.generation_started_at < NOW() - INTERVAL '10 minutes'
   ORDER BY s.generation_started_at;
   ```

2. **Check watchdog configuration** (CL-008):
   ```yaml
   dispatch:
     watchdogPollIntervalMs: 30000
     watchdogMaxWaitMs: 600000
   ```

3. **Check provider webhooks**:
   ```bash
   docker logs ai-video-fte-api --since 15m 2>&1 | grep -i "watchdog\|stuck\|timeout"
   ```

4. **Check if provider acknowledged**:
   ```sql
   SELECT * FROM dispatch_records
   WHERE shot_id IN (
     SELECT id FROM shots WHERE status IN ('dispatched', 'generating')
     AND generation_started_at < NOW() - INTERVAL '10 minutes'
   )
   ORDER BY attempt_number;
   ```

## Remediation

### If provider is down (no webhook expected):
1. Wait for watchdog timeout to trigger automatic fallback
2. Or manually trigger fallback:
   ```sql
   UPDATE shots SET status = 'timeout' WHERE id = '<shot_id>';
   ```

### If webhooks are being lost:
1. Check webhook endpoint is accessible from provider network
2. Check nginx/firewall rules for webhook ingress
3. Check provider webhook configuration (URL, secret)

### If stuck due to provider processing:
1. Some providers have long processing times (30+ min for complex shots)
2. Increase watchdog timeout if this is expected
3. Monitor provider dashboard for processing status

### Manual intervention:
1. Force timeout on stuck shots:
   ```sql
   UPDATE shots SET status = 'timeout', error_message = 'Watchdog timeout'
   WHERE status IN ('dispatched', 'generating')
   AND generation_started_at < NOW() - INTERVAL '15 minutes';
   ```
2. This triggers the fallback chain automatically

## Escalation Path

1. **On-call engineer**: Check provider status and watchdog logs
2. **Platform team**: If webhook endpoint is unreachable
3. **Principal**: If manual intervention is needed for specific stories

---

*Runbook for AI Video Production Specialist Digital FTE — Stuck dispatches*
