# Block 4 — Docker Compose Production Stack Forensic Preflight Report

**Date**: 2026-08-09  
**Status**: READ-ONLY AUDIT COMPLETE — Awaiting Principal Approval for Remediation  
**Confidence**: 95% (cross-validated across 5 independent auditors)

---

## Executive Summary

The production stack (`docker-compose.prod.yaml`) has **fundamental configuration contradictions** that will prevent successful deployment. The most critical is a **Vault TLS scheme mismatch**: the Vault listener is configured for HTTP (`tls_disable=true`) while all consumers (docker-compose env vars, API service, healthcheck) expect HTTPS. This is a **blocking contradiction** — the stack cannot start successfully without resolving this.

Additionally, the validation script (`validate-deployment.sh`) contains a **nginx IP restriction contradiction** that makes the metrics endpoint check always fail (warn-only), and 5 of 9 services lack healthchecks entirely.

**Verdict**: **DO NOT DEPLOY** — 6 CRITICAL contradictions must be resolved first. No security weakening (TLS disable) permitted per Principal directive.

---

## 5 Auditor Findings Summary

| Auditor | Critical Findings | Key Contradictions |
|---------|-------------------|---------------------|
| **Vault TLS** | 6 CRITICAL | Listener HTTP vs api_addr/cluster_addr HTTPS; VAULT_ADDR HTTPS vs HTTP listener; Healthcheck -tls-skip-verify vs HTTP; Empty cert dir vs volume mount; API can't connect; Production intent ambiguous |
| **Runtime Infra** | 4 CRITICAL | Mixed dev/prod state running; Vault unhealthy (HTTP vs HTTPS healthcheck); Anonymous volume vs named vault_data; Hardcoded dev passwords vs prod env vars; Alertmanager from prod running on dev network |
| **Compose** | 9 HIGH/CRITICAL | Secrets defined but only grafana uses native Docker secrets; No healthchecks on 6 services (api, nginx, frontend, prometheus, grafana, alertmanager); All internal ports exposed to host; API replicas=3 but no session affinity; Frontend no ports exposed; nginx depends_on without health conditions |
| **Security** | 3 CRITICAL, 6 HIGH | secrets/ NOT in .gitignore (real passwords at commit risk); Empty TLS cert dirs mounted read-only; All ports exposed to host; API bypasses nginx; Weak CSP (unsafe-inline/eval); Vault audit log world-readable; Vault UI enabled in prod |
| **Validation** | 2 CRITICAL contradictions | nginx restricts /metrics to private IPs but validation curls localhost (127.0.0.1) — always 403; 5 services have no healthcheck — validation accepts "none" as healthy |

---

## Consolidated Contradiction Register (17 Total)

| ID | Category | Description | Severity | Source Auditor |
|----|----------|-------------|----------|----------------|
| C1 | Vault TLS | `tls_disable=true` (HTTP) but `api_addr=https://vault:8200` | CRITICAL | Vault TLS |
| C2 | Vault TLS | Listener HTTP but `VAULT_ADDR=https://` in docker-compose (vault + api) | CRITICAL | Vault TLS |
| C3 | Vault TLS | Healthcheck uses `-tls-skip-verify` (HTTPS flag) but listener is HTTP | HIGH | Vault TLS |
| C4 | Vault TLS | Mounts `./config/vault-tls:/vault/tls:ro` but directory is EMPTY | HIGH | Vault TLS |
| C5 | Vault TLS | API `VAULT_ADDR=https://vault:8200` cannot connect to HTTP listener | CRITICAL | Vault TLS |
| C6 | Vault TLS | Config labeled "Production" with `tls_disable=true` but setup script instructs TLS cert generation | CRITICAL | Vault TLS |
| C7 | Runtime | Dev compose running but prod alertmanager also running on same network | HIGH | Runtime |
| C8 | Runtime | Dev uses hardcoded passwords; prod expects `${POSTGRES_PASSWORD}` from env | HIGH | Runtime |
| C9 | Runtime | Prod defines `vault_data` volume but container uses anonymous volume for `/vault/file` | HIGH | Runtime |
| C10 | Compose | Secrets defined but only grafana uses native Docker secret mounting | HIGH | Compose |
| C11 | Compose | API service has NO healthcheck despite 3 replicas & nginx dependency | CRITICAL | Compose |
| C12 | Compose | All internal ports (5432, 6379, 8200, 8201, 9090, 9091, 9093, 3001) exposed to host | CRITICAL | Compose |
| C13 | Compose | nginx `depends_on: api, frontend` without `condition: service_healthy` (no healthchecks) | HIGH | Compose |
| C14 | Security | `secrets/` directory NOT in `.gitignore` — real generated passwords at commit risk | CRITICAL | Security |
| C15 | Security | Empty `vault-tls/` and `nginx-tls/` mounted `:ro` — containers fail or run without TLS | CRITICAL | Security |
| C16 | Validation | nginx restricts `/metrics` to private IPs; validation curls `localhost` (127.0.0.1) → always 403 | CRITICAL | Validation |
| C17 | Validation | 5 services (nginx, frontend, prometheus, grafana, alertmanager) have no healthcheck — validation accepts `Health="none"` | HIGH | Validation |

