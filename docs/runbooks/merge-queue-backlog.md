# Runbook: High Merge Queue Depth

**Alert**: `HighMergeQueueDepth`
**Severity**: Warning
**Prometheus Rule**: `ai_video_merge_queue_depth_gauge > 50`

---

## Description

More than 50 stories are waiting to be merged for more than 10 minutes. The merge queue is backed up, indicating either FFmpeg performance issues or too many concurrent merge requests.

## Impact

- **Immediate**: Stories stuck in `merging` state
- **User-facing**: Multiple users waiting for final video
- **Resource**: FFmpeg is CPU-intensive; queue depth affects system load

## Diagnosis

1. **Check queue depth**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_merge_queue
   ```

2. **Check stories in merging state**:
   ```sql
   SELECT id, user_id, status, updated_at,
          EXTRACT(EPOCH FROM (NOW() - updated_at)) as waiting_seconds
   FROM stories
   WHERE status = 'merging'
   ORDER BY updated_at;
   ```

3. **Check FFmpeg process count**:
   ```bash
   ps aux | grep ffmpeg | wc -l
   ```

4. **Check system load**:
   ```bash
   uptime
   top -bn1 | head -5
   ```

5. **Check disk I/O**:
   ```bash
   iostat -x 1 3
   ```

## Remediation

### If FFmpeg is slow (CPU bound):
1. Reduce concurrent merge operations
2. Limit parallel FFmpeg processes (config.merger.maxConcurrentMerges)
3. Consider lower resolution for batch processing

### If too many merge requests:
1. Throttle new merge requests
2. Prioritize recent stories
3. Queue older stories for background processing

### If disk I/O bottleneck:
1. Move temp files to faster storage (SSD)
2. Check disk space
3. Clean old temp files:
   ```bash
   find /tmp -name "*.mp4" -mtime +1 -delete
   ```

### If memory pressure:
1. Each FFmpeg process uses ~500MB-1GB RAM
2. Limit concurrent merges based on available memory
3. Check for memory leaks in merger code

## Escalation Path

1. **On-call engineer**: Check FFmpeg processes and system load
2. **Platform team**: If infrastructure scaling needed
3. **Principal**: If merge concurrency limits need adjustment

---

*Runbook for AI Video Production Specialist Digital FTE — Merge backlog*
