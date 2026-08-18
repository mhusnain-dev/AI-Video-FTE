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
| Functional Requirements | FR-001 through FR-036 |
| Non-Functional Requirements | NFR-001 through NFR-008 |
| Constraints | CON-001 through CON-007 |
| Edge Cases | EC-001 through EC-020 |
| Acceptance Criteria | AC-001 through AC-033 |
| Mandatory Invariants | Sacred Guard Ordering (CON-001), Sacred Guard Coverage (CON-002), Face-Lock Persistence (CON-003), Postgres SoR (CON-004) |

**Out of Scope** (per spec §8): Billing, hosting, creative writing, model training, real-time collab, mobile apps, prompt translation, compliance workflow, custom model deployment, 3D generation, live streaming.

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

## 3. Subagent Delegation Strategy

### 3.1 Analysis

| Factor | Finding |
|--------|---------|
| **File conflict hotspots** | `config.ts` (9 tasks), `tsconfig.json` (5), `promptCompiler.ts` (4), `package.json` (4), `App.tsx` (4) |
| **Truly independent tasks** | 20 of 62 (zero file overlap) |
| **Critical path depth** | 5-6 sequential batch waves minimum |
| **Potential speedup** | ~32h wall-clock vs 144h serial (4.5x) |

**Why 62 individual agents fails:** The codebase has too many hub nodes (`config.ts`, `types.ts`, `App.tsx`, `client.ts`) for fine-grained delegation. Parallel writes to these files cause silent merge conflicts and type drift. The backend pipeline is strictly linear (`ingestion → router → admission → generation → dispatch → verification → merger`) — each stage depends on the previous.

### 3.2 Delegation Model — 5 Agents

| Agent | Scope | Files Touched | Why This Split |
|-------|-------|---------------|----------------|
| **Agent 1: Config & Infra** | All `config.ts` changes, `setup-secrets.sh`, `docker-compose.prod.yaml`, K8s manifests, `.eslintrc`, `tsconfig.json`, CI pipeline | `src/shared/config.ts`, `scripts/setup-secrets.sh`, `docker-compose.prod.yaml`, `k8s/base/01-config.yaml`, `.eslintrc`, `frontend/tsconfig.json`, `.github/workflows/` | Serializes the 9-task `config.ts` conflict zone. All infrastructure changes go through one agent. |
| **Agent 2: Backend Pipeline** | `promptCompiler.ts` LLM integration, `faceLockVerification.ts` real impl, prompt sanitizer, auth backend, settings API, rating/flagging API, preferences API, quality presets | `src/generation/promptCompiler.ts`, `src/verification/faceLockVerification.ts`, `src/shared/types.ts`, `src/server.ts`, `src/ingestion/routes.ts`, `package.json` | Linear pipeline needs unified context. One agent avoids type drift across `types.ts`. |
| **Agent 3: Frontend** | All React components, hooks, pages, `App.tsx`, `client.ts`, login page, Error Boundary, ChunkPlayer, prompt review UI, rating UI, settings wiring, preferences dashboard | `frontend/src/**` (all 28 files) | Single agent avoids frontend type drift. All UI changes are coherent. |
| **Agent 4: Docs & Tests** | CHANGELOG, runbooks, README, workflow guide, Vitest setup, Playwright setup, OpenAPI 3.1 spec, contract tests, unit tests, E2E tests | `CHANGELOG.md`, `README.md`, `docs/`, `tests/`, `frontend/src/**/*.test.*`, `openapi.yaml` | Truly independent — zero overlap with implementation agents. |
| **Agent 5: Chaos & Validation** | Load test scripts, chaos drill scripts + execution, npm audit, encryption verification, full test suite execution | `tests/load/`, `tests/chaos/`, `scripts/chaos-*` | Independent validation layer — runs after all other agents complete. |

### 3.3 Execution Order

```
Wave 1 (parallel):  Agent 1 (Config & Infra) + Agent 4 (Docs & Tests)
                    ↓
Wave 2 (parallel):  Agent 2 (Backend) + Agent 3 (Frontend)
                    ↓
Wave 3 (serial):    Agent 5 (Chaos & Validation) — runs after all code is written
```

