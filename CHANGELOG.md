# Changelog

All notable changes to the AI Video Production Specialist Digital FTE will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Phase 9 — DoD Gap Resolution + Feature Completion (in progress)

#### Documentation
- Created CHANGELOG.md
- Wrote runbooks for all 16 Prometheus alert rules
- Updated README.md with current project status and architecture
- Updated docs/workflow-guide.md with accurate workflow state

#### Frontend Quality
- Setup Vitest with jsdom environment for frontend unit testing
- Setup Playwright for end-to-end testing
- Wrote 5 frontend unit tests (userId, Modal, Layout, uiStore, api types)

#### Validation & Testing
- Created OpenAPI 3.1 specification documenting all API endpoints
- Wrote 3 contract tests validating API responses against OpenAPI spec

---

### Phase 8 — Deployment Preparation (2026-08-17)

#### Added
- Task 54: Production configuration — Dockerfiles, docker-compose.prod.yaml, secrets management
- Task 55: Reverse proxy & TLS — nginx.conf with rate limiting, security headers, self-signed cert generation
- Task 56: Monitoring stack — prometheus.prod.yml, alertmanager.yml, 10 Grafana dashboards, 16 alert rules
- Task 57: Kubernetes manifests — k8s/base/ and k8s/overlays/production/
- Task 58: Validation & runbooks — validate-deployment.sh, Makefile, CI/CD pipeline

---

### Phase 7 — Observability, Audit & Non-Functional (2026-08-16)

#### Added
- Task 47: Prometheus metrics (15+ custom metrics, port 9090)
- Task 48: Grafana dashboards (10 dashboards: Pipeline, Routing, Admission, Dispatch, Face-Lock, Assembly, Cost, Infrastructure, Sacred Guard, Rate Limit/Webhook)
- Task 49: Alert rules (14 rules: 5 critical, 6 warning, 3 info)
- Task 50: Structured JSON logging (Pino) with distributed trace context
- Task 51: Redis Stream consumers (MetricsAggregator, AlertEvaluator, AuditArchiver, DashboardUpdater)
- Task 52: ConsumerManager (lifecycle, health checks, graceful shutdown)
- Task 53: Immutable DB triggers on audit tables (7-year retention)

---

### Phase 6 — Video Assembly & Delivery (2026-08-15)

#### Added
- Task 41: Shot Merger — FFmpeg assembly (libx264 crf23, aac 128k, +faststart)
- Task 42: Transition system — 21 built-in FFmpeg xfade presets
- Task 43: Audio handling — ElevenLabs TTS + royalty-free/ElevenLabs/custom music
- Task 44: Output formats — MP4 + SRT/VTT/ASS subtitles
- Task 45: Delivery package — signed URL (7-day TTL), cost summary, logs, verification reports
- Task 46: Partial regeneration — re-generate specific shots, re-verify, re-merge

---

### Phase 5 — Face-Lock / Identity Persistence (2026-08-14)

#### Added
- Task 35: Character registry with Vault Transit encryption (completed in Task 16)
- Task 36: Face-Lock conditioning per model (per-model reference injection)
- Task 37: Face-Lock post-generation verification (cosine similarity vs reference embedding)
- Task 38: Face-Lock auto-regeneration on failure (configurable retries, default 2)
- Task 39: Cross-shot identity consistency (drift detection, recommendations)
- Task 40: Multi-character Face-Lock scenes (independent verification per character)

---

### Phase 4 — Shot Generation, Dispatch & Recovery (2026-08-13)

#### Added
- Task 28: Prompt compiler with character identity (per-model conditioning)
- Task 29: Shot dispatcher (concurrent dispatch, idempotency guard)
- Task 30: Webhook ingestion endpoint (HMAC-SHA256 verification)
- Task 31: Webhook Watchdog (30s poll, 10min max wait)
- Task 32: Timeout & automatic fallback (timeout → re-dispatch to next model)
- Task 33: All-models-failed handling (escalate to user)
- Task 34: Cost tracking & drift alerts (>50% single-shot, >20% rolling avg)