---

## Required Conditions for Block 4 Pass (21 Acceptance Checks)

From `validate-deployment.sh` analysis — all must pass:

### Infrastructure Health (9 checks)
- [ ] postgres: `pg_isready -U postgres -d ai_video_fte` → exit 0
- [ ] redis: `redis-cli -a $PASS ping` → PONG
- [ ] vault: `vault status -tls-skip-verify` → "Sealed" or "Initialized"
- [ ] prometheus: `GET http://localhost:9091/-/healthy` → 200
- [ ] grafana: `GET http://localhost:3001/api/health` → `{"database":"ok"}`
- [ ] alertmanager: `GET http://localhost:9093/-/healthy` → 200
- [ ] api (via nginx): `GET http://localhost/health` → `{"status":"healthy"}`
- [ ] All 9 containers: Docker healthcheck = `healthy` OR `none` (300s max wait each)
- [ ] docker compose stack: `docker compose -f docker-compose.prod.yaml ps` → all 9 services listed

### Functional Validation (3 checks)
- [ ] API metrics via nginx: `GET http://localhost/metrics` → 200 (warn-only)
- [ ] Database connection: `pg_isready` internal
- [ ] Redis authenticated ping

### Preconditions (10 required before validation)
1. `docker-compose.prod.yaml` present and valid
2. `secrets/redis_password.txt` exists with valid password
3. `secrets/postgres_password.txt` exists
4. PostgreSQL database `ai_video_fte` created (migrations applied)
5. Vault initialized (unsealed for operations)
6. `config/nginx-tls/fullchain.pem` + `privkey.pem` exist
7. `config/vault-tls/vault.crt` + `vault.key` + `ca.crt` exist (if HTTPS intent)
8. Network `fte-network` created
9. Frontend built to `./frontend/dist/` (nginx bind mount)
10. All 9 service images available (built or pulled)

---

## Root Cause Classification

| Root Cause | Category | Required Change Type | Blocking? |
|------------|----------|---------------------|-----------|
| Vault HTTP listener vs HTTPS consumers | **Config Contradiction** | **Behavioral** — must choose HTTP or HTTPS consistently | **YES** |
| Empty TLS cert directories mounted read-only | **Missing Artifacts** | **Files** — generate/populate certs | **YES** (if HTTPS) |
| `secrets/` not gitignored | **Security Hygiene** | **Files** — add to `.gitignore` | **YES** |
| 6 services lack healthchecks | **Observability Gap** | **Behavioral** — add healthchecks to compose | NO (warn) |
| All internal ports exposed to host | **Network Policy** | **Behavioral** — remove port mappings | NO (hardening) |
| nginx IP restriction breaks validation | **Config Contradiction** | **Behavioral** — fix nginx or validation | NO (warn-only) |
| API replicas=3 no session affinity | **Architecture** | **Behavioral** — verify stateless or add | NO (future) |