### 3.4 Conflict Resolution Rules

1. **`config.ts`** — Only Agent 1 may modify. Other agents read-only.
2. **`types.ts`** — Only Agent 2 may modify. Agent 3 reads from `frontend/src/types/api.ts` (separate file).
3. **`package.json`** — Only Agent 2 may add npm dependencies. Agent 1 reads only.
4. **`App.tsx`** — Only Agent 3 may modify. Agent 1 reads only.
5. **`client.ts`** — Only Agent 3 may modify. Agent 2 reads only.
6. **Merge conflicts** — If any agent encounters a merge conflict, stop and escalate to the main agent for resolution.

### 3.5 Verification Per Agent

| Agent | Verification Gate |
|-------|-------------------|
| Agent 1 | `npm run typecheck` passes, `docker-compose config` validates, K8s `kubectl apply --dry-run=client` passes |
| Agent 2 | `npm test` passes (248+ tests), no `any` types added, new files have imports verified |
| Agent 3 | `npm run build` passes in `frontend/`, no console errors, all routes render |
| Agent 4 | All docs exist and are non-empty, tests run and pass, OpenAPI spec validates |
| Agent 5 | Load tests run, chaos drills execute, npm audit clean, encryption verified |

---

## 4. Implementation Steps

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

## 5. Risks & Mitigations

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

## 6. Definition of Done (Per Step)

- [ ] Unit tests pass (≥80% coverage for new code)
- [ ] Contract tests pass (OpenAPI for APIs)
- [ ] Integration test passes (where applicable)
- [ ] Lint clean
- [ ] Type-check clean
- [ ] Spec traceability: commit message references FR-XXX
- [ ] `progress.md` updated with step completion

---

## 7. Next Steps

1. **Phase J: Cleanup** — 3 remaining tasks (~1h): consolidate empty dirs, add dist/ to .gitignore, add lazy loading
2. **Final verification** — Run full test suite, lint, typecheck
3. **Principal final review** — Review all artifacts and approve
4. **Production deployment** — After real API keys provided

---

## 8. Phase 9: DoD Gap Resolution + Feature Completion (62 tasks)

**Created**: 2026-08-17  
**Status**: ✅ COMPLETE — All 62/62 tasks done. All 12 phases done. 390 tests (389 pass).  
**Spec additions**: CL-026 (Luma removed), CL-027 (Hybrid TTS → ElevenLabs only), CL-028 (Auth), CL-029 (Face-Lock real impl), CL-030 (Sanitizer), CL-031 (LLM enhancement), CL-032 (Luma cleanup), CL-033 (Strong secrets), CL-034 (Vitest+Playwright), CL-035 (Fix MEDIUM), CL-036 (Gemini 3.5 Flash), CL-037 (Face-Lock fail), CL-038 (No JWT refresh), CL-039 (Piper deferred), CL-040 (Prompt review page), FR-016 (LLM prompt generation), FR-027 (per-chunk playback + transitions), FR-028 (hybrid TTS + audio-video sync), FR-035 (Auth), FR-036 (Sanitizer)

### Phase A: Frontend Critical Fixes (4 tasks, ~6h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| A1 | Delete dead code: `type-test2.tsx`, remove `@shared` alias from tsconfig.json + vite.config.ts | HIGH | ~15min | No dead files; no broken imports | — |
| A2 | Enable `noImplicitAny: true` + fix all 49 `any` types across codebase | CRITICAL | ~4h | `npx tsc --noEmit` passes with noImplicitAny | — |
| A3 | Create `.eslintrc` config with React + TypeScript rules | HIGH | ~30min | ESLint runs without config errors | — |
| A4 | Fix all lint errors across frontend codebase | HIGH | ~1h | `npm run lint` passes clean | A3 |

