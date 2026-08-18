# Behavioural Specification: AI Video Production Specialist Digital FTE

**Project**: AI Video Production Specialist Digital FTE  
**Phase**: 3 — Specification  
**Date**: 2026-08-05  
**Status**: Draft — Awaiting Principal Approval  

---

## 1. Goal

Provide a Digital Full-Time Equivalent (FTE) that autonomously produces complete, publish-ready videos from high-level story descriptions. The FTE accepts a narrative concept, decomposes it into shots, generates each shot using the most suitable generative video model, ensures visual and identity consistency across all shots, enforces mandatory safety and cost controls, and delivers a merged final video — all without requiring the user to manage models, prompts, or infrastructure.

---

## 2. Digital FTE Role

**Title**: AI Video Production Specialist  

**Core Responsibility**: End-to-end video production from story concept to final merged video.

**Autonomy Level**: 
- Accepts a story brief (text, optional reference assets)
- Independently plans shots, selects models, generates, verifies, and merges
- Escalates only on policy violations (Sacred Guard), budget overruns, or unrecoverable technical failures
- Reports progress, costs, and outcomes

**Non-Goals**:
- Does not replace creative direction — user provides the story
- Does not host or stream videos — delivers downloadable assets
- Does not manage user accounts or billing — integrates with existing identity/cost systems

---

## 3. User Scenarios

| ID | Scenario | Trigger | Expected Outcome |
|----|----------|---------|------------------|
| **SC-001** | **Happy Path — Standard Story** | User submits a story brief with 5–10 shots, optional character photos | All shots generated, Face-Lock verified, Sacred Guard passed, cost within estimate, final video merged and delivered |
| **SC-002** | **Character Consistency** | User provides reference photos for 1–3 characters | Same person appears visually consistent across every shot they appear in |
| **SC-003** | **Sacred Guard Rejection** | Story brief or generated content references a protected sacred personality | Request blocked at admission; no generation occurs; user receives clear rejection reason |
| **SC-004** | **Cost Guard Pause** | Estimated cost exceeds user's remaining budget or project ceiling | Generation pauses before dispatch; user notified with cost breakdown and options (reduce scope, increase budget, cancel) |
| **SC-005** | **Model Failure Fallback** | Primary model for a shot fails or times out | Automatic fallback to alternative model; shot completes without user intervention |
| **SC-006** | **Long-Running Story** | Story with 20+ shots submitted | Shots generated concurrently; progress reported; final merge completes; total time communicated upfront |
| **SC-007** | **Partial Regeneration** | User requests re-generation of 2 specific shots in a completed story | Only those shots regenerated; Face-Lock re-verified; merged video updated; other shots unchanged |
| **SC-008** | **Async Recovery** | Model provider notification delayed or lost | Automatic recovery recovers job; no duplicate generation or charge |

---

## 4. Functional Requirements

### 4.1 Story Ingestion & Planning

| ID | Requirement |
|----|-------------|
| **FR-001** | **Story Acceptance** — The FTE accepts a story brief containing: narrative text, target duration range, aspect ratio (16:9 default, 9:16, 1:1, 4:5 supported), optional character reference images, optional style references, optional negative prompts. |
| **FR-002** | **Shot Decomposition** — The FTE automatically decomposes the narrative into a sequence of shots, each with: visual description, duration, camera motion, character presence list, key objects/actions, optional audio cues. |
| **FR-003** | **Shot Plan Presentation** — Before generation begins, the FTE presents the shot plan to the user for confirmation or adjustment. |
| **FR-004** | **Plan Revision** — The user may request modifications to the shot plan (add, remove, reorder, edit shots) before authorizing generation. |

### 4.2 Model Selection & Routing

| ID | Requirement |
|----|-------------|
| **FR-005** | **Multi-Model Support** — The FTE supports generation via multiple generative video model providers, including cloud-hosted and local models. |
| **FR-006** | **Automatic Model Selection** — For each shot, the FTE automatically selects the most suitable model based on the user's configured model priority list. When no user preference is configured, a system default priority applies (e.g., Veo 3 low quality first when available at zero cost). Models ineligible for a shot (resolution, duration, capability, region) are skipped in priority order. An "Ultra Realistic" quality preset is available that selects highest-quality models (e.g., veo3-high, kie-veo3-quality) with 4K resolution and LLM-optimized prompts. |
| **FR-007** | **Eligibility Filtering** — Models ineligible for a shot (e.g., cannot meet resolution requirement, lacks required capability, regional restriction) are excluded from selection. |
| **FR-008** | **Manual Override** — The user may pin a specific model for any shot, bypassing automatic selection. |

### 4.3 Admission Control (Mandatory Ordering)

