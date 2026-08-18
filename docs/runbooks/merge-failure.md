# Runbook: Merge Failure

**Alert**: `MergeFailure`
**Severity**: Critical
**Prometheus Rule**: `increase(ai_video_merge_failure_total[5m]) > 0`

---

## Description

Video merge (FFmpeg assembly) failed for a story. The merger combines individual generated shots into a single video with transitions, audio, and subtitles. A failure here means the story cannot be delivered.

## Impact

- **Immediate**: Story stuck in `merging` or `failed` state
- **User-facing**: The user cannot download the final video
- **Downstream**: Delivery package cannot be created

## Diagnosis

1. **Check story status**:
   ```sql
   SELECT id, status, error_message FROM stories WHERE id = '<story_id>';
   ```

2. **Check merge logs**:
   ```bash
   docker logs ai-video-fte-api --since 10m 2>&1 | grep -i merge
   ```

3. **Check FFmpeg availability**:
   ```bash
   docker exec ai-video-fte-api ffmpeg -version
   ```

4. **Check disk space** (FFmpeg writes temp files):
   ```bash
   df -h /tmp
   ```

5. **Check shot completion status**:
   ```sql
   SELECT id, status, output_url FROM shots WHERE story_id = '<story_id>' ORDER BY order_index;
   ```

6. **Check error type from metrics**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_merge_failure
   ```

## Remediation

### If FFmpeg crashed (out of memory, corrupt input):
1. Check if all shots have `completed` status and valid output URLs
2. Verify input files are accessible and not corrupt
3. Retry the merge:
   ```bash
   curl -X POST http://localhost:3000/merger/merge \
     -H "Content-Type: application/json" \
     -d '{"storyId": "<story_id>", "resolution": "1080p"}'
   ```

### If timeout (large video, slow hardware):
1. Check `maxMergeTimeMs` in config (default varies)
2. Consider reducing resolution or number of shots
3. Increase timeout if hardware allows

### If input files missing:
1. Check if provider webhooks delivered valid output URLs
2. Check delivery URLs haven't expired
3. May need to re-generate affected shots

### If transitions fail:
1. Check the transition type is valid (21 built-in presets)
2. Verify FFmpeg has the `xfade` filter compiled in
3. Try with default crossfade transition

## Escalation Path

1. **On-call engineer**: Check FFmpeg logs and retry
2. **Platform team**: If FFmpeg binary is missing or corrupted
3. **Principal**: If the issue is a systemic provider problem

---

*Runbook for AI Video Production Specialist Digital FTE — Video merge failures*