---

### Phase 3 — Admission Control Pipeline (2026-08-12)

#### Added
- Task 21: Moderation gate (violence, sexual, hate, PII, CSAM detection)
- Task 22: Sacred Guard denylist with 5 enforcement points (creation, registry, moderation, pre-dispatch, post-audit)
- Task 23: Sacred Guard dual-authorization (two-person rule for denylist changes & appeals)
- Task 24: Cost Guard (per-story budget, drift detection, pause with options)
- Task 25: Rate Limit gate (per-model, per-user, global limits)
- Task 26: Admission audit log (immutable record of every gate decision)
- Task 27: Admission ordering enforcement test (Moderation → Sacred → Cost → Rate Limit)

---

### Phase 2 — Model Selection & Routing (2026-08-11)

#### Added
- Task 17: Model registry (capabilities, eligibility, cost, regions, pgvector indexing)
- Task 18: AUTO Router (per-user priority list, system default, eligibility filtering, fallback chain)
- Task 19: Manual model override (per-shot pin bypassing AUTO)
- Task 20: Model adapter interface (pluggable Veo 3, Runway adapters with dispatch, status, webhook, cancellation)

---

### Phase 1 — Story Ingestion & Planning (2026-08-10)

#### Added
- Task 12: Story ingestion API (POST /stories, narrative, duration, aspect ratio, character refs, style refs)
- Task 13: Shot decomposition engine (narrative → structured shots with visual description, duration, camera, characters, objects, audio cues)
- Task 14: Shot plan presentation API (user confirmation before generation)
- Task 15: Plan revision API (add/remove/reorder/edit shots)
- Task 16: Character reference upload with face detection + Sacred Guard registry check

---

### Phase 0 — Foundation & Infrastructure (2026-08-09)

#### Added
- Task 6: Project structure (src/, tests/, migrations/, config/)
- Task 7: PostgreSQL schema — 5 migrations (extensions, core tables, admission/sacred, events/cost/dispatch, delivery/observability)
- Task 8: Redis Streams — story_commands, story_events, webhook_ingress, job_status with consumer groups
- Task 9: Vault Transit — DEK/KEK encryption, 90-day rotation, zero-downtime re-encryption
- Task 10: Event bus — Story/shot/character state machines, immutable event log, Redis Stream publishing
- Task 11: Configuration — YAML + env overrides, per-user model priorities, all CL-001–CL-023 defaults

---

## Block 4 — Safe Build Prerequisites (2026-08-07)

