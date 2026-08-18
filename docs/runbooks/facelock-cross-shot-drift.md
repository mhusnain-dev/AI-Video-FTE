# Runbook: Cross-Shot Face-Lock Drift

**Alert**: `FaceLockCrossShotDrift`
**Severity**: Info
**Prometheus Rule**: `increase(ai_video_facelock_cross_shot_drift_detected_total[1h]) > 0`

---

## Description

Cross-shot Face-Lock consistency report detected drift for a character. While individual shots may pass verification, the character's identity varies across multiple shots in the same story.

## Impact

- **Immediate**: No blocking action — informational only
- **Quality**: Character may look slightly different across shots
- **User-facing**: May notice identity inconsistency in final video

## Diagnosis

1. **Check consistency report**:
   ```sql
   SELECT * FROM face_lock_verifications
   WHERE story_id = '<story_id>'
   AND character_name = '<character_name>'
   ORDER BY verification_timestamp;
   ```

2. **Compare similarity scores across shots**:
   ```sql
   SELECT shot_id, similarity_score, threshold, passed
   FROM face_lock_verifications
   WHERE character_name = '<character_name>'
   AND story_id = '<story_id>'
   ORDER BY verification_timestamp;
   ```

3. **Check cross-shot report generation**:
   ```bash
   docker logs ai-video-fte-api --since 1h 2>&1 | grep -i "cross-shot\|consistency"
   ```

## Remediation

### If drift is minor (scores above threshold):
1. No action needed — this is informational
2. Document for future reference

### If drift is significant:
1. Consider regenerating the most divergent shots
2. Use `POST /merger/partial-regenerate` to re-generate specific shots
3. Re-verify Face-Lock after regeneration

### If systematic drift:
1. Check if the model has identity consistency issues
2. Consider switching to a model with better cross-shot consistency
3. Report to model provider if it's a new regression

## Escalation Path

1. **On-call engineer**: Review the consistency report
2. **Quality team**: If drift affects deliverable quality
3. **Principal**: If re-generation is needed

---

*Runbook for AI Video Production Specialist Digital FTE — Cross-shot consistency*