| ID | Requirement |
|----|-------------|
| **FR-009** | **Admission Pipeline** — Every shot request passes through a fixed-order admission pipeline before dispatch: **1. Moderation → 2. Sacred Guard → 3. Cost Guard → 4. Rate Limit**. |
| **FR-010** | **Moderation Gate** — Content is screened for policy violations (violence, sexual content, hate, PII, CSAM). Violations block the shot with a categorized rejection reason. |
| **FR-011** | **Sacred Guard** — Every prompt, reference image, and generated frame is checked against a multi-stage denylist of protected sacred personalities using exact, transliterated, fuzzy, and visual/semantic matching. Visual/semantic similarity threshold is configurable per model provider (default range: 0.75–0.80 cosine similarity). Any match blocks the shot. |
| **FR-012** | **Sacred Guard Enforcement Points** — Sacred Guard checks occur at: (a) Story creation (prompt + references), (b) Character registry upload, (c) Pre-moderation admission, (d) Pre-dispatch to model, (e) Post-generation visual audit. |
| **FR-013** | **Cost Guard** — Before dispatch, estimated shot cost (using per-model defaults: e.g., Veo 3 low quality $0, Veo 3 high $X, Runway $Y; user-overridable per story) is compared against: user's remaining budget, project ceiling, committed-spend limit. Overrun triggers pause with options (reduce scope, increase budget, cancel). |
| **FR-014** | **Rate Limit Gate** — Per-model, per-user, and global rate limits are enforced with configurable defaults (e.g., Veo 3: 10/min, Runway: 5/min, per-user: 20/min, global: 100/min). User/admin may override per project. Exceeding limits holds the shot with estimated wait time. |
| **FR-015** | **Admission Audit** — Every admission decision (pass/fail/warn) is recorded immutably with timestamp, gate, rule triggered, and context. |

### 4.4 Shot Generation

| ID | Requirement |
|----|-------------|
| **FR-016** | **Prompt Compilation** — For each shot, the FTE first generates a template-based prompt from shot visual description, camera motion, duration, characters, and objects. When an LLM API key is configured, the FTE enhances the template prompt using the LLM to add cinematic detail, style coherence, and optimized negative prompts. When no LLM key is available, the template prompt is used as-is. Scripts exceeding 5000 characters are chunked into ≤5000 character segments, each receiving its own enhanced prompt. The compiled prompt is presented to the user for review and optional editing before dispatch. For each registered character present in the shot, the FTE automatically applies that character's named reference image from the registry. |
| **FR-017** | **Shot Dispatch** — Shots are dispatched to model providers with no duplicate dispatches. |
| **FR-018** | **Completion Notice** — The FTE receives completion notices from model providers and correlates each to the originating shot. |
| **FR-019** | **Automatic Recovery** — If a completion notice is delayed or lost, the FTE automatically recovers by polling the provider every 30 seconds for up to 10 minutes after expected completion. No duplicate generation or charge occurs. |
| **FR-020** | **Timeout & Fallback** — Shot generation has a per-model timeout default (e.g., Veo 3: 120s, Runway: 180s). User may override per story. On timeout, automatic fallback to next eligible model in user's priority list occurs. |
| **FR-021** | **Cost Tracking** — Actual cost per shot is recorded upon completion and compared to estimate. Cost drift alerts when single-shot cost exceeds estimate by configurable threshold (default >50%) or rolling average exceeds configurable threshold (default >20%). User may override thresholds per story. |

### 4.5 Face-Lock / Identity Persistence

| ID | Requirement |
|----|-------------|
| **FR-022** | **Character Registry** — Users may upload reference images for characters. Each registered character receives an encrypted identity record (biometric identity data, optional voice data, metadata). |
| **FR-023** | **Face-Lock Conditioning** — For every shot containing a registered character, the FTE applies identity conditioning appropriate to the selected model's capabilities. |
| **FR-024** | **Post-Generation Verification** — Every generated frame containing a registered character is verified against the registered identity using a configurable per-model/character similarity threshold (default per-model range). Verification failure triggers automatic re-generation with a configurable per-model/character retry limit (default: 2). |
| **FR-025** | **Cross-Shot Consistency** — The same character must maintain visual identity across all shots in a story. Verification uses the same registered identity for all shots. |
| **FR-026** | **Multi-Character Scenes** — Shots with multiple registered characters apply conditioning/verification per character independently. |

### 4.6 Video Assembly & Delivery

| ID | Requirement |
|----|-------------|
| **FR-027** | **Shot Merging** — Completed shots are assembled in story order with a default 0.5s cross-fade transition between shots. User may override with any FFmpeg transition filter (e.g., fade, slide, zoom, wipe) and duration per shot or globally. All individual shot chunks are accessible on the frontend with play/pause/volume controls. Transition selection UI allows choosing transitions between any shot pairs, with an "Apply to All" button and custom per-pair transitions. |
| **FR-028** | **Audio Handling** — If models generate native audio, it is preserved. If not, the FTE generates TTS voiceover via ElevenLabs API (premium quality). Local free-tier TTS (Piper/Coqui) is deferred to a future phase (CL-039). Voices and styles are selectable (e.g., "shivank", "deep breath", "suspense"). Background music from integrated royalty-free library + ElevenLabs music library. Audio duration for each chunk is enforced to match the corresponding video duration exactly. User may override with own audio assets. |
| **FR-029** | **Final Output Formats** — Delivers video in standard formats (MP4) at user-specified resolution: 720p, 1080p (default), or 4K, up to model maximum. Optional subtitle sidecars in SRT (default), VTT, or ASS format, plus metadata sidecars included. |
| **FR-030** | **Delivery Notification** — User receives completion notification with: download link (7-day TTL), cost summary, generation logs, verification reports. |

### 4.7 Observability & Audit

| ID | Requirement |
|----|-------------|
| **FR-031** | **State Change Notification** — Every state change notifies of the transition for every major step in the story lifecycle (creation, planning, admission, dispatch, completion, failure, merge, delivery). |
| **FR-032** | **Immutable Audit Log** — Critical operations (Sacred Guard decisions, Cost Guard pauses, Face-Lock verifications, denylist modifications) are recorded in an immutable audit log. |
| **FR-033** | **Cost Attribution** — Every cost unit is attributed to: story, shot, model, user, timestamp. |
| **FR-034** | **Operational Health** — The FTE exposes health status and operational metrics for monitoring (processing backlog, latency, error rates, cost drift). |

