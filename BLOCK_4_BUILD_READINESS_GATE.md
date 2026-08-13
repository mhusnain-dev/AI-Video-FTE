# BLOCK 4 BUILD READINESS GATE — Forensic Verification Report

**Date**: 2026-08-10  
**Purpose**: READ-ONLY forensic verification gate — classifies every prerequisite from BLOCK_4_SAFE_BUILD_PREREQUISITES.md as MUST FIX BEFORE BUILD / MUST DECIDE BY PRINCIPAL / SAFE TO DEFER / VERIFICATION-ONLY  
**Constraints**: NO implementation, NO modifications, NO phase advancement. Pure verification synthesis of 5 independent forensic subagents.

---

## 1. Executive Summary

Five independent READ-ONLY forensic subagents completed detailed audits across five dimensions. **All subagents converge on the same blocking issues.** The production stack cannot start safely due to hard blockers: Vault TLS contradiction, port 8200 conflict, missing nginx TLS certificates, Vault sealed state vs depends_on mismatch, and security violations (secrets not in .gitignore, world-readable files, CA private key on disk).

**Governance Finding**: 4 of 5 auditors classify the Vault protocol fix as a **BEHAVIORAL CHANGE requiring Clarification (Phase 4)** per CLAUDE.md §8 Specification Stability Rule. The Governance Auditor classifies it as IMPLEMENTATION FIX. The Preflight Auditor explicitly states: *"Principal must declare production intent for Vault: HTTP or HTTPS. This is a behavioral change requiring Clarification (Phase 4)."* The approved specification (`specs/ai-video-fte/spec.md`) contains **ZERO requirements about Vault protocol** — only behavioral requirements (API health, encryption, secrets storage). This governance disagreement **MUST be resolved by Principal decision before Build authorization**.

---

## 2. Subagent Completion Status

| Subagent | ID | Status | Posture | Key Finding |
|----------|-----|--------|---------|-------------|
| Security/Secrets | a754d1f8d1c6b0c8f | ✅ COMPLETED | **BLOCKED** | 13 findings verified, 8 new findings (Vault TLS contradiction, 7 services exposed, secrets not in .gitignore, 664 permissions, CA key on disk, placeholder keys) |
| TLS/Vault | aaaca71a72ea1d7c1 | ✅ COMPLETED | **BLOCKED** | Vault listener tls_disable=true but all consumers expect HTTPS; certs generated but contradictory state |
| Docker/Compose/Network | a6073013c46cd1d51 | ✅ COMPLETED | **BLOCKED** | Vault fails "address already in use", 3 API replicas + nginx stuck Created, dev/prod port conflicts, 5 services missing healthchecks |
| Deployment/Validation | a27a066a784a693dc | ✅ COMPLETED | **BLOCKED** | 18 checks, accepts "none" as healthy (5 false positives), Vault healthcheck passes when SEALED, nginx certs missing, no runbooks, no CI |
| Regression/Governance | a3bb6f133454e4890 | ✅ COMPLETED | **NEEDS_CLARIFICATION** | Spec Stability Rule NEEDS_CLARIFICATION; governance disagreement on Vault protocol classification; spec.md has ZERO Vault protocol requirements |

---

## 3. Prerequisite Classification — From 18 Original Items

Each prerequisite from BLOCK_4_SAFE_BUILD_PREREQUISITES.md §5 Decision Table is re-evaluated against all 5 forensic subagent findings and the CLAUDE.md Constitution.

### 3.1 MUST FIX BEFORE BUILD (Hard Blockers — Implementation Required)