### Phase B: LLM Prompt Engine (4 tasks, ~17h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| B1 | Integrate Gemini 3.5 Flash via `@google/generative-ai` SDK for prompt enhancement from shot descriptions (CL-036) | CRITICAL | ~8h | LLM generates optimized prompts; quality measurably better than template | — |
| B2 | Implement script chunking with 5000 char limit per chunk | CRITICAL | ~4h | Large scripts split into ≤5000 char chunks; each gets own LLM prompt | B1 |
| B3 | Add LLM API key configuration to Settings UI + backend config (encrypted storage) | CRITICAL | ~2h | User provides key; stored encrypted; used for prompt generation | B1 |
| B4 | Add "Ultra Realistic" quality preset toggle (selects highest-quality model + 4K + best prompts) | HIGH | ~3h | Toggle activates premium pipeline; video quality improves | B1, B3 |

### Phase C: Audio-Video Sync (3 tasks, ~10h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| C1 | ElevenLabs-only TTS integration (Piper deferred per CL-039). User selects voice/style at story creation | CRITICAL | ~4h | ElevenLabs produces audio; voice selection works | — |
| C2 | Enforce audio-video duration sync per chunk: TTS audio trimmed/generated to exact video duration; music trimmed to match | CRITICAL | ~4h | If video=8s, TTS audio=8s exactly; music trimmed to match | C1 |
| C3 | Wire 7 remaining Settings tabs (Cost, Rate Limits, Face-Lock, Transitions, Audio, Video) to single JSONB `/api/settings` endpoint (CL-015) | HIGH | ~2h | All 9 tabs persist to backend database | — |

### Phase D: Chunk Playback + Transitions (3 tasks, ~9h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| D1 | Create `ChunkPlayer` component: per-shot video with play/pause + volume + progress bar + download | CRITICAL | ~4h | Each shot plays independently with full controls | — |
| D2 | Build chunk grid/list view on story progress page showing all shots as playable cards with status | CRITICAL | ~3h | All shots displayed; each playable; status visible | D1 |
| D3 | Add transition selection UI between chunks: dropdown with presets + "Apply to All" button + custom per-pair | CRITICAL | ~2h | User selects transitions; apply-to-all works; per-pair overrides work | D2 |

### Phase E: Infrastructure & Security Fixes (7 tasks, ~5h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| E1 | Add `KIE_API_KEY_FILE` and `LLM_API_KEY_FILE` env vars to api service in `docker-compose.prod.yaml` (C1) | CRITICAL | ~10min | Secrets reachable by app at `/run/secrets/kie_key` and `/run/secrets/llm_api_key` | — |
| E2 | Auto-generate strong secrets in `setup-secrets.sh` for postgres, redis, vault_token with `--force` overwrite (C4, C5, C6) | CRITICAL | ~1h | `setup-secrets.sh --force` produces 32-char random passwords; redis_password.txt non-empty | — |
| E3 | Remove `luma-ray2` from config.ts defaults (lines 119,129,144,157). Delete `secrets/luma_key.txt` (C7, CL-026) | HIGH | ~30min | No luma references in config; `luma_key.txt` absent | — |
| E4 | Add healthcheck to api service in `docker-compose.prod.yaml` | HIGH | ~20min | `condition: service_healthy` on nginx→api dependency | — |
| E5 | Add Docker build/push stage to `.github/workflows/ci.yml` | MEDIUM | ~1h | CI builds and pushes container image to GHCR | — |
| E6 | Fix Alertmanager SMTP placeholder (`smtp.example.com`) — add comment noting operator must configure | MEDIUM | ~15min | Comment documents placeholder; no runtime breakage | — |
| E7 | Delete `secrets/luma_key.txt` and remove Luma references from `scripts/setup-secrets.sh` | MEDIUM | ~15min | No Luma in setup script; secret file absent | — |

