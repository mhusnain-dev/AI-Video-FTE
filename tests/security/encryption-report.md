# Encryption at-rest Verification Report

**Date**: 2026-08-17  
**Test file**: `tests/security/encryption-verify.test.ts`  
**Vault**: HashiCorp Vault 1.15.6 (dev mode)  
**Transit key**: `biometric-encryption-dev` (AES-256-GCM96)

---

## Test Results

| # | Test | Status |
|---|------|--------|
| 1 | DEK generation produces valid base64 (32 bytes) | ✅ PASS |
| 2 | DEK generation produces unique keys | ✅ PASS |
| 3 | DEK encrypt with Vault Transit KEK | ✅ PASS |
| 4 | Roundtrip: encrypt → decrypt DEK returns original | ✅ PASS |
| 5 | Encrypted DEK is not readable as plaintext | ✅ PASS |
| 6 | Different DEKs produce different ciphertexts | ✅ PASS |
| 7 | Embedding encrypt with DEK (AES-256-GCM) | ✅ PASS |
| 8 | Roundtrip: encrypt → decrypt embedding returns original | ✅ PASS |
| 9 | Encrypted embedding not readable as plaintext | ✅ PASS |
| 10 | Different DEKs produce different ciphertexts for same embedding | ✅ PASS |
| 11 | Decryption fails with wrong DEK | ✅ PASS |
| 12 | Decryption fails with tampered ciphertext | ✅ PASS |
| 13 | End-to-end storage roundtrip (KEK + DEK) | ✅ PASS |
| 14 | Second encrypt reuses existing DEK | ✅ PASS |
| 15 | Face embedding (512-dim ArcFace) roundtrip | ✅ PASS |
| 16 | Voice embedding (256-dim ECAPA-TDNN) roundtrip | ✅ PASS |
| 17 | Rejects unsupported envelope version | ✅ PASS |
| 18 | Rejects unsupported algorithm | ✅ PASS |

**Total**: 18/18 passed

---

## Verification of Encryption Properties

### 1. Vault Transit KEK Encrypt/Decrypt
- DEK generated via `crypto.randomBytes(32)` → base64
- DEK encrypted via Vault Transit `encryptData()` → `vault:v1:...` ciphertext
- Decrypted DEK matches original exactly
- **Property**: ✅ Verified

### 2. Ciphertext Non-Readability
- Encrypted DEK does not contain original base64 content
- Encrypted embedding ciphertext does not contain plaintext JSON
- **Property**: ✅ Verified

### 3. Different DEKs → Different Ciphertexts
- Two random DEKs produce distinct Vault ciphertexts
- Same embedding encrypted with different DEKs → different envelope.ciphertext values
- Same embedding encrypted with different DEKs → different IV values
- **Property**: ✅ Verified (semantic security)

### 4. KEK Rotation (Structural)
- `rotateVaultTransitKey()` creates new key version in Vault Transit
- `rotateUserDek()` rewraps DEK with latest KEK version
- Both functions verified in `src/shared/vault.ts:204–262`
- **Note**: Full rotation test requires Vault key version management; structural correctness verified via code review

### 5. Biometric Embedding Encryption
- **Face (512-dim ArcFace)**: Full roundtrip with float precision maintained (10 decimal places)
- **Voice (256-dim ECAPA-TDNN)**: Full roundtrip with float precision maintained
- **Envelope structure**: version=1, algorithm=aes-256-gcm, IV=12 bytes, authTag=16 bytes
- **Property**: ✅ Verified

### 6. Tamper Detection
- Wrong DEK → decryption throws (AEAD authentication tag mismatch)
- Tampered ciphertext → decryption throws
- **Property**: ✅ Verified (GCM integrity)

### 7. DEK Reuse
- Same user's second embedding reuses existing DEK (no redundant key generation)
- Different ciphertexts via different IVs per encryption
- **Property**: ✅ Verified

---

## Architecture Summary

```
User uploads face photo
  ↓
Extract face embedding (512-dim float array)
  ↓
Get or generate user's DEK (32 bytes, random)
  ↓
Encrypt embedding with DEK (AES-256-GCM)
  → EncryptedEnvelope { iv, authTag, ciphertext }
  ↓
Encrypt DEK with Vault Transit KEK
  → "vault:v1:..." ciphertext
  ↓
Store in PostgreSQL: (envelope JSON, encryptedDek)
```

**Key Management**:
- KEK: Vault Transit managed, 90-day rotation
- DEK: Per-user, generated once, encrypted by KEK
- Rotation: Zero-downtime rewrap (new KEK version, same DEK plaintext)
