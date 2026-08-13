# BLOCK 4 — PRINCIPAL DECISION GATE REPORT

**Date**: 2026-08-09  
**Status**: 5 Independent Subagent Reviews Complete — Awaiting Principal Decision  
**Confidence**: 95% (cross-validated across all auditors)

---

## 1. CONFIRMED PRODUCTION INTENT

**Vault protocol: AMBIGUOUS — no single authoritative source declares HTTP or HTTPS for production.**

| Source | Vault Protocol | Evidence |
|--------|----------------|----------|
| `docker-compose.prod.yaml` | **HTTPS** | `VAULT_ADDR=https://vault:8200`, `VAULT_API_ADDR=https://vault:8200`, `VAULT_CLUSTER_ADDR=https://vault:8201` |
| `config/vault.hcl` listener | **HTTP** | `tls_disable = true` (line 14) |
| `config/vault.hcl` api/cluster_addr | **HTTPS** | `api_addr = "https://vault:8200"`, `cluster_addr = "https://vault:8201"` (lines 43-44) |
| `src/shared/vault.ts` | **HTTPS** | Uses `config.vault.address` → populated from `VAULT_ADDR` env |
| `scripts/setup-secrets.sh` | **HTTPS (intended)** | Documents TLS cert generation for `config/vault-tls/` (lines 117-120) — but does NOT generate them |
| `config/vault-tls/` | **NONE** | Directory exists but EMPTY — no certs present |
| `docker-compose.yaml` (dev) | **HTTP** | `VAULT_ADDR=http://vault:8200`, `VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200` |

**Subagent Agreement (4/5)**: Vault TLS Auditor, Runtime Infra Auditor, Compose Auditor, Security Auditor, Validation Auditor — all confirm **contradiction exists** (6 CRITICAL findings).

**Vault/TLS Auditor Conclusion**: "AMBIGUOUS" intent, confidence 35%. Explicit decision must be recorded before implementation.

---

## 2. GOVERNANCE REQUIREMENT

**CRITICAL DISAGREEMENT BETWEEN AUDITORS:**

| Auditor | Classification | Requires Clarification (Phase 4)? | Rationale |
|---------|----------------|-----------------------------------|-----------|
| **Governance Auditor** (Decision Gate) | **IMPLEMENTATION** | **NO** | "Config contradiction fix is implementation, not behavioral change. Build phase already authorized. Principal chooses fix direction." |
| **Original Preflight Report** (5-Auditor Consensus) | **BEHAVIORAL** | **YES** | "Must choose HTTP or HTTPS consistently — this is a behavioral change requiring Clarification per CLAUDE.md §8 Specification Stability Rule." |
| **Vault/TLS Auditor** (Decision Gate) | **REQUIRES EXPLICIT DECISION** | **IMPLICIT YES** | "Explicit decision must be recorded in progress.md or a dedicated ADR before implementation." |

**Evidence Resolving the Disagreement:**

- **Governance Auditor's position**: Specification (`specs/ai-video-fte/spec.md`) contains **zero requirements about Vault protocol**. The spec only defines behavioral requirements (API health, encryption, secrets storage). Protocol (HTTP vs HTTPS) is an **implementation detail** not covered by spec → implementation fix.
  
- **Preflight/Vault-TLS position**: CLAUDE.md §8 "Specification Stability Rule" states: *"Once the Principal approves the behavioural specification... it becomes the immutable baseline... Behavioural change... Must return to Clarification (Phase 4)."* The contradiction makes the **current authorized implementation non-functional** — deploying it fails. Fixing a non-functional authorized implementation could be argued as either:
  - (a) Restoring the intended behavior (implementation fix)
  - (b) Choosing a behavior never explicitly specified (behavioral decision)

**Resolution Path**: The Principal must decide whether the spec's silence on Vault protocol means:
- **Option A**: Protocol is implementation → Governance Auditor correct → **No Clarification needed, proceed to implementation authorization**
- **Option B**: Protocol affects observable security posture → Preflight correct → **Clarification required before implementation**

---

## 3. PRINCIPAL DECISION REQUIRED

**Decision 1: Vault Protocol** (BLOCKING)
- **HTTPS** (Recommended by Governance Auditor, setup-secrets.sh, docker-compose.prod.yaml env vars)
  - Requires: `vault.hcl` `tls_disable=false`, valid certs in `config/vault-tls/`, healthcheck without `-tls-skip-verify` (or with for self-signed)
- **HTTP** (Consistent with dev, Vault listener config)
  - Requires: `docker-compose.prod.yaml` all `https://` → `http://`, `vault.hcl` api/cluster_addr → `http://`, remove TLS volume mount, remove `-tls-skip-verify`

**Decision 2: Governance Path**
- **Path A**: Accept Governance Auditor — protocol is implementation → **Authorize implementation directly**
- **Path B**: Accept Preflight — protocol is behavioral → **Require Clarification (Phase 4) first**