### Phase F: Backend Feature Gaps (10 tasks, ~28h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| F1 | Implement prompt sanitizer — PII strip (emails, phones, addresses) + per-model char limits + injection patterns (FR-036, CL-030) | CRITICAL | ~4h | `sanitizer.test.ts` passes; PII redacted from prompts | — |
| F2 | Wire sanitizer into pipeline between prompt compiler and moderation gate | CRITICAL | ~1h | Pipeline order: compile → sanitize → moderate → sacred → cost → rate limit | F1 |
| F3 | Replace mock Face-Lock verification with real FFmpeg frame extraction + ArcFace ResNet100 INT8 ONNX embedding (CL-029, CL-041) | CRITICAL | ~8h | `faceLockVerification.test.ts` passes with real frame data; no mock returns | — |
| F4 | Add "Ultra Realistic" quality preset — highest-quality model selection + 4K resolution + LLM-optimized prompts (FR-006) | HIGH | ~2h | Quality preset toggle in story creation; model selection reflects preset | B1 |
| F5 | Add prompt review step between plan approval and dispatch — dedicated review page API (FR-016, CL-031, CL-040) | CRITICAL | ~4h | API serves compiled prompts for review; user can approve/edit/dispatch | B1 |
| F6 | Implement LLM preference injection — FTE uses learned preferences to improve future prompts (FR-016) | HIGH | ~2h | LLM receives preference context in prompt enhancement call | J2 |
| F7 | Add per-shot rating + flagging API endpoint + `user_feedback` DB table | HIGH | ~1h | Feedback persisted; queryable per story/shot | — |
| F8 | Add `user_preferences` table + preference extraction from past ratings/flags | HIGH | ~3h | Preferences saved; system infers style/camera/pacing preferences | F7 |
| F9 | Build full auth backend: `bcrypt` + `jsonwebtoken` + `/auth/login`, `/auth/register`, `/auth/me` routes + `users` table migration (CL-028) | CRITICAL | ~6h | Login/register work; JWT issued; protected routes reject unauthenticated | — |
| F10 | Create `user_settings` table (JSONB) + `/api/settings` GET/PUT endpoints (CL-015) | CRITICAL | ~1h | Settings persisted per user; read/write works | — |

### Phase G: Frontend Feature Gaps (8 tasks, ~26h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| G1 | Create `/login` page + AuthContext + ProtectedRoute guard on all routes (FR-035, CL-028) | CRITICAL | ~3h | Unauthenticated users redirected to `/login`; JWT issued on login | F9 |
| G2 | Add React Error Boundary at app root | CRITICAL | ~1h | Render errors show recovery UI instead of white screen | — |
| G3 | Create ChunkPlayer component — per-shot play/pause/volume (FR-027) | CRITICAL | ~3h | Each shot chunk independently playable | D2 |
| G4 | Build chunk grid/list view on story progress page | CRITICAL | ~2h | All shot chunks displayed with status and playback controls | G3 |
| G5 | Add prompt review/edit UI — dedicated page per CL-040; user modifies LLM output before dispatch | CRITICAL | ~3h | User edits prompt; changes reflected in dispatch payload | F5 |
| G6 | Add per-shot rating UI (1-5 stars + comment) + flagging UI with reason categories on delivery page | HIGH | ~3h | User rates and flags shots; data saved via API | G4, F7 |
| G7 | Wire 7 Settings tabs to `/api/settings` endpoint — Cost, Rate Limits, Face-Lock, Transitions, Audio, Video | HIGH | ~4h | All Settings tabs persist to API; reload shows saved values | F10, G1 |
| G8 | Add preference dashboard — show learned preferences; allow override/reset | MEDIUM | ~2h | User sees what FTE learned; can modify | F8 |

### Phase H: Frontend Quality (6 tasks, ~16h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| H1 | Enable `noImplicitAny: true` + fix all 49 `any` types across codebase (C3) | CRITICAL | ~4h | `npx tsc --noEmit` passes with noImplicitAny | — |
| H2 | Create `.eslintrc` config + fix all lint errors (C5) | HIGH | ~2h | `npm run lint` passes clean | — |
| H3 | Delete dead code: `type-test2.tsx`, `@shared` alias removal from tsconfig+vite config (C2, M1) | HIGH | ~30min | No dead files; no broken imports | — |
| H4 | Setup Vitest config + write unit tests for hooks, API client, utils | HIGH | ~4h | ≥80% coverage on data layer | H1 |
| H5 | Setup Playwright + write E2E tests for critical flows (login → story → generate → deliver) | HIGH | ~4h | Critical user flows pass end-to-end | G1, H4 |
| H6 | Enable `noUnusedLocals: true` + `noUnusedParameters: true` in tsconfig | LOW | ~10min | Dead code caught at compile time | H1 |

