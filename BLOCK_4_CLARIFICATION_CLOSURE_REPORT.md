# BLOCK 4 CLARIFICATION CLOSURE REPORT

**Date**: 2026-08-10  
**Status**: CLARIFICATION RESOLVED — IMPLEMENTATION NOT YET AUTHORIZED

---

## 1. Principal Decisions Recorded

| Decision ID | Question | Principal Choice | Clarification Entry |
|-------------|----------|------------------|---------------------|
| **CL-024** | Vault Production TLS Protocol: HTTPS (self-signed for verification) vs HTTP | **Option A: HTTPS/TLS** — Self-signed certificates acceptable for local verification/build phase. Production-grade CA/cert requirements must remain explicitly distinguished from local verification certificates. | `specs/ai-video-fte/spec.md` — CL-024 |
| **CL-025** | Dev/Prod Coexistence: Mutual exclusion vs different dev ports vs full isolation | **Option B: Different host ports for dev** — Production retains standard ports (5432, 6379, 8200, 3000, 9090, 9091, 3001, 80, 443, 9093). Development uses clearly documented non-conflicting host ports (offset by +1: 5433, 6380, 8201, 3001, 9091, 9092, 3002). Dev and production remain isolated in Docker project/network/volume configuration. Internal service-to-service addresses must not be altered by port changes. | `specs/ai-video-fte/spec.md` — CL-025 |

---

## 2. Evidence Supporting Each Decision

### CL-024: Vault Production TLS Protocol = HTTPS/TLS

| Evidence Source | Finding |
|-----------------|---------|
| `config/vault.hcl:14, 46-47` | `api_addr = "https://vault:8200"`, `cluster_addr = "https://vault:8201"` — config already declares HTTPS |
| `config/vault.hcl:15-18` | Listener cert paths configured (`tls_cert_file`, `tls_key_file`, `tls_client_ca_file`) |
| `docker-compose.prod.yaml:103` | `VAULT_ADDR=https://vault:8200` for API service |
| `docker-compose.prod.yaml:73` | Vault healthcheck uses `-tls-skip-verify` (HTTPS flag) |
| `scripts/setup-secrets.sh:115-120` | Generates TLS certs in `config/vault-tls/` (ca.crt, vault.crt, vault.key) |
| `config/vault-tls/` (directory) | **Certs already generated**: ca.crt, vault.crt, vault.key present |
| Forensic TLS/Vault Auditor | "Current TLS Status: `tls_disable = true` in vault.hcl — TLS currently DISABLED. Blockers for HTTPS: vault.hcl line 14 must be `false` with cert paths" |
| Preflight Auditor | *"Principal must declare production intent for Vault: HTTP or HTTPS. This is a behavioral change requiring Clarification (Phase 4)."* |
| 4/5 Forensic Auditors | Classify as **BEHAVIORAL CHANGE** requiring Phase 4 Clarification per CLAUDE.md §8 |

### CL-025: Dev/Prod Coexistence = Different Host Ports for Dev

| Evidence Source | Finding |
|-----------------|---------|
| `docker-compose.yaml` (dev) | Binds: 5432, 6379, 8200, 3000, 9090, 9091, 3001 |
| `docker-compose.prod.yaml` (prod) | Binds: 5432, 6379, 8200, 8201, 3000, 9090, 9091, 3001, 80, 443, 9093 |
| Docker/Infra Auditor | "7 identical ports — cannot run simultaneously. Same network name `fte-network`, overlapping volume names" |
| Prod Arch Auditor | "dev_prod_drift: both stacks bind identical host ports... Cannot run simultaneously" |
| Security Auditor | "7 internal services expose unnecessary host ports" (production hardening finding) |
| Forensic consensus | All 5 auditors agree on dev/prod port collision |

---

## 3. Governance Basis

### CLAUDE.md §8 — Specification Stability Rule
> **"Once the Principal approves the behavioural specification (end of Phase 3), it becomes the immutable baseline for implementation."**
> 
> | Change Type | Path Required |
> |-------------|---------------|
> | **Behavioural change** (adds, removes, or modifies observable behaviour) | **Must return to Clarification (Phase 4) for explicit Principal approval** |
> | Wording/ambiguity fix (no observable behaviour change) | May be applied directly with note in `progress.md` |

**Application to CL-024**: Vault TLS protocol choice modifies **observable security posture** (external API scheme, cert validation behavior, client mTLS requirements). Specification (`spec.md`) has **ZERO** Vault protocol requirements. 4/5 auditors + Preflight = behavioral change. **Clarification required and completed.**

**Application to CL-025**: Dev/Prod coexistence strategy modifies **developer observable workflow** (can/cannot run simultaneously, port numbers differ, connection strings differ). This is a behavioral change to developer experience. **Clarification required and completed.**

### CLAUDE.md §9 — Clarification Rules
> "Interview the human **one question at a time**. Wait for answer. Update the relevant section of `spec.md` immediately. Update `progress.md`. Repeat."
> "Termination: Continue until ambiguity is eliminated (human confirms 'nothing left to misread')."

**Compliance**: Both decisions recorded as formal Clarification entries (CL-024, CL-025) in `spec.md` §11 Clarification Log. `progress.md` updated with decisions in "Approved Decisions" section. Ambiguity eliminated.

### CLAUDE.md §16 — System of Record Principle
> "The default authoritative System of Record for all Digital FTE projects in this repository is centered on PostgreSQL..."
> 
> *No impact — these are deployment/infrastructure decisions, not System of Record changes.*

### INTENT.md — Immutable Invariants (Preserved)
- **Sacred Guard** (Moderation → Sacred → Cost → Rate Limit ordering) — **Unaffected**
- **Face-Lock** (Persistent identity across shots) — **Unaffected**
- **PostgreSQL as System of Record** — **Unaffected**

