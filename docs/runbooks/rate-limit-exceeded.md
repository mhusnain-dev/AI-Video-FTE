# Runbook: Rate Limit Exceeded

**Alert**: `RateLimitExceeded`
**Severity**: Warning
**Prometheus Rule**: `increase(ai_video_rate_limit_exceeded_total[5m]) > 10`

---

## Description

Rate limit gate has blocked more than 10 requests in 5 minutes. The FTE enforces per-model, per-user, and global rate limits to prevent provider throttling and ensure fair usage.

## Impact

- **Immediate**: Shot dispatches are held with estimated wait time
- **User-facing**: Stories pause at the rate limit gate
- **No data loss**: Shots retry after rate limit window resets

## Diagnosis

1. **Check which limits are hit**:
   ```sql
   SELECT * FROM rate_limit_counters
   WHERE timestamp > NOW() - INTERVAL '1 hour'
   ORDER BY timestamp DESC;
   ```

2. **Check per-model limits**:
   ```sql
   SELECT model_id, COUNT(*) as dispatches
   FROM dispatch_records
   WHERE timestamp > NOW() - INTERVAL '1 minute'
   GROUP BY model_id;
   ```

3. **Check per-user limits**:
   ```sql
   SELECT user_id, COUNT(*) as dispatches
   FROM dispatch_records
   WHERE timestamp > NOW() - INTERVAL '1 minute'
   GROUP BY user_id;
   ```

4. **Check global limits**:
   ```sql
   SELECT COUNT(*) as total_dispatches
   FROM dispatch_records
   WHERE timestamp > NOW() - INTERVAL '1 minute';
   ```

## Remediation

### If legitimate high usage:
1. Wait for rate limit window to reset (usually 1 minute)
2. Consider increasing limits if usage is sustained and expected (CL-012):
   ```yaml
   admission:
     rateLimit:
       perModel:
         <model_id>: 20  # Increased from default
       perUser: 10
       global: 50
   ```

### If abuse/runaway loop:
1. Check for infinite retry loops in dispatch
2. Check for stuck consumers re-processing messages
3. Kill any runaway consumer processes

### If provider rate limiting:
1. Check provider dashboard for 429 responses
2. Spread dispatches across time (add jitter)
3. Consider using multiple API keys if allowed

## Escalation Path

1. **On-call engineer**: Check rate limit counters and identify bottleneck
2. **Platform team**: If infrastructure-level throttling
3. **Principal**: If rate limits need adjustment for business needs

---

*Runbook for AI Video Production Specialist Digital FTE — Rate limiting*