### Phase I: Documentation (4 tasks, ~4h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| I1 | Create `CHANGELOG.md` | HIGH | ~30min | All releases documented | — |
| I2 | Write runbooks for all 16 Prometheus alerts | HIGH | ~3h | Each alert has step-by-step response procedure | — |
| I3 | Update `README.md` with current project state | MEDIUM | ~30min | README reflects actual status | — |
| I4 | Update `docs/workflow-guide.md` with CL-026/CL-027/CL-028–CL-035 | MEDIUM | ~20min | Docs match current spec | — |

### Phase J: Cleanup & Lazy Loading (3 tasks, ~1h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| J1 | Rename/consolidate empty `faceLock/` and `observability/` directories | LOW | ~15min | No empty dirs in `src/` | — |
| J2 | Add `dist/` to `.gitignore`, remove from repo | LOW | ~5min | Build artifacts not tracked | — |
| J3 | Add lazy loading (React.lazy) for page components | LOW | ~30min | Bundle split; faster initial load | G1 |

### Phase K: Validation & Testing (6 tasks, ~13h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| K1 | Create OpenAPI 3.1 spec (`/docs/openapi.yaml`) for all ~15 API endpoints | CRITICAL | ~2h | Valid OpenAPI 3.1; all endpoints documented | — |
| K2 | Write contract tests against OpenAPI spec | CRITICAL | ~2h | All contract tests pass; API matches spec | K1 |
| K3 | Write load test scripts (Artillery/k6) — 50 concurrent stories, 200 shots | HIGH | ~3h | Scripts run without error | — |
| K4 | Run load test + record results in `research/load-test-results.md` | HIGH | ~1h | P99 ingestion < 10s under target load | K3 |
| K5 | Run `npm audit` + dependency scan, fix all critical/high vulnerabilities | HIGH | ~1h | Zero critical/high vulnerabilities | — |
| K6 | Verify encryption at-rest (biometric embeddings with per-user DEK) | HIGH | ~1h | Encrypted data verified; rotation works | — |

### Phase L: Chaos Testing (4 tasks, ~9h)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| L1 | Write chaos drill scripts (kill Postgres, network partition, provider timeout) | HIGH | ~3h | Scripts simulate failures correctly | — |
| L2 | Run chaos drill + record results in `research/chaos-drill-results.md` | HIGH | ~1h | In-flight shots recover; RPO=0 verified | L1 |
| L3 | Run full backend test suite (248 tests) + verify 80% coverage | HIGH | ~1h | All tests pass; coverage ≥80% | — |
| L4 | Run frontend test suite + verify coverage | HIGH | ~1h | All tests pass; coverage ≥80% | H4, H5 |

### Phase 9 Summary

| Phase | Tasks | Effort | Description |
|-------|-------|--------|-------------|
| A: Frontend Critical Fixes | 4 | ~6h | Dead code, @shared alias, noImplicitAny, ESLint config |
| B: LLM Prompt Engine | 4 | ~17h | Gemini 3.5 Flash integration, chunking, quality presets, user review |
| C: Audio-Video Sync | 3 | ~10h | ElevenLabs TTS, duration sync, Settings wiring |
| D: Chunk Playback + Transitions | 3 | ~9h | ChunkPlayer, transition UI, apply-to-all |
| E: Infrastructure & Security | 7 | ~5h | docker-compose fixes, secrets hardening, Luma cleanup, CI |
| F: Backend Feature Gaps | 10 | ~28h | Sanitizer, face-lock real impl, auth backend, settings API, rating/flagging, preferences |
| G: Frontend Feature Gaps | 8 | ~26h | Login page, Error Boundary, ChunkPlayer, prompt review, rating, settings, preferences |
| H: Frontend Quality | 6 | ~16h | Fix 49 any types, ESLint, Vitest, Playwright |
| I: Documentation | 4 | ~4h | CHANGELOG, runbooks, README, workflow guide |
| J: Cleanup | 3 | ~1h | Empty dirs, .gitignore, lazy loading |
| K: Validation & Testing | 6 | ~13h | OpenAPI, contract tests, load tests, security, encryption |
| L: Chaos Testing | 4 | ~9h | Chaos drill scripts + execution, test suite verification |
| **TOTAL** | **62** | **~144h** | |