---

## 4. Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `specs/ai-video-fte/spec.md` | **Modified** | Added CL-024 and CL-025 to §11 Clarification Log (after CL-023) |
| `progress.md` | **Modified** | Updated "Last Updated" to 2026-08-10; Current Phase/Status to reflect Block 4 Clarification Resolved; Added CL-024 and CL-025 to "Approved Decisions"; Updated "Next Recommended Action" to reflect implementation not yet authorized |

---

## 5. Files Deliberately NOT Changed

| File | Reason |
|------|--------|
| `config/vault.hcl` | **Implementation** — requires `tls_disable=false` but Block 4 build not authorized |
| `docker-compose.yaml` | **Implementation** — requires dev port offset (+1) but build not authorized |
| `docker-compose.prod.yaml` | **Implementation** — no changes needed for these decisions (production keeps standard ports) |
| `scripts/setup-secrets.sh` | **Implementation** — already generates Vault TLS certs; no changes needed |
| `config/vault-tls/` | **Runtime artifacts** — certs already generated; no changes |
| `config/nginx-tls/` | **Implementation** — nginx certs still missing (separate MUST-FIX item #3) |
| `secrets/` | **Implementation** — .gitignore, permissions, placeholder keys are separate MUST-FIX items |
| `scripts/validate-deployment.sh` | **Implementation** — "accepts none" fix is separate MUST-FIX item #16 |
| `.gitignore` | **Implementation** — adding secrets/ and config/vault-tls/ is separate MUST-FIX item #6 |
| `CLAUDE.md` | **Constitution** — no constitutional change needed; decisions comply with §8 |
| `AGENTS.md` | **Guidance** — no guidance update needed; decisions follow existing patterns |
| `INTENT.md` | **Immutable** — explicitly forbidden to modify per INTENT.md §45-49 |
| `plans/ai-video-fte/plan.md` | **Implementation plan** — build not yet authorized; plan will be updated post-authorization |
| `BLOCK_4_SAFE_BUILD_PREREQUISITES.md` | **Forensic audit** — historical record, not modified |
| `BLOCK_4_BUILD_READINESS_GATE.md` | **Forensic verification** — historical record, not modified |

---

## 6. Remaining Implementation Prerequisites (from BLOCK_4_BUILD_READINESS_GATE.md)

**The following 13 MUST-FIX items remain pending and CANNOT BEGIN until explicit Principal Build Authorization is given:**

| # | Prerequisite | Classification | Delegable After Decisions? |
|---|--------------|----------------|----------------------------|
| 2 | Resolve Vault port 8200 "address already in use" | Runtime | ✅ Yes |
| 3 | Generate nginx TLS certificates in config/nginx-tls/ | Configuration / Security | ✅ Yes |
| 4 | Add Vault unseal step before api depends_on | Deployment / Runtime | ✅ Yes |
| 5 | Remove unnecessary host port bindings (7 services) | Security / Network | ✅ Yes |
| 6 | Add `secrets/` and `config/vault-tls/` to .gitignore | Security | ✅ Yes |
| 7 | Change all secret file permissions from 664 to 600 | Security | ✅ Yes |
| 8 | Remove CA private key (ca.key) from config/vault-tls/ | Security (PKI) | ✅ Yes |
| 9 | Clean up vault.csr and ca.srl after TLS generation | Security (Hygiene) | ✅ Yes |
| 10 | Switch docker-compose to use Docker secrets exclusively | Security / Configuration | ✅ Yes |
| 11 | Disable Vault UI in production (`ui = false`) | Security | ✅ Yes |
| 12 | Replace placeholder API keys with actual values | Configuration | ✅ Yes |
| 13 | Add healthchecks for nginx, frontend, prometheus, grafana, alertmanager | Observability / Validation | ✅ Yes |
| 16 | Fix validation script to reject "none" healthcheck status | Validation | ✅ Yes |

**Total: 14 actionable items** (13 from gate + validation script fix item 16)

### 2 SAFE TO DEFER (Post-Build Hardening)
| # | Prerequisite | Classification |
|---|--------------|----------------|
| 15 | Add nginx upstream for Vault if external access needed | Optional enhancement |
| 17 | Configure VAULT_CACERT or NODE_EXTRA_CA_CERTS for API client | mTLS hardening |

### 0 VERIFICATION-ONLY (No Implementation)
| # | Prerequisite | Note |
|---|--------------|------|
| 18 | Remove legacy CSR/SRL files from vault-tls/ | Duplicate of #9 |

---

## 7. Explicit Status Declaration

### BLOCK 4 — CLARIFICATION RESOLVED
### IMPLEMENTATION — NOT YET AUTHORIZED
### WAITING FOR EXPLICIT PRINCIPAL BUILD AUTHORIZATION

---

## 8. Next Steps (Post-Authorization)

Upon explicit Principal Build Authorization:

1. **Plan Update**: Update `plans/ai-video-fte/plan.md` with 14 implementation steps
2. **Task Initialization**: Create tasks via `TaskCreate` for each MUST-FIX item
3. **Implementation**: Execute fixes in dependency order:
   - Port conflict resolution (Vault 8200)
   - nginx TLS cert generation
   - Vault unseal automation
   - Host port binding reduction (prod compose)
   - .gitignore updates
   - Secret file permission hardening
   - Vault TLS artifact cleanup
   - Docker secrets migration
   - Vault UI disable
   - Placeholder key replacement
   - Healthcheck additions (5 services)
   - Validation script fix
4. **Verification**: Run `make validate`, full test suite (248 tests), security scan
5. **Documentation**: Update `progress.md` with completed items

---

*End of Clarification Closure Report*