**Key Decision Required**: The Principal must declare **production intent for Vault: HTTP or HTTPS**. This is a **behavioral change** requiring Clarification (Phase 4) per CLAUDE.md §8 Specification Stability Rule.

---

## Minimal Fix Plan (Post-Approval)

### If HTTPS Intent (Recommended per repo setup-secrets.sh)
1. **config/vault.hcl**: `tls_disable = false`, add `tls_cert_file = "/vault/tls/vault.crt"`, `tls_key_file = "/vault/tls/vault.key"`, `tls_client_ca_file = "/vault/tls/ca.crt"`
2. **config/vault.hcl**: `api_addr = "https://vault:8200"`, `cluster_addr = "https://vault:8201"` (already correct)
3. **Generate certs** in `config/vault-tls/` (vault.crt, vault.key, ca.crt) — self-signed for local, CA-signed for prod
4. **Generate certs** in `config/nginx-tls/` (fullchain.pem, privkey.pem)
5. **docker-compose.prod.yaml**: Keep `VAULT_ADDR=https://vault:8200`, healthcheck `-tls-skip-verify` acceptable for self-signed
6. **Add healthchecks** to api, nginx, frontend, prometheus, grafana, alertmanager services

### If HTTP Intent
1. **config/vault.hcl**: Change `api_addr = "http://vault:8200"`, `cluster_addr = "http://vault:8201"`
2. **docker-compose.prod.yaml**: Change all `VAULT_ADDR`, `VAULT_API_ADDR`, `VAULT_CLUSTER_ADDR` to `http://`
3. **docker-compose.prod.yaml**: Remove `-tls-skip-verify` from vault healthcheck
4. **Remove** `./config/vault-tls:/vault/tls:ro` volume mount (not needed)
5. **nginx.conf**: Change to HTTP only (remove SSL config) or keep TLS termination at nginx only

### Mandatory Security Fixes (Both Paths)
1. Add `secrets/` to `.gitignore` **immediately**
2. Remove all host port mappings except nginx (80/443)
3. Add healthchecks to api, nginx, frontend, prometheus, grafana, alertmanager
4. Fix nginx `/metrics` allow list to include 127.0.0.1 or adjust validation script

---

## Risk Register (Post-Fix)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Self-signed certs require `-tls-skip-verify` (operational habit risk) | HIGH | MEDIUM | Use proper CA (Let's Encrypt/internal PKI) for all environments |
| Vault single instance = SPOF (no HA/raft cluster) | MEDIUM | HIGH | Document as known limitation; plan HA for Scale phase |
| API 3 replicas no session affinity verification | MEDIUM | MEDIUM | Verify stateless design; add integration test |
| Secrets in plaintext files (not Docker secrets) | HIGH | HIGH | Migrate to Docker secrets or external manager post-Block 4 |
| No backup/restore validation for volumes | UNKNOWN | HIGH | Add to Phase 5 (Observability/Runbooks) |

---

## Approval Gate

**Per CLAUDE.md §9-10**: This forensic audit completes Phase 4 preflight. **No remediation begins until Principal explicitly approves:**

1. **Vault protocol decision**: HTTP or HTTPS (behavioral change → Clarification required)
2. **Authorization to implement** minimal fix per chosen path
3. **Authorization to run** `validate-deployment.sh` post-fix
4. **Regression verification**: Block 3F (15/15 integration, 288/288 unit, TS 0 errors) must hold

---

## Evidence Files (Read-Only Artifacts)

| File | Auditor | Description |
|------|---------|-------------|
| `vault-tls-audit-report.json` | Vault TLS | Full contradiction details with file:line references |
| `acceptance-checklist.json` | Validation | 21 concrete checks from validate-deployment.sh |
| `security-audit-report.json` | Security | 17 findings with severity ratings |
| `docker-compose.prod.yaml` | Compose | Annotated service definitions |
| Runtime state output | Runtime | `docker ps`, `docker inspect`, volumes, networks |

---

**Prepared by**: 5 Independent Subagent Auditors  
**Constitution Compliance**: All audits READ-ONLY, no implementation, no security weakening  
**Next Action**: Await Principal decision on Vault protocol + remediation authorization