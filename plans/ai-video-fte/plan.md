# Implementation Plan: AI Video Production Specialist Digital FTE

**Project**: AI Video Production Specialist Digital FTE  
**Phase**: 5 — Build  
**Date**: 2026-08-06  
**Status**: Draft — Awaiting Review  
**Spec Version**: `specs/ai-video-fte/spec.md` (Approved)

---

## 1. Scope

| Item | Reference |
|------|-----------|
| Functional Requirements | FR-001 through FR-034 |
| Non-Functional Requirements | NFR-001 through NFR-008 |
| Constraints | CON-001 through CON-007 |
| Edge Cases | EC-001 through EC-020 |
| Acceptance Criteria | AC-001 through AC-033 |
| Mandatory Invariants | Sacred Guard Ordering (CON-001), Sacred Guard Coverage (CON-002), Face-Lock Persistence (CON-003), Postgres SoR (CON-004) |

**Out of Scope** (per spec §8): User auth, billing, hosting, creative writing, model training, real-time collab, mobile apps, prompt translation, compliance workflow, custom model deployment, 3D generation, live streaming.

---

## 2. High-Level Approach

**Architecture**: Event-driven, async pipeline with PostgreSQL as System of Record (§8.2, CON-004) and Redis Streams for durable work queues. Seven core services communicating via events:

| Service | Responsibility | Key Spec Sections |
|---------|---------------|-------------------|
| **Ingestion API** | Story acceptance, shot decomposition, plan presentation | FR-001–FR-004, AC-001–AC-004 |
| **Router** | Model selection, eligibility, AUTO priority | FR-005–FR-008, AC-014 |
| **Admission Controller** | Fixed-order gates: Moderation → Sacred → Cost → Rate Limit | FR-009–FR-015, AC-005–AC-013, CON-001, CON-002 |
| **Dispatch & Recovery** | Shot dispatch, webhook ingestion, watchdog polling, fallback | FR-016–FR-021, AC-015–AC-018 |
| **Face-Lock** | Registry, conditioning, verification, cross-shot consistency | FR-022–FR-026, AC-019–AC-022, CON-003 |
| **Merger** | Shot assembly, transitions, audio, TTS, delivery | FR-027–FR-030, AC-023–AC-025 |
| **Observability** | State notifications, audit logs, health, cost tracking | FR-031–FR-034, AC-026–AC-033, NFR-001–NFR-008 |

**Implementation Principles** (CLAUDE.md):
- Small reversible changes — one logical change per commit
- Verification before trust — unit tests (≥80%), contract tests, integration tests
- Files are memory — all decisions in docs, not conversation
- Implementation independence — behavioural spec only, no tech leakage

---

## 3. Implementation Steps

### Phase 0: Foundation & Infrastructure (Week 1)

| Step | Description | Spec Trace | Verification | Depends On |
|------|-------------|------------|--------------|------------|
| 0.1 | Initialize project structure: `src/`, `tests/`, `migrations/`, `config/` | — | Lint, type-check pass | — |
| 0.2 | PostgreSQL schema: stories, shots, characters, audit logs, events, cost tracking, sacred denylist | CON-004, FR-032, FR-033, NFR-004 | Migrations apply cleanly; RPO=0 verified | 0.1 |
| 0.3 | Redis Streams setup: `story_commands`, `story_events`, `webhook_ingress`, `job_status` consumer groups | CON-004, FR-017, FR-019 | Stream produce/consume works | 0.1 |
| 0.4 | Vault Transit integration for biometric encryption (90-day rotation) | NFR-006, EC-019 | Encrypt/decrypt roundtrip; rotation test | 0.2 |
| 0.5 | Core event bus & state machine for story lifecycle | FR-031, AC-026 | State transitions emit events | 0.2, 0.3 |
| 0.6 | Configuration system: per-user model priorities, per-model defaults, per-story overrides | FR-006, FR-010, FR-013, FR-014, FR-020, FR-021, FR-024 | Config loads, overrides work | 0.1 |

### Phase 1: Story Ingestion & Planning (Week 1–2)

| Step | Description | Spec Trace | Verification | Depends On |
|------|-------------|------------|--------------|------------|
| 1.1 | Story ingestion API: accept narrative, duration, aspect ratio, character refs, style refs | FR-001, AC-001, AC-004 | Valid brief → shot plan; empty → rejection | 0.5 |
| 1.2 | Shot decomposition engine: narrative → structured shots (description, duration, camera, characters, objects, audio cues) | FR-002, AC-001 | ≥1 shot from valid narrative; zero shots rejected | 1.1 |
| 1.3 | Shot plan presentation API: return plan for user confirmation | FR-003, AC-001 | Plan returned within 10s (NFR-002) | 1.2 |
| 1.4 | Plan revision API: add/remove/reorder/edit shots before generation | FR-004, AC-003 | Modifications persist without generation start | 1.3 |
| 1.5 | Character reference upload: face detection, Sacred Guard registry check (CON-002 point b) | FR-001, FR-022, EC-003, EC-004 | Face detected → stored; no face / sacred → rejected | 0.2, 0.4 |

