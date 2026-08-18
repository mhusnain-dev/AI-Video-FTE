# Runbook: High Shot Timeout Rate

**Alert**: `HighShotTimeoutRate`
**Severity**: Warning
**Prometheus Rule**: `sum(rate(ai_video_shot_timeout_total[5m])) by (model_id) / sum(rate(ai_video_shot_dispatch_total[5m])) by (model_id) > 0.1`

---

## Description

More than 10% of dispatched shots for a model are timing out before the provider returns a result. This indicates provider SLA issues, network problems, or misconfigured timeouts.

## Impact

- **Immediate**: Affected shots trigger fallback to next model
- **Cost**: Timeout + fallback means double-dispatch cost
- **User-facing**: Slower generation, potential all-models-failed

## Diagnosis

1. **Check timeout rate by model**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_shot_timeout
   ```

2. **Check timeout configuration** (CL-007):
   ```yaml
   # config/development.yaml
   dispatch:
     defaultTimeouts:
       veo3: 120000
       runway: 180000
   ```

3. **Check provider response times**:
   ```sql
   SELECT model_id,
          AVG(EXTRACT(EPOCH FROM (generation_completed_at - generation_started_at))) as avg_seconds
   FROM shots
   WHERE status = 'completed'
   AND generation_completed_at > NOW() - INTERVAL '1 hour'
   GROUP BY model_id;
   ```

4. **Check if timeouts are near threshold**:
   ```sql
   SELECT s.id, s.selected_model_id, s.generation_started_at,
          EXTRACT(EPOCH FROM (NOW() - s.generation_started_at)) as elapsed_seconds
   FROM shots s
   WHERE s.status = 'generating'
   AND s.generation_started_at < NOW() - INTERVAL '90 seconds';
   ```

## Remediation

### If provider is slow (not down):
1. Increase timeout for the model (CL-007)
2. Monitor if timeouts resolve with longer wait
3. Consider reducing concurrent dispatches

### If network issues:
1. Check DNS resolution from API container
2. Check proxy/ firewall rules
3. Test direct connectivity to provider API

### If timeouts are near threshold:
1. Increase timeout by 50%
2. Check if provider has performance degradation
3. Consider using a faster model as primary

## Escalation Path

1. **On-call engineer**: Check provider status and network
2. **Platform team**: If infrastructure networking issue
3. **Principal**: If timeout configuration needs adjustment

---

*Runbook for AI Video Production Specialist Digital FTE — Shot timeouts*
