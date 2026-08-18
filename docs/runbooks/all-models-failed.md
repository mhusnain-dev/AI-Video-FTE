# Runbook: All Models Failed for Shot

**Alert**: `AllModelsFailedForShot`
**Severity**: Critical
**Prometheus Rule**: `increase(ai_video_shot_dispatch_total{status="failed"}[5m]) > 0 and increase(ai_video_shot_dispatch_total{model_id=~".+"}[5m]) == increase(ai_video_shot_dispatch_total{status="failed"}[5m])`

---

## Description

All available video generation models have failed for a shot dispatch. The fallback chain has been exhausted — every eligible model attempted and returned an error or timed out.

## Impact

- **Immediate**: Shot is stuck in `failed` state, story cannot progress
- **User-facing**: The user sees a generation failure and must take action
- **Cost**: No charges incurred (failed dispatches don't bill)

## Diagnosis

1. **Check which models were tried**:
   ```sql
   SELECT * FROM dispatch_records
   WHERE shot_id = '<shot_id>'
   ORDER BY attempt_number;
   ```

2. **Check provider status pages**:
   - Google Veo 3: status.cloud.google.com
   - Runway: status.runwayml.com

3. **Check API keys are valid**:
   ```bash
   # Verify key exists (don't print it)
   test -n "$VEO_API_KEY" && echo "Veo key set" || echo "Veo key MISSING"
   test -n "$RUNWAY_API_KEY" && echo "Runway key set" || echo "Runway key MISSING"
   ```

4. **Check timeout configuration**:
   ```sql
   SELECT s.*, d.* FROM shots s
   JOIN dispatch_records d ON s.id = d.shot_id
   WHERE s.id = '<shot_id>';
   ```

5. **Check admission results** (shot may have failed admission on all attempts):
   ```sql
   SELECT * FROM admission_audit
   WHERE shot_id = '<shot_id>' AND gate = 'rate_limit'
   ORDER BY timestamp DESC;
   ```

## Remediation

### If provider is down:
1. Check provider status page for outage
2. Wait for provider recovery
3. Re-dispatch the shot:
   ```bash
   curl -X POST http://localhost:3000/api/shots/<shot_id>/regenerate \
     -H "Content-Type: application/json" \
     -d '{"userId": "<uuid>"}'
   ```

### If API keys expired/invalid:
1. Update keys in Vault:
   ```bash
   vault kv put secret/fte/api-keys VEO_API_KEY="new-key"
   ```
2. Restart the API service
3. Re-dispatch the shot

### If rate limited on all models:
1. Check rate limit status:
   ```sql
   SELECT * FROM rate_limit_counters
   WHERE user_id = '<user_id>' AND timestamp > NOW() - INTERVAL '1 hour';
   ```
2. Wait for rate limit window to reset
3. Or increase limits if appropriate (CL-012)

### If timeout on all models:
1. Check if the shot duration exceeds model maximum
2. Split the shot into shorter segments
3. Increase timeout defaults in config

## Escalation Path

1. **On-call engineer**: Check provider status and API key validity
2. **Platform team**: If infrastructure issue (network, DNS, proxy)
3. **Principal**: If the issue requires scope reduction or budget increase

---

*Runbook for AI Video Production Specialist Digital FTE — All models exhausted*