### 4.8 Authentication & Security

| ID | Requirement |
|----|-------------|
| **FR-035** | **User Authentication** — The FTE provides JWT-based authentication with local password storage (bcrypt hashing). A login page accepts credentials and issues a short-lived JWT. All frontend routes are protected via an AuthContext and ProtectedRoute component. Tokens expire after 24 hours; refresh tokens not required. |

### 4.9 Prompt Sanitization

| ID | Requirement |
|----|-------------|
| **FR-036** | **Prompt Sanitization** — After prompt compilation and before moderation, the FTE applies deterministic sanitization: strip PII (email addresses, phone numbers, physical addresses) from prompts, enforce per-model character limits and format constraints, remove prompt injection patterns. No LLM call required — sanitization is rule-based and deterministic. |

---

## 5. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| **NFR-001** | **Availability** — 99.5% monthly uptime for user-facing interfaces; generation availability dependent on third-party model providers. |
| **NFR-002** | **Latency** — Shot plan returned within 10 seconds of story submission. Admission processing adds under 2 seconds per shot. |
| **NFR-003** | **Throughput** — Supports at least 50 concurrent stories and 200 concurrent shots in flight. |
| **NFR-004** | **Data Durability** — Zero data loss for all user and operational data (RPO = 0). |
| **NFR-005** | **Recovery Time** — Service recovery under 5 minutes for infrastructure failures; in-flight shots automatically recover. |
| **NFR-006** | **Encryption** — Biometric embeddings encrypted at rest with per-user keys. PII encrypted at rest and in transit. |
| **NFR-007** | **Scalability** — The FTE scales to handle increasing load without degradation of latency, throughput, or availability. New model providers can be added without service disruption. |
| **NFR-008** | **Compliance** — Audit logs retained per compliance requirements (minimum 7 years). Sacred Guard denylist changes require dual-authorization. |

---

## 6. Constraints

| ID | Constraint |
|----|------------|
| **CON-001** | **Sacred Guard Order** — Admission pipeline order (Moderation → Sacred → Cost → Rate Limit) is immutable. No reordering, bypassing, or conditional skipping. |
| **CON-002** | **Sacred Guard Coverage** — Sacred Guard checks at all 5 enforcement points (creation, registry, moderation, pre-dispatch, post-gen) are mandatory. |
| **CON-003** | **Face-Lock Persistence** — Visual identity of registered characters must persist across all shots in a story. No exceptions. |
| **CON-004** | **Postgres as System of Record** — All structured state (stories, shots, registry, audit, queues) persists in PostgreSQL with pgvector, full-text search, and durable queues. |
| **CON-005** | **No Implementation in Spec** — This specification describes observable behaviour only. Model adapter implementations, queue schemas, database schemas, API contracts are out of scope. |
| **CON-006** | **Model Provider ToS** — All model interactions comply with respective provider Terms of Service and Acceptable Use Policies. |
| **CON-007** | **Regional Restrictions** — Some models unavailable in certain regions; router must respect geographic eligibility. |

---

## 7. Edge Cases & Rules

| ID | Edge Case | Rule |
|----|-----------|------|
| **EC-001** | Empty story brief | Reject with validation error: "Story narrative required" |
| **EC-002** | Story with zero shots after decomposition | Reject: "Unable to derive shots from narrative" |
| **EC-003** | Character reference image contains no detectable face | Reject upload: "No face detected in reference image" |
| **EC-004** | Character reference matches Sacred Guard denylist | Block upload; audit log entry; no embedding stored |
| **EC-005** | Shot contains character not in registry | Generate without identity verification; log warning |
| **EC-006** | All available models fail for a shot | Mark shot failed; pause story; notify user with failure details and manual retry option |
| **EC-007** | Unrecognized completion notification received | Log and discard; record observability signal |
| **EC-008** | Duplicate completion notification received | Ignore duplicate; no duplicate charge or merge |
| **EC-009** | Cost estimate unavailable for selected model | Use conservative ceiling estimate; flag for manual review if actual exceeds 2× estimate |
| **EC-010** | User cancels story mid-generation | User chooses: (a) complete in-progress shots then merge, (b) stop immediately (no merge), or (c) stop after current model call returns. Refund/waive charges for undispatched shots. |
| **EC-011** | Story exceeds maximum shot limit | Max shots = ceil(target_duration_seconds / selected_model_max_shot_duration). Exceeding this rejects with "Story exceeds maximum shots for target duration and model"; user may reduce duration or choose model with longer max shot duration |
| **EC-012** | Aspect ratio unsupported by selected model | Exclude model; if none eligible, reject shot with alternatives |
| **EC-013** | Generated video duration differs from requested | Accept within configurable tolerance per story (default per-model); outside tolerance triggers re-generation (limited retries) |
| **EC-014** | Sacred Guard false positive (benign content flagged) | User may appeal; override requires two-person authorization (two approved users) and immutable logging |
| **EC-015** | Face-Lock verification fails after max retries | Offer user: proceed without verification, try alternative model, or cancel story |
| **EC-016** | Rate limit exceeded with no queue capacity | Reject with retry guidance; do not silently drop |
| **EC-017** | Model provider interface change | Isolate impact, pause affected shots, emit alert |
| **EC-018** | Simultaneous Sacred Guard + Cost Guard violation | Sacred Guard blocks first; both recorded |
| **EC-019** | Encryption key rotation | Transparent re-encryption every 90 days, zero downtime, integrity verified. Automated in background. |
| **EC-020** | Story merge fails (corrupted shot) | Retry; if persistent, mark failed, deliver completed shots individually |