### Phase 2: Model Selection & Routing (Week 2)

| Step | Description | Spec Trace | Verification | Depends On |
|------|-------------|------------|--------------|------------|
| 2.1 | Model registry: capabilities (resolution, max duration, aspect ratios, cost, region) | FR-005, FR-007, EC-012 | Registry queries return correct eligibility | 0.6 |
| 2.2 | AUTO Router: per-user priority list, system default, ineligible skip | FR-006, CL-006, AC-014 | Priority respected; 4K req filters non-4K models | 2.1 |
| 2.3 | Manual model override per shot | FR-008 | Override bypasses AUTO for pinned shot | 2.2 |
| 2.4 | Model adapter interface (pluggable) for Veo 3, Runway, etc. | FR-005, FR-017, FR-020 | At least one adapter implements interface | 2.1 |

### Phase 3: Admission Control Pipeline (Week 2–3) — **Critical Path**

| Step | Description | Spec Trace | Verification | Depends On |
|------|-------------|------------|--------------|------------|
| 3.1 | **Gate 1 — Moderation**: policy screening (violence, sexual, hate, PII, CSAM) | FR-010, AC-005 | Violations blocked with categorized reason | 0.5 |
| 3.2 | **Gate 2 — Sacred Guard**: multi-stage denylist (exact, transliterated, fuzzy, visual/semantic) | FR-011, FR-012, CON-001, CON-002, AC-005–AC-009 | All 5 enforcement points checked; order immutable | 0.2, 0.4, 3.1 |
| 3.3 | Sacred Guard denylist management: dual-authorization (two-person) for changes | CL-009, EC-014, AC-010, AC-033 | Single auth rejected; both approvals logged | 3.2 |
| 3.4 | **Gate 3 — Cost Guard**: per-model estimates, budget/project ceiling/committed-spend comparison | FR-013, CL-010, AC-011, EC-009 | Overrun → pause with options; conservative ceiling if unknown | 0.6, 3.2 |
| 3.5 | **Gate 4 — Rate Limit**: per-model, per-user, global with configurable defaults | FR-014, CL-012, AC-012, EC-016 | Exceeded → queued with wait time; per-project override | 0.6, 3.4 |
| 3.6 | Admission audit log: immutable record of every pass/fail/warn with context | FR-015, AC-027 | Every decision audited; tamper-evident | 3.1–3.5 |
| 3.7 | Admission ordering enforcement: Moderation → Sacred → Cost → Rate Limit (CON-001) | CON-001, AC-008, AC-013, EC-018 | Order verified by integration test; Sacred before Cost | 3.1–3.5 |

### Phase 4: Shot Generation, Dispatch & Recovery (Week 3–4)

| Step | Description | Spec Trace | Verification | Depends On |
|------|-------------|------------|--------------|------------|
| 4.1 | Prompt compiler: shot description + style + negative prompts + character identity params (auto-apply named ref from registry) | FR-016, CL-021 | Character name → correct reference image applied | 1.5, 2.3 |
| 4.2 | Shot dispatcher: enqueue to provider via adapter, no duplicate dispatches | FR-017, FR-018, AC-018 | Each shot dispatched exactly once | 3.7, 2.4 |
| 4.3 | Webhook ingestion endpoint: receive completions, correlate to shot | FR-018, AC-017, EC-007, EC-008 | Delayed/lost/duplicate handled correctly | 0.3, 4.2 |
| 4.4 | Webhook Watchdog: 30s polling, 10min max wait after expected completion | FR-019, CL-008, AC-017 | Recovery triggers within bounds; no dup generation | 0.3, 4.3 |
| 4.5 | Timeout & fallback: per-model defaults, user-overridable per story | FR-020, CL-007, AC-015 | Timeout → next eligible model in priority list | 2.2, 4.2 |
| 4.6 | All-models-failed handling: mark shot failed, pause story, notify user | EC-006, AC-016 | User notified with failure details + manual retry | 4.5 |
| 4.7 | Cost tracking: actual vs estimate, drift alerts (single-shot >50%, rolling >20%) | FR-021, CL-011, AC-028 | Alerts emitted with story/shot context | 0.2, 4.2 |

### Phase 5: Face-Lock / Identity Persistence (Week 4) — **Critical Path**

| Step | Description | Spec Trace | Verification | Depends On |
|------|-------------|------------|--------------|------------|
| 5.1 | Character registry: encrypted identity record (biometric, optional voice, metadata) | FR-022, NFR-006, AC-002 | Embeddings encrypted at rest with per-user keys | 0.4, 1.5 |
| 5.2 | Face-Lock conditioning: per-model adapter applies identity for registered characters in shot | FR-023, FR-026, CON-003 | Conditioning applied when character present in shot | 4.1, 2.4 |
| 5.3 | Post-generation verification: similarity threshold (configurable per-model/char) | FR-024, CL-002, AC-019, AC-020 | Same character verified across all shots | 5.2 |
| 5.4 | Auto re-generation on verification failure: configurable retry limit (default 2) | FR-024, CL-003, AC-020 | Max retries then user choice (EC-015) | 5.3 |
| 5.5 | Cross-shot consistency: same registered identity used for all shots | FR-025, CON-003, AC-019 | Character appearance consistent in all shots | 5.3 |
| 5.6 | Multi-character scenes: per-character independent conditioning/verification | FR-026, AC-022 | Each character verified against own reference | 5.2, 5.3 |

