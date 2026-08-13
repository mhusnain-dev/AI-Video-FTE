# Phase 7: Observability, Audit & Non-Functional — Implementation Plan

**Project**: AI Video Production Specialist Digital FTE
**Phase**: 7 — Observability, Audit & Non-Functional
**Task**: 47 — Health & Metrics Endpoints
**Started**: 2026-08-07
**Status**: In Progress

---

## Overview

Task 47 implements health check endpoints and Prometheus metrics exposition as specified in FR-034, NFR-001–003, and AC-029. This is the foundation for all subsequent observability tasks.

---

## Task 47 Subtasks

| Subtask | Description | Status | Dependencies |
|---------|-------------|--------|--------------|
| 47.1 | Create `src/shared/health.ts` — Health check registry & component checks | Pending | — |
| 47.2 | Create `src/shared/metrics.ts` — Prometheus client singleton | Pending | — |
| 47.3 | Add database query latency histogram to `src/shared/db.ts` | Pending | 47.2 |
| 47.4 | Add Redis/Vault latency histograms to `src/shared/redis.ts` and `src/shared/vault.ts` | Pending | 47.2 |
| 47.5 | Implement per-service health check functions (7 services) | Pending | 47.1 |
| 47.6 | Implement HTTP route handlers: `/health`, `/health/live`, `/health/ready`, `/health/startup`, `/health/<service>`, `/metrics` | Pending | 47.1, 47.2, 47.5 |
| 47.7 | Add metrics endpoint server on port 9090 | Pending | 47.2 |
| 47.8 | Write unit tests for health checks | Pending | 47.1–47.6 |
| 47.9 | Write integration tests for HTTP endpoints | Pending | 47.6 |
| 47.10 | Run TypeScript typecheck, all tests, verify coverage | Pending | 47.8, 47.9 |

---

## Specification Traceability

| Requirement | Implementation |
|-------------|----------------|
| **FR-034** | FTE exposes health status and operational metrics |
| **NFR-001** | 99.5% monthly uptime — health endpoints enable monitoring |
| **NFR-002** | Latency — health checks expose latency metrics |
| **NFR-003** | Throughput — metrics expose concurrency gauges |
| **AC-029** | Given health status requested, when service healthy, then returns healthy status with metrics |

---

## Acceptance Criteria for Task 47

- [ ] `GET /health` returns aggregate health with all component checks
- [ ] `GET /health/live` returns 200 if process alive (liveness probe)
- [ ] `GET /health/ready` returns 200 if dependencies ready (readiness probe)
- [ ] `GET /health/startup` returns 200 if startup complete (startup probe)
- [ ] `GET /health/ingestion`, `/health/router`, `/health/admission`, `/health/dispatch`, `/health/facelock`, `/health/merger` return service-specific health
- [ ] `GET /metrics` on port 9090 exposes Prometheus-formatted metrics
- [ ] All new code has ≥80% test coverage
- [ ] All existing 175 tests still pass
- [ ] TypeScript typecheck passes

---

## Constitutional Compliance

- Small reversible changes: Each subtask is independently verifiable
- Files Are Memory: Plan documented here, progress.md updated
- Verification Before Trust: Tests required before completion
- Specification Stability: No behavioral changes to existing functionality
- Human as Principal: Task 48 requires separate approval

---

## Integration Points

| Component | Integration |
|-----------|-------------|
| `src/shared/db.ts` | Query latency histogram |
| `src/shared/redis.ts` | Command latency histogram |
| `src/shared/vault.ts` | Encrypt/decrypt latency histogram |
| `src/shared/events.ts` | Health check for event bus |
| `src/ingestion/storyService.ts` | Ingestion health check |
| `src/router/autoRouter.ts` | Router health check |
| `src/admission/admissionController.ts` | Admission health check |
| `src/dispatch/shotDispatcher.ts` | Dispatch health check |
| `src/verification/faceLockVerification.ts` | Face-Lock health check |
| `src/merger/merger.ts` | Merger health check |
| `src/main.ts` | Metrics server startup |
| `config/development.yaml` | metricsPort (9090), healthCheckIntervalMs (30000) |