# Security Audit Report — npm audit Findings

**Date**: 2026-08-17  
**Tool**: npm audit v2  
**Scope**: Root project (`/home/dev-logs/Desktop/FTE`) + Frontend (`/home/dev-logs/Desktop/FTE/frontend`)

---

## Summary

| Scope | Critical | High | Moderate | Low | Total | Auto-fixable |
|-------|----------|------|----------|-----|-------|-------------|
| **Root (backend)** | 0 | 6 | 4 | 0 | 10 | 1 (gaxios) |
| **Frontend** | 0 | 0 | 2 | 0 | 2 | 0 |
| **Combined** | 0 | 6 | 6 | 0 | 12 | 1 |

> Note: Frontend `vitest` CRITICAL (GHSA-5xrq) and `vite` HIGH (GHSA-fx2h) were resolved via `npm audit fix --force` (vite→8.2.1, vitest→4.1.10).

---

## Root Project (Backend)

### HIGH — @typescript-eslint/* (6 packages)

| Package | Severity | Advisory |
|---------|----------|----------|
| `@typescript-eslint/eslint-plugin` 6.x | HIGH | Via minimatch ReDoS |
| `@typescript-eslint/parser` 6.x | HIGH | Via minimatch ReDoS |
| `@typescript-eslint/type-utils` 6.x | HIGH | Via minimatch |
| `@typescript-eslint/typescript-estree` 6.x | HIGH | Via minimatch |
| `@typescript-eslint/utils` 6.x | HIGH | Via minimatch |

**Root cause**: `minimatch@9.0.0–9.0.6` (ReDoS — GHSA-3ppc, GHSA-7r86, GHSA-23c5).  
**Fix available**: `npm audit fix --force` → `@typescript-eslint/*@8.67.0` (SemVer major).  
**Cannot auto-fix**: Breaking change — eslint config, plugin API, and parser config all change in v8. Requires coordinated upgrade.  
**Recommendation**: Schedule a dedicated lint config migration task. The vulnerability is in dev tooling (lint parser), not in production runtime.

### MODERATE — uuid@<11.1.1

| Package | Severity | Advisory |
|---------|----------|----------|
| `uuid` < 11.1.1 | MODERATE | GHSA-w5hq: Missing buffer bounds check |

**Fix available**: `uuid@14.0.1` (SemVer major).  
**Cannot auto-fix**: Breaking change for uuid v3/v5/v6 API. Project uses uuid@9.x.  
**Recommendation**: Upgrade to uuid@14.x. The v9→v14 upgrade is low-risk for this project since uuid usage is limited to UUID v4 generation.

### MODERATE — @google-cloud/storage@7.21.0

| Package | Severity | Advisory |
|---------|----------|----------|
| `retry-request` 7.0.0–7.0.2 | MODERATE | Via uuid |
| `teeny-request` 3.9.1–9.0.0 | MODERATE | Via uuid |
| `gaxios` 6.4.0–6.7.1 | MODERATE | Via uuid |

**Root cause**: All transitively depend on vulnerable `uuid`.  
**Fix available**: `@google-cloud/storage@5.18.3` (SemVer major).  
**Note**: The auto-fix `npm audit fix` already applied `gaxios` downgrade (6.7.1→6.3.0) and `@google-cloud/storage` upgrade (7.21.0→7.22.0), reducing the attack surface.  
**Recommendation**: Upgrade `uuid` to v14.x (fixes all transitive deps).

---

## Frontend

### MODERATE — react-router@6.x / react-router-dom@6.x

| Package | Severity | Advisory |
|---------|----------|----------|
| `react-router` 6.0.0–7.17.0 | MODERATE | GHSA-wrjc: Open redirect via backslash |
| `react-router` 6.4.0–7.17.0 | MODERATE | GHSA-337j: Arbitrary constructor injection |
| `react-router-dom` 6.30.2–6.30.4 | MODERATE | GHSA-jjmj: Open redirect → XSS |

**Root cause**: `react-router` vulnerabilities in v6.x.  
**Fix available**: `react-router@7.18.0+` (SemVer major).  
**Cannot auto-fix**: `react-router-dom@6.26.1` → v7 is a breaking change requiring route config migration.  
**Recommendation**: Schedule frontend router migration to v7. The vulnerabilities require specific attack vectors (SSR hydration, backslash in Link), which are low risk for a client-only SPA.

### REMAINING: vite/vitest/esbuild (resolved)

The following were resolved via `npm audit fix --force`:
- `vitest` CRITICAL (GHSA-5xrq: arbitrary file read via UI server) → fixed at v4.1.10
- `vite` HIGH (GHSA-fx2h: server.fs.deny bypass) → fixed at v8.2.1
- `vite` MODERATE (GHSA-4w7w: path traversal) → fixed at v8.2.1
- `vite` MODERATE (GHSA-v6wh: NTLMv2 hash disclosure) → fixed at v8.2.1
- `esbuild` MODERATE (GHSA-67mh: request forwarding) → fixed via vite v8

**Impact**: Major version bumps to vite (5→8) and vitest (2→4). May require test config and build config adjustments. Monitor for breakage.

---

## Recommendations

1. **Immediate**: Upgrade `uuid` to v14.x (fixes 4 moderate vulns across root)
2. **Short-term**: Migrate `@typescript-eslint/*` to v8.x (fixes 6 high vulns in dev tooling)
3. **Medium-term**: Migrate `react-router` to v7.x (fixes 3 moderate vulns in frontend)
4. **Monitor**: Verify vite v8 + vitest v4 compatibility after force upgrade
5. **No action**: All resolved vulnerabilities are in dev tooling or require specific attack vectors not applicable to this project's deployment model