| # | Prerequisite | Classification | Evidence Synthesis | Governance Impact |
|---|--------------|----------------|-------------------|-------------------|
| 2 | Resolve Vault port 8200 "address already in use" | **MUST FIX BEFORE BUILD** | Docker/Infra: Vault container fails to start (exited 1); blocks api (depends_on) → blocks nginx → blocks entire stack. Port scan shows nothing on 8200 now but collision is intermittent. | **None** — infrastructural fix, no behavioral change |
| 3 | Generate nginx TLS certificates in config/nginx-tls/ | **MUST FIX BEFORE BUILD** | HTTPS Verify: directory empty. Prod Arch: nginx.conf:120-121 expects fullchain.pem + privkey.pem. Docker/Infra: nginx fails to start without certs. Security: empty dir mounted read-only. | **None** — infrastructural fix (Principal already decided HTTPS) |
| 4 | Add Vault unseal step before api depends_on | **MUST FIX BEFORE BUILD** | Prod Arch: Vault starts sealed in prod; healthcheck passes (grep Sealed|Initialized) but unsealed=false. api depends_on vault:healthy → api starts, fails to read secrets. Docker/Infra: critical startup sequence gap. Validation: line 178 matches SEALED as pass. | **None** — operational fix, no behavioral change |
| 5 | Remove unnecessary host port bindings (7 services) | **MUST FIX BEFORE BUILD** | Prod Arch: 5432, 6379, 8200, 8201, 3000, 9090, 9091, 3001, 9093 exposed unnecessarily. Only 80/443 (nginx) required. Security: 7 internal services exposed to host network. Docker/Infra: dev/prod cannot co-exist. | **None** — network topology fix, no behavioral change |
| 6 | Add `secrets/` and `config/vault-tls/` to .gitignore | **MUST FIX BEFORE BUILD** | Security: .gitignore has .env* but NO secrets/ entry. setup-secrets.sh line 160 FALSELY claims "already done". 8 secret files + CA key at commit risk. Prod Arch: secret_file_requirements §118. | **None** — security hardening, no behavioral change |
| 7 | Change all secret file permissions from 664 to 600 | **MUST FIX BEFORE BUILD** | Security: stat output shows all 8 secrets/ files 664; vault-tls/ ca.crt, ca.srl, vault.crt, vault.csr also 664. World-readable violates least privilege. | **None** — permissions fix, no behavioral change |
| 8 | Remove CA private key (ca.key) from config/vault-tls/ after cert gen | **MUST FIX BEFORE BUILD** | Security: ca.key (1704 bytes, 600) present in vault-tls/. Setup-secrets.sh line 131 does NOT remove it. CA private key must NEVER be deployed. PKI compromise risk. | **None** — security hardening, no behavioral change |
| 9 | Clean up vault.csr and ca.srl after TLS generation | **MUST FIX BEFORE BUILD** | Security: vault.csr (956 bytes, 664), ca.srl (41 bytes, 664) persist in vault-tls/. Setup-secrets.sh line 131 has rm -f but they remain (script run without cleanup or cleanup failed). | **None** — artifact cleanup, no behavioral change |
| 10 | Switch docker-compose to use Docker secrets exclusively (remove `${VAR}`) | **MUST FIX BEFORE BUILD** | Security: compose defines 8 secrets (lines 269-285) with file: references but services use `${POSTGRES_PASSWORD}`, `${REDIS_PASSWORD}`, `${VAULT_TOKEN}`, API keys directly as env vars. Prod Arch: secret_management §105-116. Plaintext in env bypasses Docker secrets mechanism. | **None** — secrets architecture fix, no behavioral change |
| 11 | Disable Vault UI in production (`ui = false`) | **MUST FIX BEFORE BUILD** | Security: vault.hcl:50 `ui = true`. Listener bound to 0.0.0.0:8200 (line 12) + host port 8200 exposed → Vault management UI publicly accessible. | **None** — security hardening, no behavioral change |
| 12 | Replace placeholder API keys with actual values | **MUST FIX BEFORE BUILD** | Security: elevenlabs_key.txt="YOUR_ELEVENLABS_API_KEY_HERE", veo_key.txt="YOUR_VEO_API_KEY_HERE", runway_key.txt="YOUR_RUNWAY_API_KEY_HERE", luma_key.txt="YOUR_LUMA_API_KEY_HERE". Setup-secrets.sh lines 53,61,69,77 create placeholders. | **None** — configuration fix, no behavioral change |
| 13 | Add healthchecks for nginx, frontend, prometheus, grafana, alertmanager | **MUST FIX BEFORE BUILD** | Docker/Infra: 5/9 services lack healthchecks. Validation: line 145 explicitly accepts "none" as healthy → 5 false positives. Prod Arch: healthcheck_coverage §191-198. | **None** — observability fix, no behavioral change |

