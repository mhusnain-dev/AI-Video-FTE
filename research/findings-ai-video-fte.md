# Research Findings: AI Video Production Specialist Digital FTE

**Project**: AI Video Production Specialist Digital FTE  
**Phase**: 2 — Research  
**Date**: 2026-08-05  
**Sources**: Panaversity thesis & crash courses, `specs.md` (domain knowledge), Web searches (2024–2025)

---

## Table of Contents

1. [Prior Art & Existing Solutions](#1-prior-art--existing-solutions)
2. [Generative Video Model Landscape](#2-generative-video-model-landscape)
3. [Face-Lock / Identity Conditioning Approaches](#3-face-lock--identity-conditioning-approaches)
4. [Sacred Entity / Content Moderation Patterns](#4-sacred-entity--content-moderation-patterns)
5. [Cost Guard & Budget Management](#5-cost-guard--budget-management)
6. [Webhook Reliability & Idempotency](#6-webhook-reliability--idempotency)
7. [User Workflows & Domain Knowledge](#7-user-workflows--domain-knowledge)
8. [Constraints & Risks](#8-constraints--risks)
9. [Failure Modes](#9-failure-modes)
10. [Alternative Approaches & Trade-offs](#10-alternative-approaches--trade-offs)
11. [Unknowns & Open Questions](#11-unknowns--open-questions)
12. [Assumptions](#12-assumptions)
13. [Recommendations](#13-recommendations)

---

## 1. Prior Art & Existing Solutions

### 1.1 AI Video Generation Platforms (Commercial)

| Platform | Model(s) | Access Model | Key Differentiator |
|----------|----------|--------------|-------------------|
| **Google Veo 3 / 3.1** | Veo 3, Veo 3.1 | Vertex AI, Gemini API, AI Studio, Flow | Native video+audio; 4K; Ingredients-to-Video for consistency |
| **Kuaishou Kling 3.0** | Kling 3.0, 3.0 Omni | Kling.art, API (model IDs: `kuaishou/kling-video-3.0`) | 4K@60fps; native audio (Omni); character identity binding |
| **Runway Gen-3 Alpha** | Gen-3 Alpha | Dev Portal (dev.runwayml.com) | Fine-grained temporal control; Director Mode; photorealistic humans |
| **OpenAI Sora / Sora 2** | Sora, Sora 2, Sora 2 Pro | OpenAI API (`/videos` endpoints) | Character assets API; extensions/edits; 1080p (Pro) |

### 1.2 Open-Source / Local Models

| Model | License | Variants | Hardware Requirements |
|-------|---------|----------|----------------------|
| **Wan 2.1** (Alibaba) | Apache 2.0 | T2V-1.3B, T2V-14B, I2V-14B (480P/720P), FLF2V-14B, VACE-1.3B/14B | 8.19 GB VRAM (1.3B); multi-GPU via FSDP+xDiT |

### 1.3 Prior Architecture (from `specs.md`)

The `specs.md` document (v5, consolidated from 4 review rounds) defines a complete architecture for an "AI Story Video Agent" with:

- **5-layer architecture**: Client → API Gateway → Orchestration → Pipeline Services → Data/Event Layers
- **IModelAdapter plugin layer** for model-agnostic shot generation (Veo 3, Kling, Runway, Sora, Wan)
- **AUTO Router** scoring: `0.5*realism - 0.3*norm(cost) - 0.2*norm(eta)`
- **Admission Controller** with fixed order: **Moderation → Sacred → Cost → Rate Limit**
- **Sacred Personality Restriction**: multi-stage denylist (exact + transliteration + Levenshtein ≤2 + SBERT ≥0.78)
- **Face-Lock**: per-adapter conditioning (reference-conditioned: Wan IP-Adapter/InstantID, Kling/Runway I2V; verify-only: Veo 3, Sora)
- **Cost Guard**: committed-spend with drift detection (overrun_ratio > 0.5 or rolling avg > 0.2)
- **Webhook Watchdog**: 30s polling fallback, HMAC idempotency keys

---

## 2. Generative Video Model Landscape

### 2.1 Capability Comparison (2024–2025)

| Capability | Veo 3/3.1 | Kling 3.0 | Runway Gen-3 | Sora 2/2 Pro | Wan 2.1 |
|------------|-----------|-----------|--------------|--------------|---------|
| **Max Resolution** | 4K | 4K | Not specified | 1080p (Pro) | 720p (14B) |
| **Max Duration** | Not specified | 15s, 6 cuts | Not specified | 20s | Not specified |
| **Native Audio** | ✅ Video+audio | ✅ Omni only | ❌ | ❌ | ❌ |
| **Character Consistency** | Ingredients-to-Video | Identity binding | Enterprise fine-tune | Characters API | VACE ref images |
| **Face Conditioning API** | Reference images | Visual/vocal traits binding | Not in API | Blocked by default | No native (IP-Adapter possible) |
| **API Access** | Vertex AI, Gemini API | Kling.art, model IDs | Dev Portal | OpenAI API | Local / Hugging Face |
| **Pricing Model** | Not public | Free tier (3/day), paid | Not public | Pro more expensive | Free (Apache 2.0) |
| **Latency** | Not public | Not specified | Not specified | Minutes per render | ~4 min/5s @ 4090 |

### 2.2 Key Technical Findings

**Veo 3.1** (Google DeepMind, Oct 2025):
- Native video+audio generation (sound effects, ambient, dialogue)
- "Ingredients to Video" — reference images for scene/character/object consistency
- Style transfer, scene extension, camera controls, outpainting, object insertion/removal
- Character controls (body/face/voice-driven), motion controls (object paths)
- SynthID watermarking; safety evaluations for privacy/copyright/bias
- **No public pricing/latency/face-conditioning API details**

**Kling 3.0** (Kuaishou):
- 4K@60fps, up to 15s, 6 camera cuts
- Omni variants: native voices, music, SFX; lip-sync; 5 languages
- "Extract visual and vocal traits from a reference and bind them to generated characters"
- Voice + character identity binding (Omni)
- Free tier: 3 videos/day via Kling.art

**Runway Gen-3 Alpha**:
- Joint video+image training; fine-grained temporal control via dense captions
- Photorealistic humans with expressive actions/gestures/emotions
- Motion Brush, Advanced Camera Controls, Director Mode
- "Industry Customization" for consistent characters (enterprise fine-tuning)
- C2PA provenance; in-house visual moderation

**Sora 2 / Sora 2 Pro** (OpenAI):
- Async API: `POST /videos` → poll `GET /videos/{id}` → download `GET /videos/{id}/content`
- Extensions (`/videos/extensions`), edits (`/videos/edits`), characters (`/videos/characters`)
- Sora 2 Pro required for 1080p; renders take "several minutes"
- **Real people blocked by default**; human-likeness access requires sales contact
- Copyrighted characters/music rejected; content suitable for under-18 only

**Wan 2.1** (Alibaba, Apache 2.0):
- T2V/I2V/FLF2V/VACE variants; 1.3B (8.19 GB VRAM) and 14B models
- 480P (1.3B) and 480P/720P (14B); visual text generation (CN/EN)
- Wan-VAE for unlimited-length 1080P encoding; VACE for reference-to-video
- **No native IP-Adapter/InstantID** — but compatible via Diffusers/ComfyUI
- "We claim no rights over your generated contents"

---

## 3. Face-Lock / Identity Conditioning Approaches

### 3.1 Conditioning Methods (Technical)

| Method | Type | Models Supporting | Mechanism |
|--------|------|-------------------|-----------|
| **IP-Adapter** | Image prompt adapter | SD-based (Wan via Diffusers) | Decoupled cross-attention (22M params); separates text/image features |
| **InstantID** | Zero-shot ID preservation | SD1.5/SDXL | IdentityNet: strong semantic + weak spatial conditions (landmarks + text) |
| **I2V Reference Frame** | Image-to-Video | Kling, Runway | First frame as conditioning input |
| **Ingredients / Reference Images** | Multi-image conditioning | Veo 3.1 | Multiple reference images for scene/character/object consistency |
| **Characters API** | Reusable character assets | Sora 2 | `POST /videos/characters` for persistent character identity |

### 3.2 Verification Approaches

| Approach | Method | Threshold | When Applied |
|----------|--------|-----------|--------------|
| **ArcFace Cosine Similarity** | 512-dim embedding comparison | Default 0.45 (configurable 0.30–0.70) | Post-generation (all adapters) |
| **Liveness Detection** | Anti-spoofing (Mediapipe FaceMesh) | Score ≥ 0.8 | Enrollment (upload) |
| **Face Match Threshold** | Per-character configurable | Stored in `char_registry` | Per-shot verification |

### 3.3 Per-Adapter Strategy (from `specs.md`)

| Adapter Category | Models | Face-Lock During Generation | Post-Gen Verification |
|------------------|--------|----------------------------|----------------------|
| **Reference-conditioned** | Wan (IP-Adapter/InstantID), Kling (I2V), Runway (I2V) | ✅ Identity steered *during* generation | Guardrail |
| **Verify-only** | Veo 3, Sora | ❌ Text descriptor only | Primary enforcement |

**Router Policy**: AUTO Router down-ranks verify-only adapters for `requires_visual_continuity=true` characters unless user explicitly pins a model.

### 3.4 Threshold Tuning (from `specs.md` Recommendations)

- Similarity scores logged to Prometheus histogram (bucketed by model, genre, demographic slice)
- Weekly batch job computes FPR/FNR; auto-suggests per-model threshold adjustments (target FPR ≤2%)
- Fairness delta alert: if any demographic slice FPR > 1.5× global FPR → block auto-suggestions
- Per-character user overrides (0.30–0.70) always take precedence

---

## 4. Sacred Entity / Content Moderation Patterns

### 4.1 Multi-Stage Enforcement (from `specs.md`)

| Stage | Check | Action on Match |
|-------|-------|-----------------|
| **1. Character Creation** | Name vs. denylist | Reject: `SACRED_ENTITY` |
| **2. Registry Write** | Name association | Block |
| **3. Moderation Pre-Check** | Compiled prompt scan | Flag: `content_policy` or `sacred_entity` |
| **4. Pre-Dispatch Guard** | Character name + prompt text | Flag: `sacred_entity`; no model call |
| **5. Post-Gen Visual Audit** | Image classifier (silhouette/body implied identity) | Mandatory for sacred class; flag → human review |

### 4.2 Denylist Matching Strategy

| Method | Configuration |
|--------|---------------|
| **Exact Match** | Case-insensitive, Unicode NFKC normalized |
| **Transliteration** | Arabic→Latin, Cyrillic→Latin phonetic approximation |
| **Levenshtein Distance** | ≤ 2 (typos, variants) |
| **SBERT Cosine Similarity** | ≥ 0.78 (`paraphrase-multilingual-mpnet-base-v2`) |

### 4.3 Governance & Testing (from `specs.md`)

- **Automated CI Suite**: ≥50 adversarial prompts (misspellings, transliterations, honorary titles, paraphrases, code-switching)
- **False-Negative Target**: Zero on maintained adversarial suite + **mandatory human review** of all `FLAGGED(sacred_entity)`
- **False-Positive Runbook**: 4h T&S SLA; triage match context + audit history; temp allowlist (TTL 7d) + negative example to adversarial suite
- **Denylist Management**: Monthly updates by T&S; quarterly scholar review; immutable audit log (`sacred_entity_audit`)

### 4.4 Content Moderation APIs (Industry Standard)

| API / Tool | Capabilities | Notes |
|------------|--------------|-------|
| **Perspective API** (Google) | NSFW, hate speech, harassment, toxicity | Free tier; confidence scores |
| **Detoxify** (Open-source) | Toxicity, severe toxicity, obscenity, identity attack, insult, threat | Local deployment; PyTorch |
| **AWS Comprehend** | PII, sentiment, syntax, entities, custom classification | Managed; pay-per-use |
| **Azure Content Moderator** | Text, image, video moderation; custom term lists | Deprecated → Azure AI Content Safety |
| **Azure AI Content Safety** | Hate, sexual, violence, self-harm; prompt shields | Current Microsoft offering |

**Prompt Injection Defense** (from `specs.md`):
- User fields sanitized: allowlist `[a-zA-Z0-9_.]{1,32}`, HTML-escaped
- **Compiled prompt** (not raw fields) scanned by Moderation + Sacred Guard
- Sanitization applied per-field before compilation

---

## 5. Cost Guard & Budget Management

### 5.1 Patterns from Industry (FinOps for Generative AI)

| Practice | Description |
|----------|-------------|
| **Committed-Spend Tracking** | Projected total = actual + queued estimates + new estimate |
| **Cost Drift Detection** | Overrun_ratio = (actual - estimate) / estimate; alert if > 50% or rolling 10-shot avg > 20% |
| **Per-Story Budget Caps** | Overrideable per-story; default from subscription tier |
| **Token-Based Rate Limiting** | Redis token bucket per model (capacity = rate/min, refill = rate/sec) |
| **FinOps Tooling** | CloudZero, AWS Bedrock cost tracking, CostGuard, custom dashboards |

### 5.2 Video Generation Cost Estimates (from `specs.md`)

| Model | Cost (USD/s of video) | Notes |
|-------|----------------------|-------|
| Veo 3 | 0.10 | High realism, good lip-sync |
| Kling | 0.07 | Strong motion coherence |
| Runway | 0.09 | Good stylization controls |
| Sora | 0.12 | State-of-the-art coherence |
| Wan (local) | 0.04 (amortized) | GPU-dependent; fully private |

---

## 6. Webhook Reliability & Idempotency

### 6.1 Established Patterns

| Pattern | Implementation |
|---------|----------------|
| **HMAC-SHA256 Verification** | `X-Signature = HMAC(secret, body)`; reject invalid |
| **Timestamp Skew Check** | `X-Timestamp`; reject if `abs(now - ts) > 300s` |
| **Idempotency Keys** | `X-Idempotency-Key = {job_id}:{provider}`; `SET NX EX 300` in Redis |
| **Secret Rotation** | Two active HMAC secrets; `kid` header selects key |
| **Fallback Polling** | Watchdog scans stale jobs (status=GENERATING, updated_at > expected×1.5); polls provider status API |
| **At-Least-Once Delivery** | Consumer groups + explicit XACK; unacked redelivered after timeout |

### 6.2 Queue Semantics (from `specs.md`)

- **Redis Streams** with consumer groups per service
- **Poison message handling**: max_retries=3 → dead-letter stream
- **Retry queue**: exponential backoff (1s, 4s, 16s) via sorted-set scheduler
- **DLQ reprocessing**: admin endpoint for manual replay after root-cause fix

---

## 7. User Workflows & Domain Knowledge

### 7.1 Core Workflows (from `specs.md`)

1. **Story Creation**: Upload script (text/audio/mixed) → configure budget/continuity → QUEUED
2. **Face/Voice Enrollment**: Upload photo/audio → liveness check → embedding extraction → encrypted storage
3. **Shot Generation**: Scene Planner → Prompt Compiler → Admission Controller → AUTO Router → Model Adapter
4. **Verification**: Post-gen face/voice similarity check → Sacred visual audit → Flag or COMPLETED
5. **Merge & Delivery**: Video Merger → Post-Production (transitions, audio mix, color grading, subtitles) → READY_FOR_REVIEW
6. **Human Review**: User/admin reviews flagged items → APPROVED / NEEDS_EDIT / REJECTED

### 7.2 Escalation Model

- **Face-Lock mismatch** → REVIEW (user can accept, regenerate, or update reference)
- **Sacred entity flag** → Mandatory human review before release
- **Cost overrun** → COST_OVERRUN_PAUSE → Admin/user action required (increase budget or cancel)
- **Voice drift** → REVIEW (similar to face-lock)

### 7.3 Privacy / GDPR (from `specs.md`)

- Biometric data encrypted at rest (Vault Transit KEK 90-day rotation → per-user DEK AES-256-GCM)
- Raw face image deleted immediately after embedding + liveness pass
- Presigned S3 URLs (PUT 5m, GET 15m); bucket denies non-presigned
- Right-to-be-forgotten: crypto-shred DEK + delete rows + S3 lifecycle
- Audit logs immutable (WORM); 7-year retention

---

## 8. Constraints & Risks

### 8.1 Technical Constraints

| Constraint | Impact |
|------------|--------|
| **Model API Access** | Veo 3, Kling, Runway, Sora require approved API access; not universally available |
| **Pricing Opacity** | Most providers don't publish per-second pricing; estimates may drift |
| **Latency Variance** | Sora: "several minutes"; Wan: ~4min/5s@4090; affects admission/queue positioning |
| **Face Conditioning Gaps** | Veo 3/Sora verify-only → higher regeneration rates; Sora blocks human faces by default |
| **Local Model Hardware** | Wan 14B needs significant VRAM; multi-GPU setup adds complexity |

### 8.2 Regulatory / Compliance Risks

| Risk | Mitigation |
|------|------------|
| **Biometric Data (GDPR/CCPA)** | Encryption, crypto-shred, 30-day raw retention, access logging |
| **Sacred Entity Liability** | Multi-stage enforcement + mandatory human review + adversarial testing |
| **Copyright/Deepfake** | SynthID (Veo), C2PA (Runway), copyrighted character rejection (Sora) |
| **CSAM/Child Safety** | Moderation pre-check; content suitable for under-18 only (Sora) |

### 8.3 Operational Risks

| Risk | Mitigation |
|------|------------|
| **Model Provider Outage** | AUTO Router fallback; queued-only mode if all degraded |
| **Cost Overrun** | Committed-spend guard + drift detection + hard pause |
| **Webhook Failures** | Idempotency + 30s watchdog polling + DLQ |
| **Face-Lock Fairness** | Demographic-slice histogram monitoring; fairness delta alerts |

---

## 9. Failure Modes

| Failure Mode | Detection | Recovery |
|--------------|-----------|----------|
| **Transient: Network timeout / HTTP 5xx** | Adapter error codes | Exponential backoff (1s×2^attempt, max 10s), max 3 attempts |
| **Transient: Token exhaustion** | RateLimit FAIL | Wait for refill or re-queue |
| **Permanent: Invalid prompt / Content filter** | Adapter permanent error | Flag shot; route to REVIEW; model swap allowed |
| **Permanent: Face-lock mismatch** | Cosine < threshold | FLAGGED(face_lock) → REVIEW; user override or regenerate |
| **Permanent: Sacred entity hit** | Denylist match (any stage) | FLAGGED(sacred_entity) → Mandatory human review |
| **Cost Overrun** | Projected > budget_cap | COST_OVERRUN_PAUSE → Admin/user action |
| **Webhook Lost** | Watchdog detects stale GENERATING | Poll provider API or retry per transient logic |
| **Model Deprecation** | Provider announces sunset | Adapter versioning; router excludes deprecated |

---

## 10. Alternative Approaches & Trade-offs

### 10.1 Model Selection Strategy

| Approach | Pros | Cons |
|----------|------|------|
| **AUTO Router (score-based)** | Optimises realism/cost/latency dynamically | Requires realism cache maintenance; complexity |
| **User-Pinned Model** | Predictable behaviour; user control | May miss better/cheaper options |
| **Tier-Based Fixed Model** | Simple; predictable cost | Inflexible; can't optimise per-shot |

### 10.2 Face-Lock Implementation

| Approach | Pros | Cons |
|----------|------|------|
| **Per-Adapter Conditioning (current)** | Best quality per model capability | Complex adapter implementations; verify-only models weaker |
| **Unified Post-Gen Only** | Simpler adapters; consistent verification | Higher regeneration rate; worse UX for verify-only models |
| **Single Model Lock-in** | Simpler pipeline | Vendor lock-in; no cost/quality optimisation |

### 10.3 Sacred Entity Enforcement

| Approach | Pros | Cons |
|----------|------|------|
| **Multi-Stage + Visual Audit (current)** | Defense in depth; catches implied identity | Higher latency; visual audit compute cost |
| **Text-Only Denylist** | Fast; simple | Misses visual/silhouette depictions |
| **External Moderation Only** | Offloads liability | Less control; API dependency; latency |

### 10.4 System of Record

| Approach | Pros | Cons |
|----------|------|------|
| **Postgres + pgvector (default)** | Unified; ACID; vector+full-text+queues; mature | Scaling vector search at very high scale |
| **Postgres + Redis Streams + S3** | Separation of concerns; Redis for hot queues | More moving parts; consistency complexity |
| **Specialized Vector DB (Pinecone, Weaviate)** | Optimised ANN search | Additional infra; cost; sync complexity |

---

## 11. Unknowns & Open Questions

| # | Question | Priority |
|---|----------|----------|
| **U1** | What are the actual per-second API pricing for Veo 3, Kling, Runway, Sora in 2025–2026? | High — affects cost guard accuracy |
| **U2** | What are the SLA/latency guarantees (p50/p95/p99) for each provider's async API? | High — affects admission/queue positioning |
| **U3** | Does Sora's "human-likeness access" program allow face-lock for user-uploaded photos? | Critical — blocks Face-Lock for Sora if not |
| **U4** | What is the actual face verification FPR/FNR for ArcFace 0.45 threshold on diverse demographics? | High — fairness compliance |
| **U5** | Can Wan 2.1 be integrated with IP-Adapter-FaceID / InstantID via Diffusers reliably in production? | Medium — local model path |
| **U6** | What are the rate limits (requests/min, concurrent jobs) for each provider's API? | High — admission controller config |
| **U7** | How does Veo 3.1 "Ingredients to Video" perform for face consistency vs. IP-Adapter? | Medium — model comparison |
| **U8** | What is the compute cost (GPU-hours) for Wan 14B 720p generation at scale? | Medium — local vs. cloud cost trade-off |
| **U9** | Are there legal precedents for sacred entity depiction liability in generated video? | High — compliance risk |
| **U10** | Can Prometheus/Grafana histogram-based threshold tuning run fully automated? | Medium — ops maturity |

---

## 12. Assumptions

| # | Assumption | Rationale |
|---|------------|-----------|
| **A1** | All 5 target models (Veo 3, Kling, Runway, Sora, Wan) will have production APIs available by build time. | Based on current public preview / launch status |
| **A2** | Postgres + pgvector + Redis Streams + S3/MinIO is sufficient for projected scale (≤1000 concurrent stories). | Per `specs.md` architecture; aligned with Constitution §16 |
| **A3** | ArcFace 512-dim embeddings with 0.45 threshold is an acceptable starting point for face-lock. | Per `specs.md`; industry standard for verification |
| **A4** | Sacred entity denylist maintained by Trust & Safety team with scholar review is sufficient for compliance. | Per `specs.md` governance model |
| **A5** | Human review queue for flagged items (sacred, face-lock, voice drift) will have ≤4h SLA. | Per `specs.md` runbook |
| **A6** | Cost estimates within ±10% accuracy are achievable via provider estimates + historical calibration. | Per `specs.md` benchmarks |
| **A7** | Webhook fallback polling every 30s with 1.5× expected duration threshold catches >95% of missed callbacks. | Per `specs.md` watchdog design |
| **A8** | User-provided face images will pass liveness detection (≥0.8) in >90% of genuine cases. | Standard anti-spoofing model performance |
| **A9** | Video merger (FFmpeg concat + re-encode) produces acceptable quality for 10-shot stories. | Standard post-production practice |
| **A10** | Subscription tiers (Basic/Pro/Enterprise) with max_concurrent_stories will be defined before Phase 3. | Required for Order Guard |

---

## 13. Recommendations

### 13.1 For Specification (Phase 3)

1. **Explicit Model API Requirements**: Document required API capabilities per model (auth, rate limits, webhook format, face conditioning endpoints) as non-functional requirements.

2. **Sacred Entity Visual Audit Spec**: Define the image classifier requirements (model, threshold, latency budget, false positive target) as a functional requirement — not just implementation detail.

3. **Face-Lock Threshold Policy**: Specify the threshold tuning process (weekly batch, FPR target, fairness guard, user override precedence) as behavioural requirements.

4. **Human Review Queue SLA**: Define review queue behaviour (priority ordering, SLA escalation, auto-expiry) as functional requirements.

5. **Cost Drift Calculations**: Specify the exact formulae for `overrun_ratio` and rolling average as deterministic behavioural rules.

### 13.2 For Architecture Decisions (Post-Spec)

1. **Model Adapter SDK**: Build a thin wrapper library per model to normalise submit/poll/retrieve/estimateCost — reduces orchestrator coupling.

2. **Realism Cache Service**: Separate nightly batch job that updates `model_realism_cache` from user ratings/watch-time; expose via simple HTTP config.

3. **Denylist Cache Invalidation**: Use Redis Pub/Sub on `sacred_entity_audit` writes to invalidate cache instantly across instances.

4. **Observability-First**: Every shot log must include `trace_id`, `story_id`, `shot_id`, `model`, `face_sim_score`, `sacred_check_result`, `cost_estimate_usd`, `cost_actual_usd`.

### 13.3 For Risk Mitigation

1. **Provider Diversification**: Ensure ≥3 models are production-ready before launch; never single-source.

2. **Sora Human-Likeness Access**: Apply early for Sora human-likeness program if Face-Lock on Sora is required.

3. **Wan 2.1 + IP-Adapter Prototype**: Validate local face conditioning path before committing to it in spec.

4. **Fairness Baseline**: Run ArcFace threshold evaluation on RFW or equivalent balanced dataset before lock-in.

---

## Sources

| # | Source | Type | Accessed |
|---|--------|------|----------|
| S1 | Panaversity Thesis | Documentation | 2026-08-05 |
| S2 | Panaversity Agentic Coding Crash Course | Documentation | 2026-08-05 |
| S3 | Panaversity Problem-Solving Crash Course | Documentation | 2026-08-05 |
| S4 | Panaversity Spec-Driven Development Crash Course | Documentation | 2026-08-05 |
| S5 | `specs.md` (AI Story Video Agent v5) | Domain Knowledge | 2026-08-05 |
| S6 | Google DeepMind Veo 3/3.1 Page | Web | 2026-08-05 |
| S7 | Google Developers Blog: Veo 3.1 | Web | 2026-08-05 |
| S8 | Kling.art Model Page | Web | 2026-08-05 |
| S9 | Runway Gen-3 Alpha Research Page | Web | 2026-08-05 |
| S10 | OpenAI Sora Documentation (API Guide) | Web | 2026-08-05 |
| S11 | Wan 2.1 GitHub Repository | Web | 2026-08-05 |
| S12 | IP-Adapter Official Site | Web | 2026-08-05 |
| S13 | InstantID Official Site | Web | 2026-08-05 |
| S14 | CloudZero AI Cost Guardrails Blog | Web | 2026-08-05 |

---

*End of Research Findings*