### External Dependencies (require Principal action)
- Real API keys: Veo3, Runway, ElevenLabs (KIE ready in `secrets/kie_key.txt`)
- **LLM API key**: Paste your Gemini API key into `secrets/llm_api_key.txt`
- End-to-end smoke test with real model providers

---

*This plan implements the behavioural specification in `specs/ai-video-fte/spec.md` exactly. No additional behavioural requirements. Architecture and technology choices are implementation details not prescribed by the spec.*

---

## 9. Phase M: Admin Account Management (20 tasks, ~40h)

**Created**: 2026-08-18  
**Status**: IN PROGRESS  
**Principal Decisions**: Env var ADMIN_EMAIL for admin bootstrap, SMTP email via nodemailer, 5-line secrets/smtp.txt, separate /admin route, fixed duration approval (24h/7d/30d), web-based password reset, all admin capabilities (view/approve/modify/delete/audit)

### Phase M1: Backend — Auth & Admin (10 tasks)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| M1.1 | Create migration `016_admin_system.sql`: add `role`, `status`, `access_expires_at`, `approved_by`, `approved_at` to `users`; create `password_resets` table; create `admin_audit_log` table | CRITICAL | ~1h | Migration applies cleanly; tables created | — |
| M1.2 | Create `secrets/smtp.txt` placeholder (5 lines: host, port, user, pass, fromEmail) | HIGH | ~5min | File exists with placeholder values | — |
| M1.3 | Create `src/email/emailService.ts` — nodemailer SMTP transport, `sendPasswordResetEmail()`, `sendApprovalEmail()`, `sendAccessExpiredEmail()` | CRITICAL | ~3h | Emails send via SMTP; templates render | M1.2 |
| M1.4 | Update `shared/config.ts` — add `adminEmail` from `ADMIN_EMAIL` env var, `smtpConfig` loader from `secrets/smtp.txt`, `frontendUrl` for reset links | CRITICAL | ~1h | Config loads; admin email accessible | — |
| M1.5 | Update `src/auth/authService.ts` — registration sets `status=pending` (unless email matches ADMIN_EMAIL → `status=approved, role=admin`); login checks `status` + `access_expires_at`; add `requestPasswordReset()`, `resetPassword()`, `approveUser()`, `revokeAccess()`, `extendAccess()` | CRITICAL | ~8h | Register → pending; admin register → approved; login rejects expired access | M1.1, M1.4 |
| M1.6 | Update `src/auth/authMiddleware.ts` — add `adminMiddleware` (checks `role=admin`), add `accessMiddleware` (checks `status=approved` + `access_expires_at > NOW()`) | CRITICAL | ~2h | Admin routes reject non-admins; expired users rejected | M1.5 |
| M1.7 | Update `src/auth/authRoutes.ts` — add `POST /auth/forgot-password` (generates token, sends email), `POST /auth/reset-password` (validates token, updates password) | CRITICAL | ~2h | Forgot password sends email; reset works with valid token | M1.3, M1.5 |
| M1.8 | Create `src/admin/adminService.ts` — `listUsers()`, `approveUser()`, `rejectUser()`, `revokeAccess()`, `extendAccess()`, `deleteUser()`, `getAuditLog()` | CRITICAL | ~4h | All CRUD operations work; audit log records actions | M1.5 |
| M1.9 | Create `src/admin/adminRoutes.ts` — `GET /admin/users`, `POST /admin/approve/:id`, `POST /admin/reject/:id`, `POST /admin/revoke/:id`, `POST /admin/extend/:id`, `DELETE /admin/users/:id`, `GET /admin/audit` | CRITICAL | ~3h | All endpoints respond correctly; admin-only access enforced | M1.6, M1.8 |
| M1.10 | Update `src/server.ts` — mount admin routes with `adminMiddleware`; update auth routes for new endpoints | CRITICAL | ~1h | All routes accessible; auth middleware active | M1.7, M1.9 |

