# Runbook: Delivery Package Expired

**Alert**: `DeliveryPackageExpired`
**Severity**: Info
**Prometheus Rule**: `increase(ai_video_delivery_package_created_total[1h]) > 0 and increase(ai_video_delivery_download_total[7d]) == 0`

---

## Description

A delivery package was created but has not been downloaded within 7 days (the signed URL TTL). The user may not have been notified, or the delivery notification failed.

## Impact

- **Immediate**: No blocking action — informational only
- **User-facing**: User may not know their video is ready
- **Cleanup**: Expired URLs are automatically invalidated

## Diagnosis

1. **Check recent deliveries**:
   ```sql
   SELECT id, story_id, video_url, expires_at, created_at
   FROM delivery_packages
   WHERE created_at > NOW() - INTERVAL '7 days'
   ORDER BY created_at DESC;
   ```

2. **Check download count**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_delivery_download
   ```

3. **Check if notification was sent**:
   ```sql
   SELECT * FROM story_events
   WHERE entity_id = '<story_id>'
   AND event_type = 'delivery_ready'
   ORDER BY timestamp DESC;
   ```

## Remediation

### If user was not notified:
1. Manually notify the user that their video is ready
2. Provide the story ID and delivery endpoint

### If user downloaded but metric wasn't recorded:
1. Check the download endpoint implementation
2. Verify metrics recording in the download handler

### If delivery package needs to be regenerated:
1. Regenerate the signed URL:
   ```bash
   curl -X POST http://localhost:3000/merger/delivery \
     -H "Content-Type: application/json" \
     -d '{"storyId": "<story_id>"}'
   ```
2. Share the new signed URL with the user

## Escalation Path

1. **On-call engineer**: Check delivery records and notification logs
2. **Product team**: If notification system needs improvement

---

*Runbook for AI Video Production Specialist Digital FTE — Delivery tracking*
