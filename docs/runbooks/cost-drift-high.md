# Runbook: Cost Drift High

**Alert**: `CostDriftHigh`
**Severity**: Warning
**Prometheus Rule**: `ai_video_cost_drift_percentage_gauge > 20`

---

## Description

Cost drift percentage has exceeded 20% — the rolling average of actual vs. estimated costs is significantly higher than expected. This could indicate runaway generation, pricing changes, or model misconfiguration.

## Impact

- **Immediate**: Story may be paused (if Cost Guard triggers)
- **Budget**: Users may exceed their allocated budget
- **Long-term**: Unsustainable cost trajectory

## Diagnosis

1. **Check drift percentage and affected stories**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_cost_drift
   ```

2. **Query cost records**:
   ```sql
   SELECT story_id, model_id, cost_type,
          SUM(amount_usd) as total_usd, COUNT(*) as count
   FROM cost_records
   WHERE timestamp > NOW() - INTERVAL '1 hour'
   GROUP BY story_id, model_id, cost_type
   ORDER BY total_usd DESC;
   ```

3. **Compare estimated vs actual per story**:
   ```sql
   SELECT s.id, s.total_estimated_cost, s.total_actual_cost,
          (s.total_actual_cost - s.total_estimated_cost) / NULLIF(s.total_estimated_cost, 0) * 100 as drift_pct
   FROM stories s
   WHERE s.status IN ('generating', 'completed')
   ORDER BY drift_pct DESC LIMIT 10;
   ```

4. **Check model pricing** (may have changed):
   ```sql
   SELECT model_id, cost_per_second_usd FROM model_capabilities;
   ```

## Remediation

### If single story causing drift:
1. Check which shots exceeded estimates
2. If generation is still running, consider pausing:
   ```bash
   curl -X POST http://localhost:3000/stories/<id>/cancel \
     -H "Content-Type: application/json" \
     -d '{"userId": "<uuid>"}'
   ```
3. Review and adjust per-story cost ceiling

### If systematic drift across all stories:
1. Check provider pricing announcements
2. Update `costPerSecondUsd` in model registry
3. Recalibrate Cost Guard thresholds if needed (CL-011)

### If excessive retries/regenerations:
1. Check Face-Lock retry rate (each retry costs)
2. Check fallback frequency (cheaper → more expensive models)
3. Adjust retry limits if needed (CL-003, CL-037)

## Escalation Path

1. **On-call engineer**: Check cost records and identify outliers
2. **Finance team**: If drift exceeds 50% (cost impact)
3. **Principal**: If budget ceiling needs adjustment

---

*Runbook for AI Video Production Specialist Digital FTE — Cost monitoring*