### Phase M2: Frontend — Admin & Auth UI (7 tasks)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| M2.1 | Update `frontend/src/contexts/AuthContext.tsx` — add `role`, `status`, `accessExpiresAt` to user state; add `isAdmin` helper | CRITICAL | ~1h | Auth state includes role/status | M1.5 |
| M2.2 | Create `frontend/src/pages/PendingApproval.tsx` — "Waiting for admin approval" screen with logout button | CRITICAL | ~1h | Pending users see this page; can logout | M2.1 |
| M2.3 | Create `frontend/src/pages/ForgotPassword.tsx` — email input form, submit sends reset request | CRITICAL | ~1h | Form submits; success/error feedback | M1.7 |
| M2.4 | Create `frontend/src/pages/ResetPassword.tsx` — reads `?token=` from URL, new password + confirm input, submits reset | CRITICAL | ~1h | Token validated; password updated; redirect to login | M1.7 |
| M2.5 | Create `frontend/src/pages/AdminDashboard.tsx` — user table with status badges, approve button + duration picker (24h/7d/30d), reject, revoke, extend, delete, audit log tab | CRITICAL | ~6h | All admin operations work from UI; audit log visible | M1.9 |
| M2.6 | Update `frontend/src/components/ProtectedRoute.tsx` — role-based routing: admin → `/admin`, pending → `/pending`, approved → normal routes; expired access → login | CRITICAL | ~2h | Route guard redirects correctly based on role/status | M2.1, M2.2 |
| M2.7 | Update `frontend/src/App.tsx` — add `/admin`, `/pending`, `/reset-password`, `/forgot-password` routes; lazy-load AdminDashboard | CRITICAL | ~1h | All new routes render; lazy loading works | M2.2–M2.6 |

### Phase M3: Tests & Documentation (3 tasks)

| Step | Description | Priority | Effort | Verification | Depends On |
|------|-------------|----------|--------|--------------|------------|
| M3.1 | Write backend tests for admin system — auth status checks, access expiry, admin CRUD, password reset flow, audit log | CRITICAL | ~4h | All tests pass | M1.10 |
| M3.2 | Write frontend tests — AdminDashboard, PendingApproval, ProtectedRoute role routing | HIGH | ~2h | All tests pass | M2.7 |
| M3.3 | Update documentation — README.md admin section, CHANGELOG.md, workflow-guide.md | MEDIUM | ~1h | Docs reflect admin system | M2.7 |

### Phase M Summary

| Phase | Tasks | Effort | Description |
|-------|-------|--------|-------------|
| M1: Backend Auth & Admin | 10 | ~25h | Migration, email service, admin service/routes, auth updates |
| M2: Frontend Admin & Auth UI | 7 | ~13h | Admin dashboard, pending page, password reset, role routing |
| M3: Tests & Documentation | 3 | ~7h | Backend tests, frontend tests, docs |
| **TOTAL** | **20** | **~45h** | Admin account management system |

### New Dependencies
- `nodemailer` — SMTP email sending
- `@types/nodemailer` — TypeScript types

### New Files
| File | Purpose |
|------|---------|
| `secrets/smtp.txt` | SMTP config (5 lines: host, port, user, pass, fromEmail) |
| `migrations/016_admin_system.sql` | DB migration (role, status, access_expires_at, password_resets, audit_log) |
| `src/email/emailService.ts` | Nodemailer SMTP email sender |
| `src/admin/adminService.ts` | Admin business logic |
| `src/admin/adminRoutes.ts` | Admin API endpoints |
| `frontend/src/pages/AdminDashboard.tsx` | Admin panel UI |
| `frontend/src/pages/PendingApproval.tsx` | Pending approval screen |
| `frontend/src/pages/ForgotPassword.tsx` | Forgot password form |
| `frontend/src/pages/ResetPassword.tsx` | Reset password form |

### External Dependencies
- SMTP credentials in `secrets/smtp.txt` (Gmail app password or any SMTP provider)
- `ADMIN_EMAIL` env var set to admin account email