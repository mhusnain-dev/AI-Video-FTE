# Runbook: No Stories Created

**Alert**: `NoStoriesCreated`
**Severity**: Info
**Prometheus Rule**: `increase(ai_video_stories_created_total[1h]) == 0`

---

## Description

No stories have been created in the last hour. This may indicate the ingestion pipeline is stalled, the frontend is disconnected, or simply low usage.

## Impact

- **Immediate**: No blocking action — informational only
- **User-facing**: May indicate users cannot reach the application
- **Business**: No new work being submitted

## Diagnosis

1. **Check ingestion API health**:
   ```bash
   curl -s http://localhost:3000/health/ingestion
   ```

2. **Check if API is responding**:
   ```bash
   curl -s http://localhost:3000/health/live | jq '.status'
   ```

3. **Check frontend is accessible**:
   ```bash
   curl -s http://localhost:5173 | head -5
   ```

4. **Check recent API requests**:
   ```bash
   docker logs ai-video-fte-api --since 1h 2>&1 | grep "POST.*stories" | wc -l
   ```

5. **Check nginx proxy** (production):
   ```bash
   docker logs nginx --since 1h 2>&1 | grep "POST.*stories" | wc -l
   ```

## Remediation

### If legitimate low usage:
1. No action needed — this is informational
2. Monitor for extended periods of no activity

### If frontend is down:
1. Check frontend container/process
2. Restart if needed:
   ```bash
   docker restart ai-video-fte-frontend
   ```

### If API is down:
1. Check API health endpoint
2. Restart if needed:
   ```bash
   docker restart ai-video-fte-api
   ```

### If nginx proxy issue:
1. Check nginx configuration
2. Check TLS certificates
3. Restart nginx:
   ```bash
   docker restart nginx
   ```

### If database connection issue:
1. Check database health
2. Refer to "Database Unavailable" runbook

## Escalation Path

1. **On-call engineer**: Check service health endpoints
2. **Platform team**: If infrastructure issue
3. **Product team**: If it's a usage/business concern

---

*Runbook for AI Video Production Specialist Digital FTE — Ingestion monitoring*