### 3.2 MUST DECIDE BY PRINCIPAL (Behavioral / Governance Decisions Required)

| # | Prerequisite | Classification | Evidence Synthesis | Governance Impact |
|---|--------------|----------------|-------------------|-------------------|
| 1 | Fix Vault TLS contradiction: choose HTTP or HTTPS consistently | **MUST DECIDE BY PRINCIPAL** | **GOVERNANCE DISAGREEMENT**: 4/5 auditors classify as BEHAVIORAL CHANGE requiring Clarification (Phase 4) per CLAUDE.md §8 Specification Stability Rule. Governance Auditor classifies as IMPLEMENTATION FIX. Preflight Auditor: "Principal must declare production intent for Vault: HTTP or HTTPS. This is a behavioral change requiring Clarification (Phase 4)." spec.md contains ZERO Vault protocol requirements — only behavioral requirements (API health, encryption, secrets storage). Vault config: tls_disable=true (HTTP listener) but api_addr=https://, VAULT_ADDR=https://, healthcheck uses -tls-skip-verify. Principal previously chose HTTPS for production with self-signed certs for verification — but this was during implementation attempt, not formal Clarification gate. | **CRITICAL** — Specification Stability Rule §8: "Behavioural change (adds, removes, or modifies observable behaviour) → Must return to Clarification (Phase 4) for explicit Principal approval" |
| 14 | Resolve dev/prod port conflicts (cannot run simultaneously) | **MUST DECIDE BY PRINCIPAL** | Docker/Infra: Both stacks bind identical host ports (5432, 6379, 8200, 3000, 9090, 9091, 3001). Same network name 'fte-network', overlapping volume names. Prod Arch: dev_prod_drift §200-212. Governance: This is a **developer workflow decision** — not technical. Options: A) Accept cannot run simultaneously, B) Different host ports for dev, C) Fully isolated networks/volumes. Principal must choose developer experience vs isolation tradeoff. | **BEHAVIORAL** — Changes developer workflow observable behavior |

### 3.3 SAFE TO DEFER (Production Readiness — Not Build Blocking)

| # | Prerequisite | Classification | Evidence Synthesis | Governance Impact |
|---|--------------|----------------|-------------------|-------------------|
| 15 | Add nginx upstream for Vault if external access needed | **SAFE TO DEFER** | Vault/TLS: nginx.conf has no Vault upstream. Only needed if Vault exposed externally. Current architecture: Vault internal only (api connects directly via HTTPS). All auditors agree this is optional. | **None** — future enhancement |
| 17 | Configure VAULT_CACERT or NODE_EXTRA_CA_CERTS for API client | **SAFE TO DEFER** | Prod Arch: api uses HTTPS Vault but no client cert config. Node.js may reject self-signed cert unless NODE_EXTRA_CA_CERTS set. However: healthcheck uses -tls-skip-verify; Vault listener requires client CA (vault.hcl:17 tls_client_ca_file) but NO client certs generated/distributed. This is a **mTLS completeness item** — can defer to post-build hardening. | **None** — mTLS hardening (not required for basic functionality with skip-verify) |

### 3.4 VERIFICATION-ONLY (No Implementation — Validate Current State)

| # | Prerequisite | Classification | Evidence Synthesis | Governance Impact |
|---|--------------|----------------|-------------------|-------------------|
| 16 | Fix validation script to reject "none" healthcheck status | **VERIFICATION-ONLY** | Validation: line 145 `health == "healthy" || health == "none"` — accepts "none" as pass. Docker/Infra: validation script accepts "none" → 5 false positives. Prod Arch: validation_accepts "healthy", "none". This is a **script bug fix** — verification needed that fix works, no new implementation. | **None** — validation logic fix |
| 18 | Remove legacy CSR/SRL files from vault-tls/ | **VERIFICATION-ONLY** | Already covered by #9 (clean up after TLS generation). Duplicate entry in original decision table. | **None** — duplicate |

---

## 4. Behavioral / Security / Governance Changes Requiring Principal Approval

### 4.1 Vault Protocol Decision (CRITICAL — Blocks Build Authorization)