---

## 8. Out of Scope

The following are explicitly **not** part of this Digital FTE's behavioural specification:

- **User authentication/authorization** — JWT-based with local password storage (bcrypt). Login page, auth context, ProtectedRoute guard on all routes.
- **Billing & payment processing** — Cost tracking only; invoicing/payment external
- **Video hosting/CDN/streaming** — Final delivery is downloadable asset or signed URL
- **Creative writing / story generation** — User provides the narrative
- **Model training / fine-tuning** — Uses pre-trained models only
- **Real-time collaboration** — Single-user story ownership
- **Mobile/native apps** — API-first; UI is consumer responsibility
- **Multi-language prompt translation** — Prompts in English; user handles translation
- **Legal/compliance review workflow** — Audit logs support it; workflow is external
- **Custom model deployment** — Only supported providers via adapters
- **3D asset generation** — 2D video only
- **Live/streaming video** — Batch generation only

---

## 9. Acceptance Criteria

### 9.1 Story Ingestion & Planning

| ID | Criterion |
|----|-----------|
| **AC-001** | Given a valid story brief, when submitted, then a shot plan is returned within 10 seconds with ≥1 shot |
| **AC-002** | Given a story brief with character references, when submitted, then characters are registered and available for Face-Lock |
| **AC-003** | Given a shot plan, when user requests modification, then plan updates and re-presents without generation starting |
| **AC-004** | Given an empty narrative, when submitted, then rejection with "Story narrative required" |

### 9.2 Admission Control (Sacred Guard)

| ID | Criterion |
|----|-----------|
| **AC-005** | Given a prompt containing an exact sacred personality name, when admitted, then blocked at Sacred Guard gate with categorized reason |
| **AC-006** | Given a prompt with transliteration variant, when admitted, then blocked at Sacred Guard gate (fuzzy match) |
| **AC-007** | Given a reference image visually resembling a sacred personality, when registering character, then blocked at registry Sacred Guard check |
| **AC-008** | Given a shot passing Moderation but failing Sacred Guard, when admitted, then blocked at Sacred Guard (order: Moderation → Sacred) |
| **AC-009** | Given a generated frame matching sacred personality, when post-generation audit runs, then shot flagged and story paused |
| **AC-010** | Given a denylist change, when applied, then dual-authorization recorded immutably |

### 9.3 Admission Control (Cost & Rate Limit)

| ID | Criterion |
|----|-----------|
| **AC-011** | Given estimated shot cost > user remaining budget, when Cost Guard evaluates, then shot paused with options (reduce scope, increase budget, cancel) |
| **AC-012** | Given user at rate limit, when Rate Limit gate evaluates, then shot queued with estimated wait time |
| **AC-013** | Given Cost Guard and Sacred Guard both violated, when admitted, then Sacred Guard rejection takes precedence; both logged |

### 9.4 Shot Generation & Routing

| ID | Criterion |
|----|-----------|
| **AC-014** | Given a shot with 4K requirement, when models are evaluated for eligibility, then only 4K-capable models eligible |
| **AC-015** | Given primary model times out, when timeout reached, then automatic fallback to alternative model occurs |
| **AC-016** | Given all models fail for a shot, when retries exhausted, then shot marked failed; story paused; user notified |
| **AC-017** | Given completion notice delayed beyond threshold, when recovery runs, then job recovered and processing continues |
| **AC-018** | Given duplicate completion notice, when processed, then no duplicate charge or merge |

### 9.5 Face-Lock / Identity Persistence

| ID | Criterion |
|----|-----------|
| **AC-019** | Given a registered character in 3 shots, when all shots generated, then character appearance consistent across all shots (verified against original reference) |
| **AC-020** | Given a shot with a registered character, when Face-Lock verification fails, then automatic re-generation triggered (limited retries) |
| **AC-021** | Given Face-Lock fails after max retries, when user chooses to proceed without verification, then shot completes without verification; flag recorded |
| **AC-022** | Given multi-character shot, when generated, then each character verified independently against their own reference |

### 9.6 Video Assembly & Delivery

| ID | Criterion |
|----|-----------|
| **AC-023** | Given all shots completed, when merge runs, then output video contains all shots in order with smooth transitions |
| **AC-024** | Given native audio from models, when merging, then audio preserved per shot |
| **AC-025** | Given story completion, when delivered, then user receives: download link, cost summary, generation logs, verification reports |

### 9.7 Observability & Audit

| ID | Criterion |
|----|-----------|
| **AC-026** | Given any state change, when it occurs, then transition notified |
| **AC-027** | Given Sacred Guard decision, when made, then immutable audit record with full context (timestamp, gate, rule, context) |
| **AC-028** | Given cost drift detected (>20% rolling average), when detected, then alert emitted with story/shot context |
| **AC-029** | Given health status requested, when service healthy, then returns healthy status with metrics |

### 9.8 Non-Functional

| ID | Criterion |
|----|-----------|
| **AC-030** | Given 50 concurrent stories, when load applied, then all ingestion interfaces respond within 10 seconds (P99) |
| **AC-031** | Given infrastructure failure, when recovered, then in-flight shots resume automatically; no data loss (RPO=0) |
| **AC-032** | Given biometric embedding stored, when at rest, then encrypted with per-user keys |
| **AC-033** | Given denylist modification attempt, when submitted, then dual-authorization enforced; single-author rejected |

---

## 10. Traceability Matrix

