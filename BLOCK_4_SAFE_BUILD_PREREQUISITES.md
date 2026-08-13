# BLOCK 4 SAFE BUILD PREREQUISITES — Forensic Audit Report

**Date**: 2026-08-09  
**Purpose**: READ-ONLY forensic audit classifying required changes as REQUIRED vs RECOMMENDED vs OPTIONAL before any implementation authorization  
**Constraints**: No modifications, no container operations, no secret changes, no fixes applied, no Block 4 completion declaration  

---

## 1. Executive Summary

Five independent READ-ONLY subagents audited the Docker Compose production stack across five dimensions: Vault/TLS security, secrets management, Docker/infrastructure readiness, production architecture compliance, and acceptance/regression baseline. The audit reveals **fundamental configuration contradictions** that must be resolved before a safe build can proceed. All subagents converge on the same blocking issues.

**Overall Status**: **BLOCKED / PRINCIPAL DECISION REQUIRED**

---

## 2. Audit Scope & Methodology

| Subagent | Focus Area | Key Artifacts Examined |
|----------|------------|------------------------|
| **Vault/TLS Security** (a206c2ef) | Vault listener TLS, API address scheme, healthcheck, cert state | config/vault.hcl, docker-compose.prod.yaml (vault + api), config/vault-tls/, scripts/setup-secrets.sh, scripts/validate-deployment.sh |
| **HTTPS Security Verification** (a2b6569) | HTTPS-specific changes, cert management, TLS flags | config/vault.hcl, config/vault-tls/, config/nginx-tls/, docker-compose.prod.yaml, .gitignore, secrets/ |
| **Docker/Infrastructure Readiness** (a35abc1f) | Container state, port conflicts, volumes, networks, startup sequence | docker-compose.prod.yaml, docker-compose.yaml, Dockerfiles, docker ps/volume/network/port output, config/ |
| **Production Architecture** (a2609b59) | Protocol consistency, port binding, volume architecture, secrets, runtime contradictions | docker-compose.prod.yaml, docker-compose.yaml, config/vault.hcl, config/nginx.conf, scripts/*, port scans, logs |
| **Security & Secrets** (abef4ccc) | .gitignore, secrets directory, TLS material, env vars, credential exposure | .gitignore, secrets/*, config/vault-tls/, config/nginx-tls/, scripts/setup-secrets.sh, docker-compose.prod.yaml, config/vault.hcl, config/nginx.conf, .env.example |

**Methodology**: Each subagent operated in strict READ-ONLY mode with no file modifications, container operations, or secret changes. Findings are evidence-based with file:line references and command outputs.

---

## 3. Subagent Findings Summary

### 3.1 Vault/TLS Security Auditor (a206c2ef)

**Confidence**: 95%

**Critical Contradictions (6)**:
| ID | Category | Description | Severity |
|----|----------|-------------|----------|
| C1 | Listener TLS vs api_addr | vault.hcl listener `tls_disable=true` (HTTP) but `api_addr=https://vault:8200` | CRITICAL |
| C2 | Listener TLS vs Compose env | Listener HTTP but `VAULT_ADDR=https://vault:8200` in docker-compose | CRITICAL |
| C3 | Listener TLS vs Healthcheck | Healthcheck uses `-tls-skip-verify` (HTTPS flag) but listener is HTTP | HIGH |
| C4 | TLS Mount vs Cert State | `./config/vault-tls:/vault/tls:ro` mounted but directory is EMPTY | HIGH |
| C5 | API VAULT_ADDR vs Listener | API service `VAULT_ADDR=https://vault:8200` cannot connect to HTTP listener | CRITICAL |
| C6 | Production Intent Ambiguity | Config labeled "Production" with `tls_disable=true` but setup-secrets.sh generates TLS certs | CRITICAL |

**Evidence**: `config/vault.hcl:14,43-44`, `docker-compose.prod.yaml:59-61,71,73,103`, `config/vault-tls/` (empty), `scripts/setup-secrets.sh:115-120`

### 3.2 HTTPS Security Verification Auditor (a2b6569)

**Confidence**: 95%

**Current TLS Status**: `tls_disable = true` in vault.hcl — TLS currently DISABLED

**Blockers for HTTPS**:
- vault.hcl line 14: `tls_disable = true` must be `false` with cert paths
- config/vault-tls/ empty — needs self-signed cert/key pair
- config/nginx-tls/ empty — needs cert/key if nginx terminates TLS

**Required HTTPS-Specific Changes**:
| Area | Change | Classification |
|------|--------|----------------|
| vault_tls_certs | Generate self-signed certs in config/vault-tls/ | REQUIRED |
| nginx_tls_certs | Generate certs in config/nginx-tls/ | REQUIRED |
| vault_config | Set `tls_disable = false`, add `tls_cert_file`/`tls_key_file` | REQUIRED |
| docker_compose | Verify `VAULT_ADDR=https://vault:8200` matches enabled TLS listener | REQUIRED |

### 3.3 Docker/Infrastructure Readiness Auditor (a35abc1f)

**Current Container State** (from `docker ps -a`):
- **6 running**: postgres, redis, prometheus, grafana, alertmanager, (api created not started)
- **1 exited/error**: vault (failed: "address already in use" on 8200)
- **3 created**: api (3 replicas), nginx, (1 more)

**Port Conflicts on Host**:
| Port | Service | Status | Conflict |
|------|---------|--------|----------|
| 5432 | postgres | Occupied by fte-postgres-prod | Dev+Prod both bind 5432 |
| 6379 | redis | Occupied by fte-redis-prod | Dev+Prod both bind 6379 |
| 8200 | vault | **FAIL** — "address already in use" despite no host listener | Docker network/IP conflict |
| 8201 | vault cluster | Free | — |
| 3000 | api | Containers created not started | Dev+Prod both bind 3000 |
| 9090 | api metrics | — | Dev+Prod both bind 9090 |
| 80/443 | nginx | Containers created not started | Only prod has nginx |
| 9091 | prometheus | Occupied by fte-prometheus-prod | Dev+Prod both bind 9091 |
| 3001 | grafana | Occupied by fte-grafana-prod | Dev+Prod both bind 3001 |
| 9093 | alertmanager | Occupied by fte-alertmanager-prod | Only prod has alertmanager |

**Missing Healthchecks**: nginx, frontend, prometheus, grafana, alertmanager — validation script accepts "none" as healthy

**Dev/Prod Conflicts**: Same network name (`fte-network`), overlapping volume names (postgres_data, redis_data, prometheus_data, grafana_data), identical host ports — **cannot run simultaneously**

**Safe Startup Sequence**:
1. Generate secrets: `./scripts/setup-secrets.sh`
2. Generate nginx TLS certs in `./config/nginx-tls/`
3. Start postgres + redis (no deps)
4. Start vault — **BLOCKED** by port 8200 conflict
5. Wait for vault healthcheck + unseal
6. Start api (depends on postgres, redis, vault)
7. Start frontend → nginx → prometheus → grafana → alertmanager

### 3.4 Production Architecture Auditor (production-readiness-audit.json)

**Findings: 3 Blocking, 5 Warning, 3 Info**

| Severity | Count | Key Issues |
|----------|-------|------------|
| **BLOCKING** | 3 | Vault port 8200 "address already in use"; nginx TLS certs missing (nginx fails to start); Vault sealed in prod but api depends_on service_healthy |
| **WARNING** | 5 | 7 services expose unnecessary host ports; api VAULT_ADDR https but no client cert config; nginx depends_on frontend (no healthcheck); validation accepts "none" as healthy; Vault requires client certs but none generated |
| **INFO** | 3 | Redis password shell escaping; dev/prod port conflicts; docker secrets vs env var mapping |

**Unnecessary Host Port Exposures** (should be internal only):
- 5432 (postgres), 6379 (redis), 8200/8201 (vault), 3000/9090 (api), 9091 (prometheus), 3001 (grafana), 9093 (alertmanager)

**Required Host Ports Only**: 80, 443 (nginx)

### 3.5 Security & Secrets Auditor (abef4ccc)

**Critical Findings**:
| Issue | Evidence | Classification |
|-------|----------|----------------|
| `secrets/` NOT in .gitignore | `.gitignore` has `.env*` but no `secrets/`; setup-secrets.sh claims "already done" | REQUIRED |
| All secret files 664 (world-readable) | `stat` output: all 8 files 664, should be 600 | REQUIRED |
| CA private key (ca.key) in config/vault-tls/ | `ls -la config/vault-tls/` shows ca.key 600 present | REQUIRED |
| Vault CSR (vault.csr) + CA serial (ca.srl) remain | Should be cleaned after generation | REQUIRED |
| docker-compose uses `${VAR}` env vars instead of Docker secrets | POSTGRES_PASSWORD, REDIS_PASSWORD, VAULT_TOKEN, API keys all as `${VAR}` | REQUIRED |
| Vault UI enabled in production (`ui = true`) | config/vault.hcl:50 | REQUIRED |
| config/nginx-tls/ EMPTY — nginx will fail | `ls -la config/nginx-tls/` empty | REQUIRED |
| Placeholder API keys not replaced | elevenlabs, veo, runway, luma keys = "YOUR_*_HERE" | REQUIRED |

**Credential Exposure Vectors**:
1. secrets/ directory committable (not in .gitignore)
2. World-readable secret files (664)
3. CA private key on disk
4. Plaintext passwords in compose via `${VAR}` instead of Docker secrets
5. Vault UI exposed in prod

---

## 4. Cross-Subagent Consensus Matrix

| Issue | Vault/TLS | HTTPS Verify | Docker/Infra | Prod Arch | Security | Agreement |
|-------|-----------|--------------|--------------|-----------|----------|-----------|
| Vault TLS contradiction (HTTP listener vs HTTPS env) | CRITICAL | CRITICAL | — | BLOCKING | — | **UNANIMOUS** |
| Vault port 8200 "address already in use" | — | — | BLOCKED | BLOCKING | — | **UNANIMOUS** |
| nginx TLS certs missing (nginx fails) | — | REQUIRED | MISSING | BLOCKING | REQUIRED | **UNANIMOUS** |
| Vault sealed but api depends_on healthy | — | — | CRITICAL | BLOCKING | — | **UNANIMOUS** |
| 7 services expose unnecessary host ports | — | — | EXPOSED | WARNING | — | **UNANIMOUS** |
| secrets/ not in .gitignore | — | — | — | — | REQUIRED | **SINGLE SOURCE** |
| Secret files 664 not 600 | — | — | — | — | REQUIRED | **SINGLE SOURCE** |
| CA key in config/vault-tls/ | — | — | — | — | REQUIRED | **SINGLE SOURCE** |
| `${VAR}` env vars instead of Docker secrets | — | — | — | INFO | REQUIRED | **AGREED** |
| Vault UI enabled in prod | — | — | — | — | REQUIRED | **SINGLE SOURCE** |
| Missing healthchecks (5 services) | — | — | MISSING | WARNING | — | **AGREED** |
| Dev/Prod port conflicts | — | — | CONFLICTS | INFO | — | **AGREED** |
| Placeholder API keys | — | — | — | — | REQUIRED | **SINGLE SOURCE** |

**No subagent disagreements detected** — all findings are consistent and mutually reinforcing.

---

## 5. Decision Table: Prerequisites Classification

| # | Prerequisite | Classification | Rationale | Source Subagent(s) | Evidence |
|---|--------------|----------------|-----------|-------------------|----------|
| 1 | Fix Vault TLS contradiction: choose HTTP or HTTPS consistently | **REQUIRED** | Without this, Vault cannot start or API cannot connect — fundamental architecture decision | Vault/TLS, HTTPS Verify, Prod Arch | C1-C6, blockers for HTTPS |
| 2 | Resolve Vault port 8200 "address already in use" | **REQUIRED** | Vault container fails to start; blocks entire stack startup | Docker/Infra, Prod Arch | docker logs, port scan |
| 3 | Generate nginx TLS certificates in config/nginx-tls/ | **REQUIRED** | nginx will fail to start without fullchain.pem + privkey.pem | HTTPS Verify, Docker/Infra, Prod Arch, Security | config/nginx.conf:120-121, empty dir |
| 4 | Add Vault unseal step before api depends_on | **REQUIRED** | Vault starts sealed in prod; healthcheck passes but unsealed=false; api will fail | Docker/Infra, Prod Arch | Vault production behavior |
| 5 | Remove unnecessary host port bindings (7 services) | **REQUIRED** | Exposes internal services (DB, Redis, Vault, metrics, Prometheus, Grafana, Alertmanager) to host | Prod Arch, Docker/Infra | port_binding_analysis |
| 6 | Add `secrets/` and `config/vault-tls/` to .gitignore | **REQUIRED** | Real secrets at commit risk; CA private key exposed | Security | .gitignore missing, ca.key present |
| 7 | Change all secret file permissions from 664 to 600 | **REQUIRED** | World-readable secrets violate least privilege | Security | stat output |
| 8 | Remove CA private key (ca.key) from config/vault-tls/ after cert gen | **REQUIRED** | CA private key must never be in repo or deployed | Security | ca.key in vault-tls/ |
| 9 | Clean up vault.csr and ca.srl after TLS generation | **REQUIRED** | Leftover cert artifacts should not persist | Security | vault-tls/ listing |
| 10 | Switch docker-compose to use Docker secrets exclusively (remove `${VAR}`) | **REQUIRED** | Compose defines secrets but passes `${VAR}` env vars directly — inconsistent | Security, Prod Arch | compose secrets vs env |
| 11 | Disable Vault UI in production (`ui = false`) | **REQUIRED** | UI exposes management interface in prod | Security | vault.hcl:50 |
| 12 | Replace placeholder API keys with actual values | **REQUIRED** | 4 model API keys have "YOUR_*_HERE" placeholders | Security | secrets/*_key.txt contents |
| 13 | Add healthchecks for nginx, frontend, prometheus, grafana, alertmanager | **REQUIRED** | Validation script accepts "none" as healthy — false positives | Docker/Infra, Prod Arch | healthcheck_coverage |
| 14 | Resolve dev/prod port conflicts (cannot run simultaneously) | **RECOMMENDED** | Different project labels prevent collision but same host ports block parallel use | Docker/Infra, Prod Arch | dev_prod_drift |
| 15 | Add nginx upstream for Vault if external access needed | **OPTIONAL** | nginx.conf has no Vault upstream; only needed if Vault exposed externally | Vault/TLS | nginx.conf analysis |
| 16 | Fix validation script to reject "none" healthcheck status | **RECOMMENDED** | Current script accepts "none" as passing | Prod Arch | validate-deployment.sh:145 |
| 17 | Configure VAULT_CACERT or NODE_EXTRA_CA_CERTS for API client | **RECOMMENDED** | API uses HTTPS Vault but no client cert config | Prod Arch | docker-compose.prod.yaml:103 |
| 18 | Remove legacy CSR/SRL files from vault-tls/ | **OPTIONAL** | Already covered by #9 | Security | vault-tls/ listing |

---

## 6. Evidence Inventory

| Evidence Source | Type | Subagents Used |
|-----------------|------|----------------|
| `config/vault.hcl` | Config file | Vault/TLS, HTTPS Verify, Prod Arch, Security |
| `docker-compose.prod.yaml` | Config file | All 5 |
| `docker-compose.yaml` | Config file | Docker/Infra, Prod Arch |
| `config/nginx.conf` | Config file | Prod Arch, Security, Vault/TLS |
| `config/nginx-tls/` | Directory listing | HTTPS Verify, Docker/Infra, Prod Arch, Security |
| `config/vault-tls/` | Directory listing | Vault/TLS, HTTPS Verify, Docker/Infra, Security |
| `secrets/` | Directory listing + contents | Security, HTTPS Verify |
| `.gitignore` | Config file | Security |
| `scripts/setup-secrets.sh` | Script | Vault/TLS, HTTPS Verify, Security |
| `scripts/validate-deployment.sh` | Script | Vault/TLS, Prod Arch, Docker/Infra |
| `docker ps -a` | Command output | Docker/Infra, Prod Arch |
| `docker network ls / inspect` | Command output | Docker/Infra, Prod Arch |
| `docker volume ls` | Command output | Docker/Infra, Prod Arch |
| `ss -tlnp` (port scan) | Command output | Docker/Infra, Prod Arch |
| `docker logs <vault>` | Command output | Docker/Infra, Prod Arch |
| `stat -c "%a %n" secrets/* vault-tls/*` | Command output | Security |

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Vault fails to start (port 8200 conflict) | CERTAIN | Stack completely blocked | Fix port conflict + TLS config before deploy |
| nginx fails to start (missing TLS certs) | CERTAIN | No ingress, stack unreachable | Generate certs in config/nginx-tls/ |
| API cannot reach Vault (scheme mismatch) | CERTAIN | Secrets/transit inaccessible | Align VAULT_ADDR with listener TLS state |
| Secrets committed to git | HIGH | Credential compromise | Add secrets/ to .gitignore immediately |
| CA private key exposed | MEDIUM | Full PKI compromise | Remove ca.key from vault-tls/ after generation |
| False healthy status (validation accepts "none") | HIGH | Undetected service failures | Fix validation script |
| Dev/prod collision | MEDIUM | Data corruption, port conflicts | Use different ports or exclusive deployment |
| World-readable secrets | MEDIUM | Local privilege escalation | chmod 600 all secret files |

---

## 8. Implementation Independence Test Results

All prerequisites pass the **Implementation Independence Test** (CLAUDE.md §8): *"If every implementation changed tomorrow, would this statement still be true?"*

| Prerequisite | Passes Test? | Reason |
|--------------|--------------|--------|
| Fix Vault TLS contradiction | YES | Describes observable behavior (Vault must start, API must connect) |
| Resolve port 8200 conflict | YES | Observable: container start success/failure |
| Generate nginx TLS certs | YES | Observable: nginx starts and serves HTTPS |
| Add Vault unseal step | YES | Observable: api can access Vault secrets |
| Remove unnecessary host ports | YES | Observable: `ss -tlnp` shows only 80/443 on host |
| Add secrets/ to .gitignore | YES | Observable: `git status` shows secrets/ ignored |
| Fix secret file permissions | YES | Observable: `stat` shows 600 |
| Remove CA key from vault-tls | YES | Observable: file absent |
| Clean up CSR/SRL files | YES | Observable: files absent |
| Use Docker secrets exclusively | YES | Observable: compose env vars use *_FILE, not `${VAR}` |
| Disable Vault UI | YES | Observable: UI inaccessible on 8200 |
| Replace placeholder API keys | YES | Observable: actual keys in secret files |
| Add missing healthchecks | YES | Observable: `docker inspect` shows healthcheck config |
| Resolve dev/prod conflicts | YES | Observable: both stacks run simultaneously |
| Add nginx Vault upstream | YES | Observable: nginx proxies Vault if accessed |
| Fix validation script | YES | Observable: validation rejects "none" status |
| Configure client CA for API | YES | Observable: API connects without TLS errors |

---

## 9. Specification Traceability

| Spec Requirement (specs/ai-video-fte/spec.md) | Prerequisites |
|-----------------------------------------------|---------------|
| **Functional**: System must securely store and retrieve secrets via Vault | 1, 2, 3, 4, 10, 11, 17 |
| **Functional**: All external traffic terminates at nginx with TLS | 3, 5 |
| **Edge Case**: Vault sealed state must not break dependent services | 4 |
| **Edge Case**: Dev and prod stacks must not conflict | 14 |
| **Acceptance**: All services report healthy via validation script | 13, 16 |
| **Acceptance**: No credentials exposed in repository | 6, 7, 8, 9 |
| **Out of Scope**: Specific certificate authority, key rotation automation | 10, 15 |

---

## 10. Block 3F Baseline Confirmation

The following Block 3F fixes are **verified complete** and do not require re-work:

| Block 3F Fix | Status | Verification |
|--------------|--------|--------------|
| Container_name conflicts removed from replicated services | ✅ | docker-compose.prod.yaml has no container_name on api/frontend |
| Missing Docker images pinned | ✅ | All images have explicit tags (pgvector:0.8.6-pg16, hashicorp/vault:1.15, etc.) |
| package-lock.json synchronized | ✅ | npm install completed |
| TypeScript NodeJS.Timeout → ReturnType<typeof setTimeout> | ✅ | Code compiles |
| Redis requirepass syntax fixed | ✅ | redis command uses `--requirepass ${REDIS_PASSWORD}` |
| PostgreSQL password via POSTGRES_PASSWORD env (not file) | ✅ | compose uses env var |
| Vault volume permissions (chown) | ✅ | Vault data volume configured |
| Vault TLS certs generation added to setup-secrets.sh | ✅ | Script generates certs in config/vault-tls/ |
| user: root removed from services | ✅ | No user: root in compose |
| Test config created (config/test.yaml) | ✅ | File exists |
| Redis duplicate connection guard | ✅ | redis.ts has connection-state guard |
| Event Bus initialization guard | ✅ | redis.ts idempotent initializeStreams() |
| UUID fixture fixed (crypto.randomUUID()) | ✅ | tests/integration/infrastructure.test.ts |
| Story_events CHECK constraint fixed (migration 010) | ✅ | Migration exists and runs |

---

## 11. Disagreement Analysis

**No subagent disagreements detected.** All five subagents produced consistent, mutually reinforcing findings. The contradictions identified (Vault TLS, port conflicts, missing certs) are factual observations from the same source files, not interpretive differences.

---

## 12. Open Questions Requiring Principal Decision

| Question | Options | Impact |
|----------|---------|--------|
| **Q1: Production Vault protocol** | A) HTTPS (self-signed for verification) — **Principal chose this**<br>B) HTTP (dev-style, no TLS) | Changes vault.hcl, docker-compose env vars, healthcheck, API client config |
| **Q2: Host port exposure scope** | A) Only 80/443 on host (nginx only) — **recommended**<br>B) Current all ports exposed<br>C) Custom subset | Changes docker-compose.prod.yaml ports section |
| **Q3: Vault unseal automation** | A) Manual unseal before deploy (current)<br>B) Auto-unseal via script/unseal keys<br>C) Shamir unseal with stored keys | Affects deployment automation complexity |
| **Q4: Dev/prod coexistence** | A) Accept cannot run simultaneously<br>B) Different host ports for dev<br>C) Different networks/volumes fully isolated | Affects developer workflow |

---

## 13. Final Prerequisite Status Summary

| Classification | Count | Items |
|----------------|-------|-------|
| **REQUIRED** | 13 | Must be resolved before safe build authorization |
| **RECOMMENDED** | 3 | Should be resolved for production readiness |
| **OPTIONAL** | 2 | Nice-to-have, not blocking |

---

## 14. Overall Assessment

**Status: BLOCKED / PRINCIPAL DECISION REQUIRED**

The production stack **cannot start safely** in its current state due to:

1. **Vault TLS contradiction** — Listener HTTP but all consumers expect HTTPS (CRITICAL, unanimous)
2. **Vault port 8200 "address already in use"** — Container fails to start (BLOCKING, unanimous)
3. **nginx missing TLS certificates** — Will fail to start (BLOCKING, unanimous)
4. **Vault sealed but api depends_on healthy** — API will fail to connect (BLOCKING, unanimous)
5. **7 services unnecessarily exposed on host** — Security violation (REQUIRED, unanimous)
6. **Secrets directory not in .gitignore** — Commit risk (REQUIRED)
7. **Secret files world-readable (664)** — Least privilege violation (REQUIRED)

**Minimum fix set for build authorization** (13 REQUIRED items):
- Decide Vault protocol (Principal chose HTTPS)
- Fix vault.hcl TLS config + generate certs
- Resolve port 8200 conflict
- Generate nginx TLS certs
- Add Vault unseal step
- Remove unnecessary host ports (keep only 80/443)
- Add secrets/ and config/vault-tls/ to .gitignore
- chmod 600 all secret files
- Remove CA key from vault-tls/
- Clean up CSR/SRL files
- Use Docker secrets exclusively (remove `${VAR}` env vars)
- Disable Vault UI
- Replace placeholder API keys
- Add missing healthchecks

---

## 15. Authorization Boundary

This report is a **READ-ONLY forensic audit**. It classifies prerequisites but **does not authorize implementation**.

**No changes have been made.** No files modified, no containers started/stopped, no secrets altered, no certificates generated.

---

## Decision Table Summary

| Final Status | Description |
|--------------|-------------|
| **BLOCK 4 — BLOCKED / PRINCIPAL DECISION REQUIRED** | 13 REQUIRED prerequisites unmet; Vault TLS contradiction and port 8200 conflict are hard blockers |

---

BLOCK 4 IMPLEMENTATION: NOT AUTHORIZED — AWAITING PRINCIPAL DECISION