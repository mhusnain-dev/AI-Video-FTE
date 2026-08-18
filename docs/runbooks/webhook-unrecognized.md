# Runbook: Webhook Unrecognized Spike

**Alert**: `WebhookUnrecognizedSpike`
**Severity**: Warning
**Prometheus Rule**: `increase(ai_video_webhook_unrecognized_total[5m]) > 10`

---

## Description

Spike in unrecognized webhooks received — more than 10 webhooks in 5 minutes could not be matched to a pending shot dispatch. This may indicate a provider API change, duplicate delivery, or misconfiguration.

## Impact

- **Immediate**: Unrecognized webhooks are logged but not processed
- **No data loss**: Pending shots continue waiting for their correct webhook
- **Possible issue**: Provider may be sending callbacks for old/expired requests

## Diagnosis

1. **Check unrecognized webhook count**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_webhook_unrecognized
   ```

2. **Check webhook processing stats**:
   ```bash
   curl -s http://localhost:3000/webhook/stats?windowMs=3600000
   ```

3. **Check recent webhook logs**:
   ```bash
   docker logs ai-video-fte-api --since 10m 2>&1 | grep -i webhook
   ```

4. **Check if provider changed request format**:
   - Compare webhook payload structure with expected `WebhookPayload` type
   - Check provider's API changelog

5. **Check for HMAC verification failures**:
   ```bash
   docker logs ai-video-fte-api --since 10m 2>&1 | grep -i "signature\|hmac\|verify"
   ```

## Remediation

### If duplicate delivery (idempotency):
1. The webhook handler is idempotent — duplicates are safe to ignore
2. Check if provider is retrying due to slow 200 responses
3. Ensure webhook endpoint responds within 5 seconds

### If HMAC signature mismatch:
1. Check if webhook secret was rotated on provider side
2. Update the HMAC secret in configuration
3. Restart the API service

### If provider API changed:
1. Check provider's API changelog for breaking changes
2. Update the webhook parser in `webhookHandler.ts`
3. Test with the provider's test endpoint:
   ```bash
   curl -X POST http://localhost:3000/webhook/test/<provider> \
     -H "Content-Type: application/json" \
     -d '{...test payload...}'
   ```

### If orphaned requests:
1. Old dispatches may have timed out but provider still sent callback
2. These are safely ignored by the idempotency guard
3. No action required

## Escalation Path

1. **On-call engineer**: Check webhook logs and provider status
2. **Platform team**: If HMAC secret rotation needed
3. **Provider support**: If provider API changed unexpectedly

---

*Runbook for AI Video Production Specialist Digital FTE — Webhook anomalies*