| Requirement | Acceptance Criteria | Intent Invariant | Research Source |
|-------------|---------------------|------------------|-----------------|
| FR-001–FR-004 | AC-001–AC-004 | — | §7 User Workflows |
| FR-005–FR-008 | AC-014 | — | §2 Model Landscape, §13 Recs |
| FR-009–FR-015 | AC-005–AC-013 | Sacred Guard Ordering | §4 Sacred Guard, §1.3 Prior Arch |
| FR-016–FR-021 | AC-015–AC-018 | — | §6 Webhook Reliability, §5 Cost Guard |
| FR-022–FR-026 | AC-019–AC-022 | Face-Lock Persistence | §3 Face-Lock, §1.3 Prior Arch |
| FR-027–FR-030 | AC-023–AC-025 | — | §7 User Workflows |
| FR-031–FR-034 | AC-026–AC-029 | — | §8.2 System of Record |
| NFR-001–NFR-008 | AC-030–AC-033 | System of Record | §8 Constraints, §5 Cost Guard |
| CON-001–CON-007 | (Governance) | Sacred Guard, Face-Lock, SoR | INTENT.md §168–180, §216–227; CLAUDE.md §16 |
| EC-001–EC-020 | (Embedded in ACs) | — | §9 Failure Modes, §8 Constraints |

---

## 11. Clarification Log

*Optional supplementary history — does not supersede this specification.*

### CL-001: Sacred Guard Visual/Semantic Similarity Threshold
**Date**: 2026-08-05  
**Question**: What similarity threshold should trigger a Sacred Guard block for visual/semantic matching (FR-011)?  
**Decision**: Configurable per-model threshold with default range of 0.75–0.80 cosine similarity.  
**Rationale**: Accounts for model-specific embedding spaces with sensible defaults; allows tuning per provider.  
**Updated**: FR-011 now specifies "Visual/semantic similarity threshold is configurable per model provider (default range: 0.75–0.80 cosine similarity)."

---

### CL-002: Face-Lock Verification Similarity Threshold
**Date**: 2026-08-05  
**Question**: What similarity threshold should trigger a Face-Lock verification pass/fail for character identity matching (FR-024)?  
**Decision**: Configurable per-model/character threshold with sensible per-model defaults.  
**Rationale**: Different models produce different embedding spaces; per-model/character configurability allows tuning accuracy.  
**Updated**: FR-024 now specifies "verified against the registered identity using a configurable per-model/character similarity threshold (default per-model range)."

### CL-003: Face-Lock Maximum Retry Limit
**Date**: 2026-08-05  
**Question**: What is the maximum retry limit when Face-Lock verification fails (FR-024, EC-015)?  
**Decision**: Configurable per-model/character with default of 2 retries.  
**Rationale**: Balances automatic recovery with preventing infinite loops; default matches prior design; per-model/character allows tuning for difficult matches.  
**Updated**: FR-024 now specifies "re-generation with a configurable per-model/character retry limit (default: 2)."

### CL-004: Generated Video Duration Tolerance
**Date**: 2026-08-05  
**Question**: What tolerance should be accepted for generated video duration vs. requested duration before triggering re-generation (EC-013)?  
**Decision**: Configurable per story with per-model default.  
**Rationale**: Different models have different duration accuracy; per-story configurability gives user control; per-model default provides sensible baseline.  
**Updated**: EC-013 now specifies "Accept within configurable tolerance per story (default per-model); outside tolerance triggers re-generation (limited retries)."

### CL-005: Maximum Shot Limit Determination
**Date**: 2026-08-05  
**Question**: How should the maximum shot limit be determined (EC-011)?  
**Decision**: Duration-based — max shots = ceil(target_duration_seconds / selected_model_max_shot_duration). Adapts automatically to story length and model capability.  
**Rationale**: Fixed shot counts don't account for varying model max durations (e.g., Veo 3 ~10s vs others). Duration-based aligns limit with actual generation constraints.  
**Updated**: EC-011 now specifies "Max shots = ceil(target_duration_seconds / selected_model_max_shot_duration). Exceeding this rejects with 'Story exceeds maximum shots for target duration and model'; user may reduce duration or choose model with longer max shot duration."

### CL-006: Automatic Model Selection Priority
**Date**: 2026-08-05  
**Question**: How should the AUTO Router prioritize models when different users have different preferences (e.g., Veo 3 free on Flow.ai vs. other users preferring other models)?  
**Decision**: Per-user configured model priority list. System default applies when unconfigured. Ineligible models skipped in priority order.  
**Rationale**: Accommodates varying provider access (Flow.ai free Veo 3) and user preferences. Per-user config > per-shot override (FR-008) > system default.  
**Updated**: FR-006 now specifies "based on the user's configured model priority list. When no user preference is configured, a system default priority applies."

### CL-007: Shot Generation Timeout
**Date**: 2026-08-06  
**Question**: What should the shot generation timeout approach be (FR-020)?  
**Decision**: Per-model default timeouts (e.g., Veo 3: 120s, Runway: 180s), user-overridable per story.  
**Rationale**: Different models have vastly different generation/queue characteristics. Per-model defaults are predictable; per-story override gives control.  
**Updated**: FR-020 now specifies "per-model timeout default... User may override per story."

### CL-008: Webhook Watchdog Polling
**Date**: 2026-08-06  
**Question**: What should the Webhook Watchdog polling interval and max wait be (FR-019)?  
**Decision**: 30-second interval, 10-minute maximum wait after expected completion.  
**Rationale**: Matches prior design; balances responsiveness with provider load. Covers typical delayed notifications without excessive polling.  
**Updated**: FR-019 now specifies "polling the provider every 30 seconds for up to 10 minutes after expected completion."