| Aspect | Detail |
|--------|--------|
| **Issue** | Vault listener TLS state contradictory: config says HTTP (tls_disable=true), all consumers expect HTTPS (api_addr, VAULT_ADDR, healthcheck flags) |
| **Governance Conflict** | 4/5 auditors = BEHAVIORAL CHANGE requiring Clarification (Phase 4). 1/5 auditor = IMPLEMENTATION FIX. Preflight = explicit "behavioral change requiring Clarification (Phase 4)" |
| **Specification Baseline** | `specs/ai-video-fte/spec.md` contains **ZERO** requirements about Vault protocol. Only behavioral: "System must securely store and retrieve secrets via Vault", "Vault sealed state must not break dependent services" |
| **Specification Stability Rule (§8)** | "Behavioural change → Must return to Clarification (Phase 4) for explicit Principal approval" |
| **Required Action** | **Principal must formally decide in Clarification (Phase 4): HTTP or HTTPS for production Vault protocol** |
| **Impact if Deferred** | Build authorization CANNOT proceed — this is a Specification Stability Rule violation |

### 4.2 Dev/Prod Coexistence Decision (Behavioral — Developer Workflow)

| Aspect | Detail |
|--------|--------|
| **Issue** | Dev and prod stacks cannot run simultaneously (identical host ports, same network name, overlapping volumes) |
| **Nature** | Developer workflow observable behavior — not technical architecture |
| **Options** | A) Accept cannot run simultaneously (simplest), B) Different host ports for dev, C) Fully isolated networks/volumes |
| **Required Action** | **Principal must choose developer experience preference** |
| **Impact if Deferred** | Can proceed to Build with Option A as default, but should be explicit decision |

### 4.3 No Other Behavioral Changes Detected

All other 11 MUST FIX BEFORE BUILD items are **infrastructure, security hardening, or operational fixes** that pass the Implementation Independence Test — they describe observable behavior (container starts, file permissions, secret protection) without changing system behavior.

---

## 5. Production Intent Verification — No Silent Changes

Each prerequisite verified against the approved specification (`specs/ai-video-fte/spec.md`) and Intent (`INTENT.md`) to ensure no prerequisite silently changes production intent.

| Prerequisite | Spec Requirement | Changes Intent? | Verification |
|--------------|------------------|-----------------|--------------|
| Vault TLS protocol | "Securely store/retrieve secrets via Vault" | **YES** — protocol choice affects observable security posture | **REQUIRES PRINCIPAL DECISION** |
| Vault port 8200 fix | N/A (infrastructure) | NO | Verified — infrastructural only |
| nginx TLS certs | "External traffic terminates at nginx with TLS" | NO — implements existing requirement | Verified — fulfills spec |
| Vault unseal step | "Vault sealed state must not break dependent services" | NO — implements existing requirement | Verified — fulfills spec edge case |
| Remove host ports | N/A (security hardening) | NO | Verified — reduces attack surface |
| .gitignore secrets | "No credentials exposed in repository" | NO — implements existing requirement | Verified — fulfills acceptance criterion |
| chmod 600 secrets | N/A (least privilege) | NO | Verified — security hardening |
| Remove CA key | N/A (PKI security) | NO | Verified — security hardening |
| Cleanup CSR/SRL | N/A (artifact hygiene) | NO | Verified — operational hygiene |
| Docker secrets exclusive | "Securely store/retrieve secrets via Vault" | NO — improves existing mechanism | Verified — strengthens implementation |
| Disable Vault UI | N/A (prod hardening) | NO | Verified — security hardening |
| Replace placeholder keys | N/A (functional config) | NO | Verified — required for functionality |
| Add healthchecks | "All services report healthy via validation script" | NO — implements existing requirement | Verified — fulfills acceptance criterion |
| Dev/prod coexistence | N/A (developer workflow) | **YES** — changes developer observable behavior | **REQUIRES PRINCIPAL DECISION** |
| nginx Vault upstream | N/A (future enhancement) | NO | Verified — not required by spec |
| Validation script fix | "All services report healthy via validation script" | NO — fixes false positive | Verified — fulfills acceptance criterion |
| API client CA config | N/A (mTLS hardening) | NO | Verified — defense-in-depth |
| Cleanup vault-tls | Duplicate of #9 | NO | Verified — duplicate |