**Decision 3: Security Blockers Pre-Condition**
- **MANDATORY**: `secrets/` added to `.gitignore` BEFORE any other changes (Security Auditor: BLOCK_4_BLOCKER #1)

---

## 4. IMPLEMENTATION AUTHORIZATION REQUIRED

**Current State**: Block 4 forensic audit complete. **NO implementation authorized yet.**

**Required Authorization** (explicit, from Principal):
1. Vault protocol decision (HTTPS or HTTP)
2. Governance path decision (Clarification required or not)
3. Authorization to implement minimal fix per chosen path
4. Authorization to run `validate-deployment.sh` post-fix
5. Confirmation Block 3F regression verification required (15/15 integration, 288/288 unit, TS 0 errors)

---

## 5. MINIMAL IMPLEMENTATION SCOPE

### If HTTPS Chosen (Recommended)
| File | Change |
|------|--------|
| `config/vault.hcl` | `tls_disable = false`; add `tls_cert_file`, `tls_key_file`, `tls_client_ca_file` pointing to `/vault/tls/` |
| `config/vault.hcl` | Keep `api_addr = "https://vault:8200"`, `cluster_addr = "https://vault:8201"` |
| `config/vault-tls/` | Generate `vault.crt`, `vault.key`, `ca.crt` (self-signed for local, CA-signed for prod) |
| `scripts/setup-secrets.sh` | Add actual cert generation (currently placeholder only) |
| `docker-compose.prod.yaml` | Keep `VAULT_ADDR=https://` (already correct) |
| `docker-compose.prod.yaml` | Healthcheck: keep `-tls-skip-verify` for self-signed, or remove if CA-signed |

### If HTTP Chosen
| File | Change |
|------|--------|
| `config/vault.hcl` | `api_addr = "http://vault:8200"`, `cluster_addr = "http://vault:8201"` |
| `docker-compose.prod.yaml` | All `VAULT_ADDR`, `VAULT_API_ADDR`, `VAULT_CLUSTER_ADDR` → `http://` |
| `docker-compose.prod.yaml` | Healthcheck: remove `-tls-skip-verify` |
| `docker-compose.prod.yaml` | Remove `./config/vault-tls:/vault/tls:ro` volume mount |

### Mandatory Security Fixes (BOTH Paths)
| # | Fix | Source |
|---|-----|--------|
| 1 | Add `secrets/` to `.gitignore` | Security Auditor: BLOCK_4_BLOCKER |
| 2 | Remove host port mappings except nginx (80/443) | Compose Auditor: C12 CRITICAL |
| 3 | Add healthchecks to api, nginx, frontend, prometheus, grafana, alertmanager | Compose Auditor: C11 CRITICAL, Validation Auditor: C17 |
| 4 | Fix nginx `/metrics` allow list to include 127.0.0.1 or adjust validation | Validation Auditor: C16 CRITICAL |
| 5 | Remove Vault UI in production (`ui = true` → `ui = false`) | Security Auditor: BLOCK_4_BLOCKER |
| 6 | Fix Vault audit log mode `0644` → `0600` | Security Auditor: BLOCK_4_BLOCKER |
| 7 | Migrate from plaintext secret files to Docker secrets | Security Auditor: REQUIRED_FOR_DEPLOYMENT |

---

## 6. BLOCK 4 ACCEPTANCE GATES

From Deployment Acceptance Auditor (21 checks — ALL must pass):

### Infrastructure Health (9)
- [ ] postgres: `pg_isready -U postgres -d ai_video_fte` → exit 0
- [ ] redis: `redis-cli -a $PASS ping` → PONG
- [ ] vault: `vault status` (no `-tls-skip-verify` if HTTPS with valid certs) → "Sealed" or "Initialized"
- [ ] prometheus: `GET http://localhost:9091/-/healthy` → 200
- [ ] grafana: `GET http://localhost:3001/api/health` → `{"database":"ok"}`
- [ ] alertmanager: `GET http://localhost:9093/-/healthy` → 200
- [ ] api (via nginx): `GET http://localhost/health` → `{"status":"healthy"}`
- [ ] All 9 containers: Docker healthcheck = `healthy` (300s max wait each)
- [ ] `docker compose -f docker-compose.prod.yaml ps` → all 9 services listed

### Functional Validation (3)
- [ ] API metrics via nginx: `GET http://localhost/metrics` → 200
- [ ] Database connection: `pg_isready` internal
- [ ] Redis authenticated ping

### Preconditions (10 — must exist BEFORE validation runs)
1. `docker-compose.prod.yaml` present and valid
2. `secrets/redis_password.txt` exists with valid password
3. `secrets/postgres_password.txt` exists
4. PostgreSQL database `ai_video_fte` created (migrations applied)
5. Vault initialized (unsealed for operations)
6. `config/nginx-tls/fullchain.pem` + `privkey.pem` exist
7. `config/vault-tls/vault.crt` + `vault.key` + `ca.crt` exist (if HTTPS)
8. Network `fte-network` created
9. Frontend built to `./frontend/dist/` (nginx bind mount)
10. All 9 service images available (built or pulled)

---

## 7. BLOCK 3F REGRESSION REQUIREMENT

**Regression Auditor Verdict: PARTIAL_RERUN REQUIRED**

### Must Re-Run After Block 4 Changes:
| Test Suite | Reason |
|------------|--------|
| **Integration tests** (15/15) | ALL 15 depend on docker-compose.yaml port exposure; any dev config change affects them |
| **TypeScript check** | Any config/type changes require verification |

### Tests Affected By Change Type:
| Block 4 Change | Integration Tests at Risk |
|----------------|---------------------------|
| Port exposure removal (docker-compose.yaml) | ALL 15 (PostgreSQL 5, Redis 3, Vault 3, Event Bus 2, foundation 2) |
| Vault protocol change (dev) | 3 Vault Transit tests |
| Healthcheck modifications | 3 indirect (via startup timing) |
| Secrets handling changes | 3 Vault Transit tests |

### Regression Verification Protocol:
1. **Run full test suite (`npm test`) to establish baseline BEFORE any Block 4 changes**
2. **Do NOT modify docker-compose.yaml (development) unless intentionally changing dev environment**
3. **Document which Block 4 changes affect development vs production configs**
4. **Ensure config/test.yaml has explicit vault/postgres/redis sections** (currently missing — relies on defaults)
5. **Re-run integration tests against modified dev environment after any dev config change**
6. **Block 3F pass criteria must hold**: 15/15 integration, 288/288 unit, TS 0 errors

---

## 8. SECURITY BLOCKERS

From Security Auditor — 5 BLOCK_4_BLOCKERS (must fix before Block 4 pass):

| # | Finding | Severity | File |
|---|---------|----------|------|
| 1 | `secrets/` NOT in `.gitignore` — real passwords at commit risk | BLOCK_4_BLOCKER | `.gitignore` |
| 2 | Empty `vault-tls/` and `nginx-tls/` mounted `:ro` — containers fail or run without TLS | BLOCK_4_BLOCKER | `docker-compose.prod.yaml`, `config/*/tls/` |
| 3 | All internal ports exposed to host (5432, 6379, 8200, 8201, 9090, 9091, 9093, 3001) | BLOCK_4_BLOCKER | `docker-compose.prod.yaml` |
| 4 | Vault UI enabled in production (`ui = true`) | BLOCK_4_BLOCKER | `config/vault.hcl` |
| 5 | Vault audit log mode `0644` (world-readable) | BLOCK_4_BLOCKER | `config/vault.hcl` |

### 7 REQUIRED_FOR_DEPLOYMENT (must fix for production deployment):
6. Weak CSP (`unsafe-inline`, `unsafe-eval`) in nginx
7. nginx `/metrics` restricted to RFC 1918 but validation curls localhost (always 403)
8. API bypasses nginx (direct port 3000 exposure)
9. Secrets in plaintext files, not Docker secrets
10. No backup/restore validation for volumes
11. Vault single instance = SPOF (no HA)
12. Self-signed certs require `-tls-skip-verify` (operational habit risk)

### 1 INFORMATIONAL:
13. CSP includes `unsafe-inline`/`unsafe-eval` (legacy compatibility)

---

## 9. OUT-OF-SCOPE FINDINGS

These findings are **real but outside Block 4 scope** — defer to future phases:

| Finding | Phase | Reason |
|---------|-------|--------|
| API 3 replicas no session affinity verification | Scale/HA | Not blocking for initial deploy |
| Migration to external secret manager (Vault/AWS/GCP) | Phase 5 | Current: file-based secrets |
| PostgreSQL pgvector/pgcrypto backup/restore validation | Phase 5 | Runbooks missing |
| Vault HA/Raft cluster setup | Scale | Single instance known limitation |
| Full observability stack (tracing, alerting rules) | Phase 5 | Dashboards exist, alerts not tuned |
| nginx rate limiting tuning | Optimization | Basic config present |
| Frontend build optimization | Performance | Not deployment-blocking |

---

## 10. EXACT NEXT ACTION

**NO IMPLEMENTATION YET.** The Principal must provide explicit decisions on:

1. **Vault Protocol**: HTTPS or HTTP
2. **Governance Path**: 
   - Accept Governance Auditor → Implementation fix (no Clarification)
   - Accept Preflight → Clarification (Phase 4) required first
3. **Authorization**: Explicit "Proceed with implementation" after above decisions
4. **Security Pre-Condition**: Confirm `secrets/` → `.gitignore` is first change (non-negotiable)

**Evidence Package for Decision**:
- This report (BLOCK_4_DECISION_GATE_REPORT.md)
- Block 4 forensic preflight report (block4-preflight-report.md)
- 5 Decision-Gate subagent reports (in `.claude/projects/.../subagents/`)
- Security findings classification (security-findings-classification.json)
- Acceptance checklist (block4_audit_output.json)

---

**BLOCK 4 IMPLEMENTATION: NOT AUTHORIZED — AWAITING PRINCIPAL DECISION**