### CL-009: Sacred Guard Dual-Authorization
**Date**: 2026-08-06  
**Question**: How should Sacred Guard dual-authorization work for denylist changes and false-positive appeals (EC-014, AC-010)?  
**Decision**: Two-person rule — two approved users must each approve before change takes effect. Immutable log records both approvals.  
**Rationale**: Strong governance for safety-critical changes; prevents single-person modification of denylist.  
**Updated**: EC-014 now specifies "override requires two-person authorization (two approved users) and immutable logging."

### CL-010: Cost Guard Estimation
**Date**: 2026-08-06  
**Question**: How should Cost Guard estimate and compare costs (FR-013, EC-009)?  
**Decision**: Per-model default cost estimates (e.g., Veo 3 low quality $0, Veo 3 high $X, Runway $Y), user-overridable per story. Compared against remaining budget, project ceiling, committed-spend limit.  
**Rationale**: Matches reality — Veo 3 low quality free on Flow.ai; other models have known costs. Per-story override handles special cases.  
**Updated**: FR-013 now specifies "estimated shot cost (using per-model defaults: e.g., Veo 3 low quality $0, Veo 3 high $X, Runway $Y; user-overridable per story)".

### CL-011: Cost Drift Thresholds
**Date**: 2026-08-06  
**Question**: Should cost drift alert thresholds be fixed or configurable (FR-021)?  
**Decision**: Configurable per story with defaults (>50% single-shot, >20% rolling average).  
**Rationale**: Different projects have different risk tolerances; defaults provide sensible baseline.  
**Updated**: FR-021 now specifies "configurable threshold (default >50%) or rolling average exceeds configurable threshold (default >20%). User may override thresholds per story."

### CL-012: Rate Limit Defaults
**Date**: 2026-08-06  
**Question**: What should default rate limits be (per-model, per-user, global) (FR-014)?  
**Decision**: Configurable defaults with sensible starting values (e.g., Veo 3: 10/min, Runway: 5/min, per-user: 20/min, global: 100/min). Overridable per project.  
**Rationale**: Matches provider quotas; per-project config accommodates enterprise tiers and varying capacity.  
**Updated**: FR-014 now specifies "with configurable defaults (e.g., Veo 3: 10/min, Runway: 5/min, per-user: 20/min, global: 100/min). User/admin may override per project."

### CL-013: Audio Generation (TTS + Music)
**Date**: 2026-08-06  
**Question**: How should the FTE handle audio when models don't generate native audio (FR-028)?  
**Decision**: External TTS provider integration (e.g., ElevenLabs) with multiple voice/style options (e.g., "shivank", "deep breath", "suspense") + royalty-free music library. User may override with own assets.  
**Rationale**: ElevenLabs provides high-quality emotive voices; user wants style/voice selection. Music library covers background needs.  
**Updated**: FR-028 now specifies "generates TTS voiceover via external provider (e.g., ElevenLabs) with user-selectable voices and styles... and applies royalty-free background music from integrated library."

### CL-014: Default Shot Transition
**Date**: 2026-08-06  
**Question**: What should the default cross-fade transition be between shots (FR-027)?  
**Decision**: Fixed 0.5s cross-fade default, user-overridable per shot or globally.  
**Rationale**: Smooth default for most narratives; override allows creative control.  
**Updated**: FR-027 now specifies "with a default 0.5s cross-fade transition between shots. User may override transition type/duration per shot or globally."

### CL-015: Output Resolutions
**Date**: 2026-08-06  
**Question**: What output resolutions should be supported (FR-029, EC-012)?  
**Decision**: 720p, 1080p (default), 4K — up to model maximum. Model eligibility filters by capability.  
**Rationale**: Standard resolutions cover most use cases; default 1080p balances quality/speed.  
**Updated**: FR-029 now specifies "at user-specified resolution: 720p, 1080p (default), or 4K, up to model maximum."

### CL-016: Story Cancellation Behavior
**Date**: 2026-08-06  
**Question**: What should happen when user cancels mid-generation (EC-010)?  
**Decision**: User chooses per cancellation: (a) complete in-progress then merge, (b) stop immediately (no merge), (c) stop after current model call. Refund/waive undispatched shots.  
**Rationale**: Gives user control over time vs. cost trade-off; different situations need different behavior.  
**Updated**: EC-010 now specifies "User chooses: (a) complete in-progress shots then merge, (b) stop immediately (no merge), or (c) stop after current model call returns. Refund/waive charges for undispatched shots."

### CL-017: Encryption Key Rotation
**Date**: 2026-08-06  
**Question**: What should the encryption key rotation interval be (EC-019)?  
**Decision**: 90-day rotation with automated zero-downtime re-encryption, integrity verified.  
**Rationale**: Standard security practice; zero-downtime automation avoids operational burden.  
**Updated**: EC-019 now specifies "Transparent re-encryption every 90 days, zero downtime, integrity verified. Automated in background."

### CL-018: Aspect Ratio Options
**Date**: 2026-08-06  
**Question**: What aspect ratios should be supported in story brief (FR-001)?  
**Decision**: 16:9 (default), 9:16, 1:1, 4:5. Model eligibility filters by capability.  
**Rationale**: Covers landscape, portrait, square, vertical; default 16:9 standard.  
**Updated**: FR-001 now specifies "aspect ratio (16:9 default, 9:16, 1:1, 4:5 supported)."