### Completed (12/13 items)
- Removed host port bindings for internal services (postgres, redis, vault, api, prometheus, grafana, alertmanager)
- Fixed Vault healthcheck to require `Sealed false`
- Generated nginx TLS certificates (self-signed for dev, CA for production)
- Fixed Vault PKI cleanup (removed ca.key, vault.csr, ca.srl)
- Docker secrets migration (services read from /run/secrets/*)
- Added healthchecks for nginx and frontend
- Fixed validate-deployment.sh to reject "none" health status
- Enforced 600 permissions on all secret files
- Added secrets/ and config/vault-tls/ to .gitignore
- Disabled Vault UI (ui=false) on public port
- Dev/Prod port offset (+1) for dev stack

### Blocked (1 item)
- Replace placeholder API keys — pending real credentials from Principal

---

## Phase 4 — Clarification (2026-08-06)

### Decisions (CL-001 through CL-040)
- CL-001: Sacred Guard threshold — configurable per-model (default 0.75–0.80 cosine similarity)
- CL-002: Face-Lock threshold — configurable per-model/character with per-model defaults
- CL-003: Face-Lock max retries — configurable per-model/character (default: 2)
- CL-004: Duration tolerance — configurable per story with per-model default
- CL-005: Max shot limit — duration-based (ceil(target_duration / model_max_shot_duration))
- CL-006: Model selection — per-user configured priority list (system default when unconfigured)
- CL-007: Shot timeout — per-model defaults (user-overridable per story)
- CL-008: Webhook watchdog — 30s interval, 10min max wait
- CL-009: Dual-authorization — two-person rule for denylist changes & appeals
- CL-010: Cost estimation — per-model defaults (user-overridable per story)
- CL-011: Cost drift — configurable per story (defaults >50% single-shot, >20% rolling avg)
- CL-012: Rate limits — configurable defaults (per-model, per-user, global; overridable per project)
- CL-013: Audio — ElevenLabs TTS with voice/style selection + royalty-free + ElevenLabs music
- CL-014: Transitions — FFmpeg filters, 0.5s cross-fade default (overridable)
- CL-015: Resolutions — 720p/1080p/4K, default 1080p
- CL-016: Cancellation — user choice (complete in-progress / stop now / stop after current)
- CL-017: Encryption — 90-day rotation, zero-downtime automated re-encryption
- CL-018: Aspect ratios — 16:9 (default), 9:16, 1:1, 4:5
- CL-019: Download TTL — 7 days
- CL-020: Transition types — FFmpeg filters (cross-fade default + fade/slide/zoom/wipe)
- CL-021: Character identity — auto-apply named reference image per character from registry
- CL-022: Music — royalty-free + ElevenLabs library
- CL-023: Subtitles — SRT (default), VTT, ASS
- CL-024: Vault production TLS — HTTPS/TLS with self-signed for verification
- CL-025: Dev/Prod coexistence — different host ports for dev (offset +1)
- CL-026: Luma provider — removed from scope entirely
- CL-027: Hybrid TTS — Piper deferred, ElevenLabs-only
- CL-028: Auth architecture — JWT + local passwords
- CL-029: Face-Lock verification — full real implementation (FFmpeg + ArcFace ONNX)
- CL-030: Prompt sanitizer — PII strip + model constraints + injection patterns
- CL-031: LLM prompt engine — LLM enhancement + template fallback + user review
- CL-032: Luma adapter removal — remove luma-ray2 from all config defaults
- CL-033: Weak secrets — auto-generate strong secrets in setup-secrets.sh
- CL-034: Frontend tests — Vitest + Playwright
- CL-035: MEDIUM issues — fix all MEDIUM issues (~2h extra)
- CL-036: LLM provider — Google Gemini 3.5 Flash
- CL-037: Face-Lock failure — auto-regenerate up to 2x, fail + alert
- CL-038: JWT refresh — no refresh token, 24h expiry
- CL-039: Local TTS — Piper deferred, ElevenLabs-only
- CL-040: Prompt review UX — dedicated review page

---

## Phase 3 — Specification (2026-08-05)

#### Added
- Created `specs/ai-video-fte/spec.md` — complete behavioural specification
- 36 Functional Requirements (FR-001 through FR-036)
- 12 Non-functional Requirements (NFR-001 through NFR-012)
- 10 Edge Cases (EC-001 through EC-010)
- 30 Acceptance Criteria (AC-001 through AC-030)
- 6 Scenarios (SC-001 through SC-006)
- Sacred Guard and Face-Lock invariants preserved from INTENT.md

---

## Phase 2 — Research (2026-08-05)

#### Added
- Created `research/findings-ai-video-fte.md`
- Prior art analysis (existing video production tools, AI generation platforms)
- Domain knowledge consolidation from `specs.md`
- Constraints, risks, failure modes, and trade-offs documented

---

## Phase 1 — Constitution (2026-08-05)

#### Added
- Created `CLAUDE.md` — repository constitution with 18 sections
- Created `AGENTS.md` — shared agent guidance for all agents
- Established: Human as Principal, Verification Before Trust, Files Are Memory, Small Reversible Changes
- Defined System of Record: PostgreSQL with pgvector, full-text search, durable work queues

---

## Known Limitations

- 12/13 Block 4 items complete (1 blocked on API keys)
- Phase 9 TODO table (62 tasks, ~144h) awaiting Principal approval
- Provider API keys still read from process.env (Vault wiring is a Build task)
- Music fetcher `getMusicTrack()` is a placeholder stub
- No real auth backend yet (CL-028 planned but not implemented)
- Frontend has 49 `any` types pending fix
