# Runbook: High Vault Latency

**Alert**: `HighVaultLatency`
**Severity**: Warning
**Prometheus Rule**: `histogram_quantile(0.99, sum(rate(ai_video_vault_encrypt_duration_seconds_bucket[5m])) by (le)) > 2 or histogram_quantile(0.99, sum(rate(ai_video_vault_decrypt_duration_seconds_bucket[5m])) by (le)) > 2`

---

## Description

Vault encrypt/decrypt P99 latency has exceeded 2 seconds. Vault Transit is used for DEK/KEK encryption of biometric data (face/voice embeddings). High latency slows character uploads and Face-Lock verification.

## Impact

- **Immediate**: Slower character uploads and Face-Lock verification
- **User-facing**: Character upload may appear to hang
- **No data risk**: Encrypted data remains secure

## Diagnosis

1. **Check Vault latency**:
   ```bash
   docker exec vault vault status -format=json | jq '.leader_address'
   ```

2. **Check Vault metrics**:
   ```bash
   curl -s http://localhost:8200/v1/sys/metrics?format=prometheus 2>/dev/null | grep vault
   ```

3. **Check Vault logs**:
   ```bash
   docker logs vault --since 10m 2>&1 | grep -i "error\|warn\|latency"
   ```

4. **Check Vault storage backend**:
   ```bash
   docker exec vault df -h /vault/file
   ```

5. **Check Transit key operations**:
   ```bash
   curl -s -H "X-Vault-Token: $VAULT_TOKEN" \
     http://localhost:8200/v1/transit/keys/biometric-encryption-dev | jq '.data'
   ```

## Remediation

### If Vault is resource-constrained:
1. Increase CPU/memory for Vault container
2. Check storage backend I/O
3. Consider using a faster storage backend (Raft vs file)

### If key rotation in progress:
1. Key rotation is CPU-intensive
2. Wait for rotation to complete
3. Monitor rotation status in Vault logs

### If network latency:
1. Check network between API and Vault containers
2. Verify TLS overhead isn't excessive
3. Consider connection pooling

### If Vault is overloaded:
1. Check number of concurrent encrypt/decrypt requests
2. Rate-limit Vault operations if needed
3. Consider caching recently used DEKs

## Escalation Path

1. **On-call engineer**: Check Vault health and resource usage
2. **Platform team**: If infrastructure scaling needed
3. **Security team**: If Vault security issue suspected

---

*Runbook for AI Video Production Specialist Digital FTE — Vault performance*