### Phase 6: Video Assembly & Delivery (Week 5)

| Step | Description | Spec Trace | Verification | Depends On |
|------|-------------|------------|--------------|------------|
| 6.1 | Shot merger: FFmpeg assembly with smooth transitions in story order | FR-027, AC-023 | All shots merged in order; transitions applied | 4.6, 5.6 |
| 6.2 | Transition system: 0.5s cross-fade default + any FFmpeg filter override | FR-027, CL-014, CL-020 | Default applied; overrides work per shot/global | 6.1 |
| 6.3 | Audio handling: native audio preserved; TTS (ElevenLabs) + music (royalty-free + ElevenLabs) | FR-028, CL-013, CL-022, AC-024 | Voice styles selectable; music library integrated | 6.1 |
| 6.4 | Output formats: MP4 at 720p/1080p/4K (up to model max), subtitle sidecars | FR-029, CL-015, CL-023, AC-025 | Resolutions delivered; SRT/VTT/ASS sidecars | 6.1 |
| 6.5 | Delivery: 7-day TTL download link, cost summary, logs, verification reports | FR-030, CL-019, AC-025 | Notification includes all required artifacts | 6.4 |
| 6.6 | Partial regeneration: re-generate specific shots, re-verify Face-Lock, re-merge | SC-007, FR-016, FR-025 | Only changed shots regenerated; others unchanged | 6.1, 5.6 |

### Phase 7: Observability, Audit & Non-Functional (Week 5–6)

| Step | Description | Spec Trace | Verification | Depends On |
|------|-------------|------------|--------------|------------|
| 7.1 | State change notifications for all lifecycle transitions | FR-031, AC-026 | Every transition emits event | 0.5 |
| 7.2 | Immutable audit logs: Sacred Guard, Cost Guard, Face-Lock, denylist changes | FR-032, AC-027, AC-033 | Audit records tamper-evident; 7-year retention | 3.3, 3.6, 5.3 |
| 7.3 | Cost attribution: story, shot, model, user, timestamp | FR-033, AC-028 | Every cost unit attributed | 4.7 |
| 7.4 | Health endpoint: status + metrics (backlog, latency, errors, drift) | FR-034, NFR-001, AC-029 | Returns healthy + metrics under load | 0.5 |
| 7.5 | Load test: 50 concurrent stories, 200 concurrent shots | NFR-003, AC-030 | P99 < 10s ingestion; no degradation | All prior |
| 7.6 | Failure recovery test: infra failure → in-flight shots resume, RPO=0 | NFR-004, NFR-005, AC-031 | Shots recover; no data loss | All prior |
| 7.7 | Encryption verification: biometric embeddings at rest encrypted | NFR-006, AC-032 | Keys per-user; rotation works | 0.4, 5.1 |
| 7.8 | Dual-authorization enforcement test: single auth rejected | AC-033, CON-008 equivalent | Two approvals required | 3.3 |

---

## 4. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Sacred Guard visual/semantic matching accuracy varies by model | High | High | Configurable thresholds (CL-001); per-model tuning; human appeal path (CL-009) |
| Model provider API changes break adapters | Medium | High | Adapter isolation (EC-017); versioned interfaces; automated contract tests |
| Face-Lock verification fails on certain model/character combos | Medium | High | Configurable threshold/retries (CL-002, CL-003); alternative model fallback (FR-020); user override (EC-015) |
| Webhook reliability varies by provider | Medium | Medium | Watchdog polling (FR-019); idempotent processing (EC-008) |
| Cost estimation drift due to provider pricing changes | Medium | Medium | Conservative ceiling (EC-009); per-story override (CL-010); drift alerts (FR-021) |
| FFmpeg transition compatibility across environments | Low | Medium | Fixed default; user overrides tested in CI; containerized merger |
| PostgreSQL/Redis scaling under load | Low | High | Connection pooling; read replicas; stream partitioning; load test early (NFR-003, NFR-007) |
| Encryption key rotation causes downtime | Low | High | Zero-downtime design (EC-019); background re-encryption; integrity verification |

---

## 5. Definition of Done (Per Step)

- [ ] Unit tests pass (≥80% coverage for new code)
- [ ] Contract tests pass (OpenAPI for APIs)
- [ ] Integration test passes (where applicable)
- [ ] Lint clean
- [ ] Type-check clean
- [ ] Spec traceability: commit message references FR-XXX
- [ ] `progress.md` updated with step completion

---

## 6. Next Steps

1. **Review this plan** — Confirm scope, sequencing, and priorities align with expectations
2. **Create task list** — Decompose into `TaskCreate` entries for tracking
3. **Begin Phase 0** — Foundation & Infrastructure

---

*This plan implements the behavioural specification in `specs/ai-video-fte/spec.md` exactly. No additional behavioural requirements. Architecture and technology choices are implementation details not prescribed by the spec.*