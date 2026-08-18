# Runbook: Model Fallback Triggered

**Alert**: `ModelFallbackTriggered`
**Severity**: Info
**Prometheus Rule**: `increase(ai_video_shot_fallback_total[1h]) > 0`

---

## Description

Model fallback was triggered — the primary model failed or timed out, and the shot was re-dispatched to the next model in the priority chain. This is a normal recovery mechanism but may indicate primary model issues if frequent.

## Impact

- **Immediate**: Shot continues with a different model (no user action needed)
- **Quality**: Different model may produce slightly different style/quality
- **Cost**: Fallback model may have different pricing

## Diagnosis

1. **Check fallback frequency**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_shot_fallback
   ```

2. **Check fallback details**:
   ```sql
   SELECT * FROM dispatch_records
   WHERE status = 'fallback'
   AND timestamp > NOW() - INTERVAL '1 hour'
   ORDER BY timestamp DESC;
   ```

3. **Check primary model health**:
   ```sql
   SELECT model_id, COUNT(*) as failures
   FROM dispatch_records
   WHERE status IN ('failed', 'timeout')
   AND timestamp > NOW() - INTERVAL '1 hour'
   GROUP BY model_id
   ORDER BY failures DESC;
   ```

## Remediation

### If infrequent (1-2 per hour):
1. Normal operation — no action needed
2. Monitor for increasing frequency

### If frequent for one model:
1. Check model provider status page
2. Check API key validity
3. Consider changing the default primary model
4. Adjust model priority list (CL-006)

### If all models triggering fallback:
1. Check infrastructure (network, DNS, proxy)
2. Check if all provider API keys are valid
3. Check rate limits aren't causing cascading failures

## Escalation Path

1. **On-call engineer**: Review fallback patterns
2. **Platform team**: If infrastructure issue causing fallbacks
3. **Principal**: If model priority needs adjustment

---

*Runbook for AI Video Production Specialist Digital FTE — Model fallback monitoring*