### CL-019: Download Link TTL
**Date**: 2026-08-06  
**Question**: What should the download link time-to-live be (FR-030)?  
**Decision**: 7 days.  
**Rationale**: Standard deliverable window; balances security with user convenience for download.  
**Updated**: FR-030 now specifies "download link (7-day TTL)."

### CL-020: Transition Types
**Date**: 2026-08-06  
**Question**: What transition types should be available beyond default cross-fade (FR-027)?  
**Decision**: Any FFmpeg transition filter (fade, slide, zoom, wipe, etc.) with configurable duration per shot or globally.  
**Rationale**: Maximum creative flexibility; FFmpeg is standard for video processing.  
**Updated**: FR-027 now specifies "override with any FFmpeg transition filter (e.g., fade, slide, zoom, wipe) and duration per shot or globally."

### CL-021: Character Identity Parameters
**Date**: 2026-08-06  
**Question**: How are character identity parameters applied in prompt compilation (FR-016)?  
**Decision**: For each registered character in a shot, FTE automatically applies that character's named reference image from registry (user provides name + image once at story creation).  
**Rationale**: User uploads once per character; FTE auto-matches by name across all shots.  
**Updated**: FR-016 now specifies "For each registered character present in the shot, the FTE automatically applies that character's named reference image from the registry (user provides name + image once at story creation)."

### CL-022: Music Library Sources
**Date**: 2026-08-06  
**Question**: What music library sources for background music (FR-028)?  
**Decision**: Royalty-free library + ElevenLabs music library. User may override with own assets.  
**Rationale**: Dual source covers variety; ElevenLabs integration already used for TTS.  
**Updated**: FR-028 now specifies "applies background music from integrated royalty-free library + ElevenLabs music library."

### CL-023: Subtitle Formats
**Date**: 2026-08-06  
**Question**: What subtitle formats for metadata sidecars (FR-029)?  
**Decision**: SRT (default), VTT, ASS.  
**Rationale**: SRT standard, VTT for web, ASS for advanced styling.  
**Updated**: FR-029 now specifies "Optional subtitle sidecars in SRT (default), VTT, or ASS format, plus metadata sidecars included."

---

### CL-024: Vault Production TLS Protocol
**Date**: 2026-08-10  
**Question**: What TLS protocol should Vault use in production — HTTPS with self-signed certificates for verification, or HTTP (dev-style, no TLS)?  
**Decision**: HTTPS/TLS with self-signed certificates acceptable for local verification/build phase. Production-grade CA/certificate requirements must remain explicitly distinguished from local verification certificates.  
**Rationale**: 80% of production configuration already assumes HTTPS (vault.hcl api_addr/cluster_addr, docker-compose.prod.yaml VAULT_ADDR, setup-secrets.sh generates certs, healthcheck uses -tls-skip-verify). Self-signed for verification is per Principal direction. Spec has zero Vault protocol requirements — choosing HTTPS modifies observable security posture (Specification Stability Rule CLAUDE.md §8). Clarification required and completed.  
**Updated**: No functional requirements changed (spec specifies behavioral requirements only: "securely store/retrieve secrets via Vault", "sealed state must not break dependent services"). Implementation must align Vault listener TLS state with all consumer configurations.

---

### CL-025: Dev/Prod Coexistence Strategy
**Date**: 2026-08-10  
**Question**: How should development and production Docker stacks coexist — accept mutual exclusion, different host ports for dev, or full isolation?  
**Decision**: Option B — Different host ports for development. Production retains standard ports (5432, 6379, 8200, 3000, 9090, 9091, 3001, 80, 443, 9093). Development uses clearly documented non-conflicting host ports (offset by +1: 5433, 6380, 8201, 3001, 9091, 9092, 3002). Dev and production must remain isolated in Docker project/network/volume configuration. Internal service-to-service addresses must not be altered by port changes.  
**Rationale**: Current state has 7 identical host ports preventing simultaneous operation. Option B requires zero production changes, minimal dev changes, allows parallel operation. Option A creates developer friction; Option C over-engineers for current scope. This changes developer workflow observable behavior (Specification Stability Rule CLAUDE.md §8). Clarification required and completed.  
**Updated**: No functional requirements changed. Dev stack docker-compose.yaml ports section must be updated to offset ports while preserving internal service addresses (postgres:5432, redis:6379, vault:8200, api:3000/9090, etc.).

---

### CL-026: Luma Provider Removed
**Date**: 2026-08-17  
**Question**: Should Luma be kept in scope as a model provider?  
**Decision**: Remove Luma entirely. Supported providers: Veo 3, Runway, KIE, ElevenLabs (TTS).  
**Rationale**: Principal decision — Luma not needed for current scope.  
**Updated**: FR-005 scope reduced; model registry excludes Luma.

---

### CL-027: Hybrid TTS Approach
**Date**: 2026-08-17  
**Question**: How should voice generation (TTS) work when models don't generate native audio (FR-028)?  
**Decision**: Hybrid — local free-tier TTS (Piper or Coqui TTS) for zero-cost generation + ElevenLabs API for premium quality. User selects approach at story creation time.  
**Rationale**: Local TTS avoids API costs for basic needs; ElevenLabs available for high-quality emotive voices when needed.  
**Updated**: FR-028 now specifies "generates TTS voiceover via either local free-tier engine (user selection) or external API provider (e.g., ElevenLabs) with user-selectable voices and styles... User chooses TTS engine at story creation."

---

