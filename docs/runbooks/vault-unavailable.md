# Runbook: Vault Unavailable

**Alert**: `VaultUnavailable`
**Severity**: Critical
**Prometheus Rule**: `ai_video_vault_status_gauge == 0`

---

## Description

HashiCorp Vault is unavailable. Vault provides Transit encryption (DEK/KEK) for biometric data and API key storage. Without Vault, the FTE cannot encrypt face/voice embeddings or access provider API keys.

## Impact

- **Immediate**: Biometric data cannot be encrypted/decrypted, new character uploads fail
- **Ongoing**: Existing encrypted data is inaccessible for Face-Lock verification
- **No risk to existing data**: Encrypted data remains encrypted in PostgreSQL

## Diagnosis

1. **Check Vault container**:
   ```bash
   docker ps | grep vault
   docker logs vault --since 5m 2>&1 | tail -20
   ```

2. **Check Vault health**:
   ```bash
   curl -s http://localhost:8200/v1/sys/health | jq .
   ```

3. **Check if sealed** (production):
   ```bash
   curl -s http://localhost:8200/v1/sys/seal-status | jq '.sealed'
   ```

4. **Check Transit key exists**:
   ```bash
   export VAULT_TOKEN=$(cat secrets/vault-token.txt)
   curl -s -H "X-Vault-Token: $VAULT_TOKEN" \
     http://localhost:8200/v1/transit/keys/biometric-encryption-dev | jq '.data'
   ```

5. **Check TLS certificates** (production):
   ```bash
   ls -la config/vault-tls/
   openssl x509 -in config/vault-tls/vault.crt -noout -dates
   ```

## Remediation

### If Vault container stopped:
```bash
docker start vault
# Wait for healthy status
until curl -s http://localhost:8200/v1/sys/health | jq -e '.initialized'; do
  sleep 2
done
```

### If Vault sealed (production):
1. Retrieve unseal keys from secure storage
2. Unseal with 3-of-5 keys:
   ```bash
   curl -s http://localhost:8200/v1/sys/unseal -d '{"key":"<unseal-key-1>"}'
   curl -s http://localhost:8200/v1/sys/unseal -d '{"key":"<unseal-key-2>"}'
   curl -s http://localhost:8200/v1/sys/unseal -d '{"key":"<unseal-key-3>"}'
   ```

### If Transit key missing:
```bash
vault secrets enable transit
vault write -f transit/keys/biometric-encryption-dev type=aes256-gcm96
```

### If TLS cert expired (production):
1. Regenerate certificates using `setup-secrets.sh`
2. Restart Vault with new certs

## Escalation Path

1. **On-call engineer**: Restart Vault and check seal status
2. **Platform team**: If persistent infrastructure issue
3. **Security team**: If Vault data corruption or unauthorized access suspected

---

*Runbook for AI Video Production Specialist Digital FTE — Vault outage*
