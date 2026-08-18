# Runbook: Face-Lock Failure Rate High

**Alert**: `FaceLockFailureRateHigh`
**Severity**: Warning
**Prometheus Rule**: `sum(rate(ai_video_facelock_verification_total{result="failed"}[5m])) / sum(rate(ai_video_facelock_verification_total[5m])) > 0.2`

---

## Description

Face-Lock verification failure rate has exceeded 20% for a character/model combination. More than 1 in 5 generated frames fail to match the reference face embedding above the similarity threshold.

## Impact

- **Immediate**: Excessive auto-regenerations (each costs money + time)
- **User-facing**: Slower story completion, potential shot failures
- **Quality**: Character identity may not persist across shots

## Diagnosis

1. **Check failure rate by character and model**:
   ```sql
   SELECT character_name, model_id,
          COUNT(*) as total,
          SUM(CASE WHEN passed = false THEN 1 ELSE 0 END) as failed,
          AVG(similarity_score) as avg_score
   FROM face_lock_verifications
   WHERE verification_timestamp > NOW() - INTERVAL '1 hour'
   GROUP BY character_name, model_id;
   ```

2. **Check thresholds** (CL-002):
   ```bash
   curl -s http://localhost:3000/api/sacred-guard/thresholds | jq .
   ```

3. **Check regeneration count**:
   ```sql
   SELECT shot_id, retry_count, status
   FROM shots
   WHERE retry_count > 0
   AND story_id IN (SELECT id FROM stories WHERE status = 'generating');
   ```

4. **Compare reference embeddings**:
   ```sql
   SELECT character_name, embedding_quality, face_detected
   FROM characters
   WHERE story_id = '<story_id>';
   ```

## Remediation

### If reference image quality is poor:
1. Ask user to upload a clearer, front-facing photo
2. Ensure face detection succeeded on upload
3. Check lighting/angle of reference vs generated frames

### If threshold too strict for specific model:
1. Lower the per-model threshold (CL-002):
   ```yaml
   # config/development.yaml
   faceLock:
     defaultPerModelThresholds:
       <model_id>: 0.75  # Lowered from 0.80
   ```
2. Restart the API service

### If model consistently produces poor identity:
1. Check if the model supports `reference_conditioning` capability
2. Consider switching to a model with better Face-Lock support
3. Report to model provider if it's a new degradation

### If auto-regeneration is excessive:
1. Check if retry limit (default 2) is being hit
2. Review the auto-regeneration logic in `faceLockVerification.ts`
3. Consider reducing max retries to limit cost

## Escalation Path

1. **On-call engineer**: Check reference image quality and thresholds
2. **ML team**: If model degradation is suspected
3. **Principal**: If the issue requires model or threshold changes

---

*Runbook for AI Video Production Specialist Digital FTE — Face-Lock quality*