### CL-028: Authentication Architecture
**Date**: 2026-08-17  
**Question**: What authentication approach for the frontend?  
**Decision**: JWT + local passwords. Login page issues token; ProtectedRoute validates it. No external provider.  
**Rationale**: Simple, self-contained. No dependency on external OAuth providers.  
**Updated**: Added FR-035 (User Authentication). Removed "Assumed provided by host platform" from Out of Scope.

---

### CL-029: Face-Lock Verification Implementation
**Date**: 2026-08-17  
**Question**: Face-Lock verification is currently a mock. How should it be implemented?  
**Decision**: Full real implementation — FFmpeg frame extraction + ArcFace/InsightFace embedding computation.  
**Rationale**: Face-Lock is a mandatory invariant (CON-003). Mock verification defeats the purpose.  
**Updated**: Implementation plan must replace mock verification with real frame extraction and embedding computation.

---

### CL-030: Prompt Sanitizer Scope
**Date**: 2026-08-17  
**Question**: What should the sanitization step between prompt compilation and moderation do?  
**Decision**: PII strip (emails, phones, addresses) + per-model character/length constraints + prompt injection pattern removal. Deterministic, rule-based, no LLM.  
**Rationale**: Lightweight, predictable, no cost. Moderation gate already catches harmful content.  
**Updated**: Added FR-036 (Prompt Sanitization).

---

### CL-031: LLM Prompt Engine Integration
**Date**: 2026-08-17  
**Question**: How should the LLM integrate with the template prompt compiler?  
**Decision**: LLM enhances template-compiled prompts — adds cinematic detail, style coherence, negative prompts. Template fallback when no LLM key. User reviews/edits prompt before dispatch.  
**Rationale**: Best of both worlds — creative enhancement when available, reliable fallback when not.  
**Updated**: FR-016 updated to specify LLM enhancement + template fallback + user review step.

---

### CL-032: Luma Adapter Removal
**Date**: 2026-08-17  
**Question**: Luma Ray2 appears in config defaults but no adapter exists. CL-026 removed Luma from scope.  
**Decision**: Remove luma-ray2 from all config defaults (config.ts:119,129,144,157). Delete luma_key.txt.  
**Rationale**: Dead config creates false user expectation. Clean removal per CL-026.  
**Updated**: Implementation plan includes Luma config cleanup.

---

### CL-033: Weak Secrets Strategy
**Date**: 2026-08-17  
**Question**: postgres_password='postgres', redis_password=empty, vault_token='root'. How to handle?  
**Decision**: setup-secrets.sh auto-generates strong random passwords. Existing weak files overwritten only with `--force` flag.  
**Rationale**: Eliminates operator error. Strong defaults for production.  
**Updated**: Implementation plan includes setup-secrets.sh hardening.

---

### CL-034: Frontend Test Framework
**Date**: 2026-08-17  
**Question**: What testing framework for frontend?  
**Decision**: Vitest for unit tests (fast, Vite-native) + Playwright for E2E.  
**Rationale**: Vitest integrates seamlessly with existing Vite build. Playwright already in devDeps.  
**Updated**: Implementation plan includes Vitest + Playwright setup.

---

### CL-035: MEDIUM Issues Scope
**Date**: 2026-08-17  
**Question**: Should MEDIUM issues (dead code, @shared alias, CI Docker build, alertmanager placeholders) be fixed?  
**Decision**: Fix all MEDIUM issues. ~2h extra effort.  
**Rationale**: Clean codebase reduces future confusion. CI Docker build enables container deployment.  
**Updated**: Implementation plan includes all MEDIUM fixes.

---

### CL-036: LLM Provider Selection
**Date**: 2026-08-17  
**Question**: Which LLM provider for prompt enhancement?  
**Decision**: Google Gemini 3.5 Flash. Single-provider implementation.  
**Rationale**: User's choice — competitive pricing, good quality for prompt enhancement.  
**Updated**: Implementation plan specifies Gemini 3.5 Flash API integration.

---

### CL-037: Face-Lock Verification Failure
**Date**: 2026-08-17  
**Question**: What happens when face verification detects a mismatch?  
**Decision**: Auto-regenerate the shot up to 2 times (per CL-003 max retries). If still failing after 2 retries, mark shot as failed and alert user. Other shots continue.  
**Rationale**: Balances automated recovery with user awareness. 2 retries is per CL-003 default.  
**Updated**: Implementation plan includes face-lock failure path with retry logic.

---

### CL-038: JWT Token Refresh
**Date**: 2026-08-17  
**Question**: Should we implement JWT token refresh?  
**Decision**: No refresh token. 24-hour expiry, re-login required.  
**Rationale**: Internal tool — simplicity over seamless sessions. Reduces attack surface.  
**Updated**: FR-035 clarified — no refresh mechanism.

---

### CL-039: Local TTS Engine
**Date**: 2026-08-17  
**Question**: Which local TTS engine for free-tier?  
**Decision**: Piper TTS. C++ inference, ~real-time speed, 20-50MB models.  
**Rationale**: Fastest inference, smallest footprint, easiest to install. Coqui deferred.  
**Updated**: CL-027 clarified — Piper as primary local TTS engine.

---

### CL-040: Prompt Review UX
**Date**: 2026-08-17  
**Question**: Where should the prompt review step appear in the UX flow?  
**Decision**: Dedicated review page. After shot plan approval, user navigates to prompt review page, sees compiled prompts for all shots, can edit each, then clicks "Dispatch".  
**Rationale**: Full-page review gives adequate space for prompt editing. Clean separation of concerns.  
**Updated**: FR-016 clarified — dedicated review page between plan approval and dispatch.

---

*(To be populated during Phase 4 Clarification interview)*

---

*End of Behavioural Specification*