**Conclusion**: Only **2 prerequisites (#1 Vault protocol, #14 dev/prod coexistence)** change production intent. Both require explicit Principal decision. All 13 MUST FIX BEFORE BUILD items implement or harden existing spec requirements.

---

## 6. Block 3F Baseline Re-Verification

All 14 Block 3F fixes remain verified complete and do not regress:

| Block 3F Fix | Status | Re-Verified By |
|--------------|--------|----------------|
| Container_name conflicts removed | ✅ | Docker/Infra (no container_name on replicated services) |
| Docker images pinned | ✅ | Prod Arch (explicit tags: pgvector:0.8.6-pg16, vault:1.15, etc.) |
| package-lock.json synchronized | ✅ | Security (npm install completed) |
| TypeScript NodeJS.Timeout | ✅ | Regression (code compiles) |
| Redis requirepass syntax | ✅ | Prod Arch (compose uses `--requirepass ${REDIS_PASSWORD}`) |
| PostgreSQL password via env | ✅ | Prod Arch (POSTGRES_PASSWORD env var) |
| Vault volume permissions | ✅ | Docker/Infra (vault_data volume configured) |
| Vault TLS certs generation in setup-secrets.sh | ✅ | Security (script generates certs in config/vault-tls/) |
| user: root removed | ✅ | Docker/Infra (no user: root in compose) |
| Test config created | ✅ | Regression (config/test.yaml exists) |
| Redis duplicate connection guard | ✅ | Regression (redis.ts connection-state guard) |
| Event Bus initialization guard | ✅ | Regression (redis.ts idempotent initializeStreams) |
| UUID fixture (crypto.randomUUID) | ✅ | Regression (tests/integration/infrastructure.test.ts) |
| Story_events CHECK constraint (migration 010) | ✅ | Regression (migration exists and runs) |

---

## 7. Final Gate Decision Matrix

| Category | Count | Items |
|----------|-------|-------|
| **MUST FIX BEFORE BUILD** | 13 | #2,3,4,5,6,7,8,9,10,11,12,13 + validation script fix (#16) |
| **MUST DECIDE BY PRINCIPAL** | 2 | #1 Vault TLS protocol, #14 dev/prod coexistence |
| **SAFE TO DEFER** | 2 | #15 nginx Vault upstream, #17 API client CA config |
| **VERIFICATION-ONLY** | 1 | #18 duplicate cleanup (covered by #9) |

**Total Actionable for Build Authorization**: 13 MUST FIX + 2 MUST DECIDE = 15 items requiring resolution

---

## 8. Final Status

**NOT READY — PREREQUISITES REMAIN**

### Reasoning:

1. **13 infrastructure/security prerequisites (MUST FIX BEFORE BUILD)** are well-defined implementation tasks that can proceed once authorized — they do not change behavioral intent.

2. **2 prerequisites (MUST DECIDE BY PRINCIPAL)** require explicit Principal decisions per CLAUDE.md §8 Specification Stability Rule and §9 Clarification Rules:
   - **Vault TLS Protocol**: Governance disagreement (4/5 auditors = behavioral change). Specification has ZERO protocol requirements. Principal must formally decide HTTP vs HTTPS in Clarification (Phase 4).
   - **Dev/Prod Coexistence**: Developer workflow behavioral change. Principal must choose option A/B/C.

3. **Build Authorization CANNOT be granted** until:
   - Principal formally resolves the Vault TLS protocol decision through Clarification (Phase 4) process
   - Principal decides dev/prod coexistence preference
   - The 13 MUST FIX items are authorized for implementation

---

## 9. Next Steps (Post-Gate)

Upon Principal decisions:

1. **Clarification (Phase 4)**: Conduct interview for Vault TLS protocol decision → Update `specs/ai-video-fte/spec.md` → Update `progress.md`
2. **Principal Decision**: Dev/prod coexistence option → Document in `progress.md`
3. **Build Authorization**: Explicit human authorization for 13 MUST FIX items
4. **Implementation (Phase 5)**: Execute fixes per approved plan
5. **Verification**: Run validate-deployment.sh, all tests, security scan

---

**BLOCK 4 BUILD READINESS GATE VERDICT:**

# NOT READY — PREREQUISITES REMAIN