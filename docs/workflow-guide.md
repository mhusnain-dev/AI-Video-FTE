# AI Video Production Specialist — Workflow Guide

> **Audience**: Principals, operators, and developers who want to understand *how this Digital FTE
> behaves*, what it needs to run, how it orchestrates its workers, and how a story brief becomes a
> delivered video.
>
> **Source of truth**: Every claim below is grounded in the repository source
> (`src/`, `config/`, `specs/ai-video-fte/spec.md`). File references use `path:symbol` so you can
> verify each statement. This guide describes the system **as built**, and flags the one place where
> the *intended* secure design differs from current code (API-key storage).

A colorful, pictorial version of this same content is rendered to
[`workflow-guide.pdf`](./workflow-guide.pdf).

---

## 1. What This FTE Is

| Attribute | Value | Source |
|-----------|-------|--------|
| **Title** | AI Video Production Specialist | `specs/ai-video-fte/spec.md` §2 |
| **Core responsibility** | End-to-end video production from story concept to final merged video | spec §2 |
| **Autonomy** | Accepts a story brief, then independently plans shots, selects models, generates, verifies, and merges | spec §2 |
| **Escalates only on** | Policy violations (Sacred Guard), budget overruns (Cost Guard), or unrecoverable technical failures | spec §2 |
| **Non-goals** | Does not replace creative direction, does not host/stream video (delivers downloadable assets), does not manage accounts/billing | spec §2 |

The Principal (human) sets intent and approves the shot plan; the FTE executes everything between
approval and delivery without further intervention unless a guard trips.

---

## 2. The One-Screen Mental Model

```
   YOU (Principal)                    THE FTE (autonomous orchestrator)                EXTERNAL
   ─────────────                      ──────────────────────────────────              ────────
   story brief  ───────────────────▶  plan shots ─▶ you approve                        Video model
   (text + optional                        │                                           providers
    character photos)                       ▼                                           (Veo 3,
                                       per shot:  admission ─▶ dispatch  ───────────▶   Runway, …)
   final video  ◀───────────────────  merge + audio + subtitles ◀── verify ◀── webhook  ElevenLabs
   (downloadable)                                                                       (voice+music)
```

The FTE is a single Node/TypeScript service (`src/`) that runs **two HTTP servers** and a set of
**background workers**:

| Surface | Port | Set by | Source |
|---------|------|--------|--------|
| **API server** (stories, admission, router, dispatch, merger, health) | `3000` | `API_PORT` env, default 3000 | `src/server.ts:startHttpServer` |
| **Metrics server** (Prometheus `/metrics`) | `9090` | `config.observability.metricsPort` | `src/server.ts` |

---

## 3. What You Must Supply — API Keys & Why

The FTE cannot generate pixels or audio by itself. It **orchestrates external generative providers**,
and those calls are authenticated with API keys. Two categories of key exist:

### 3.1 Video generation keys (mandatory for real output)

| Provider | Purpose | Env var read by code | Config field |
|----------|---------|----------------------|--------------|
| **Veo 3** | Ultra-realistic text-to-video generation | `VEO_API_KEY` | `veoApiKey` |
| **Runway Gen-3** | Alternative / fallback video model | `RUNWAY_API_KEY` | `runwayApiKey` |
| Luma Ray 2, Pika, Kling | Additional models (pluggable adapters) | — | model registry |

Grounding: `src/shared/config.ts:getEnvOverrides` maps `VEO_API_KEY → veoApiKey` and
`RUNWAY_API_KEY → runwayApiKey`. The configured models and their per-second costs live in
`config/development.yaml` (`veo3-low` $0, `veo3-high` $0.05/s, `runway-gen3` $0.08/s,
`luma-ray2` $0.03/s).

Without a valid video key, adapters cannot dispatch shots — there is no local fallback that produces
ultra-realistic footage. **A video-model key is required for any real render.**

### 3.2 Audio / voice keys (mandatory for voice & music)

| Provider | Purpose | Env var read by code |
|----------|---------|----------------------|
| **ElevenLabs** | Text-to-speech voice-over **and** background music library | `ELEVENLABS_API_KEY` |

Grounding: `src/merger/merger.ts:generateTTSAudio` uses
`(config as any).elevenlabsApiKey || process.env.ELEVENLABS_API_KEY` and **throws if it is not
configured**. So: *if a story requests voice-over or ElevenLabs music, the ElevenLabs key is
mandatory* — the merge step fails without it. A silent (no-audio) video does not require it.

**Music has three sources, not just ElevenLabs.** `MusicConfig.source`
(`src/shared/types.ts:438`) is `'royalty_free' | 'elevenlabs' | 'custom'`, per spec **FR-028** and
clarification **CL-022**:

| Music source | What it is | Needs a key? |
|--------------|-----------|--------------|
| `royalty_free` | Built-in integrated royalty-free library for background music | No per-track key |
| `elevenlabs` | ElevenLabs music library | Yes — `ELEVENLABS_API_KEY` |
| `custom` | User overrides with their own audio assets (`customAudioAssets`) | No |

Audio precedence (FR-028): native model audio is **preserved** if the model emits it; otherwise the
FTE generates TTS voice-over (ElevenLabs) and applies background music from the source above. The
music fetcher `getMusicTrack()` (`src/merger/merger.ts:280`) is currently a **placeholder stub**
(logs *"Would fetch track … from &lt;source&gt;"* and returns `music_placeholder.mp3`); wiring it to
the real royalty-free/ElevenLabs libraries is a Build task.

### 3.3 Where keys are stored — `.env`, `.gitignore`, and Vault

This is the exact question "how is `.env` in `.gitignore`, how do we add API keys now?" answered
factually.

**Fact 1 — `.env` is git-ignored.** `.gitignore` lines 10–13 ignore `.env`, `.env.local`,
`.env.*.local`; line 41 ignores `.vault-token`. So secrets never get committed. This is why you
cannot just "commit an `.env`" — and shouldn't.

**Fact 2 — what the code reads today.** `src/shared/config.ts:getEnvOverrides` reads the provider
keys **directly from `process.env`** (`VEO_API_KEY`, `RUNWAY_API_KEY`, `ELEVENLABS_API_KEY`) plus
Vault connection settings (`VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_TRANSIT_KEY`). So the *working*
mechanism today is environment variables, typically loaded from a local `.env` that stays on the
machine and out of git.

**Fact 3 — the intended secure store is Vault.** `CLAUDE.md` §14 and §16 require secrets in Vault,
not the repo, and `src/shared/vault.ts` implements HashiCorp Vault Transit envelope encryption
(DEK/KEK, AES-256-GCM) used elsewhere for biometric data. The documented secure design is:
put provider keys in Vault, keep only the **Vault connection credentials** in `.env`.

**How to add keys now (practical, matches the code):**

```
┌─ 1. Create a local .env (git-ignored) ───────────────────────────┐
│  VEO_API_KEY=veo_live_xxx          # video generation            │
│  RUNWAY_API_KEY=rw_xxx             # fallback video              │
│  ELEVENLABS_API_KEY=el_xxx         # voice + music (mandatory    │
│                                    #   if the story has audio)   │
│  VAULT_ADDR=http://127.0.0.1:8200  # Vault connection only       │
│  VAULT_TOKEN=hvs.xxx                                             │
│  VAULT_TRANSIT_KEY=biometric-encryption-dev                     │
└──────────────────────────────────────────────────────────────────┘
        │  process.env  ▼
   src/shared/config.ts:getEnvOverrides()  ── merges env over config/{NODE_ENV}.yaml
        │
        ▼  adapters + merger read config.veoApiKey / config.elevenlabsApiKey
```

> **The honest caveat**: today the provider keys flow through `process.env`. Storing the *provider*
> keys inside Vault (rather than only Vault's own connection creds) is the documented target
> (`CLAUDE.md` §16); wiring `config.ts` to fetch provider keys from Vault at runtime would be a Build
> task, not something the current code already does. This guide states what *is* and what *should be*
> separately, on purpose.

---

## 4. How the FTE Orchestrates — Streams, Groups, and Workers

The FTE is **event-driven**. Every state change is written to PostgreSQL (durable, immutable) *and*
published to a Redis Stream (real-time). Background workers consume those streams. This is the
"how it controls its workers" answer.

### 4.1 The four durable streams

Grounding: `src/shared/redis.ts` `STREAMS`.

| Stream | Carries | Producer |
|--------|---------|----------|
| `story_commands` | create / approve / revise / cancel / regenerate_shots | API (`publishStoryCommand`) |
| `story_events` | every story/shot state change (immutable event log) | state machines (`publishStoryEvent`) |
| `webhook_ingress` | provider callbacks (shot done/failed) | webhook endpoint (`publishWebhookIngress`) |
| `job_status` | queued / processing / completed / failed / timeout | dispatch + timeout mgr (`publishJobStatus`) |

### 4.2 The eight consumer groups

Grounding: `src/shared/redis.ts` `CONSUMER_GROUPS`. Consumer groups give **at-least-once, no-double-
processing** delivery — each message goes to exactly one consumer in the group, with `XACK` on
success and `XAUTOCLAIM` to recover stalled work (`claimStalledMessages`).

```
command-handler   event-processor   webhook-handler   job-monitor
metrics-aggregator   alert-evaluator   audit-archiver   dashboard-updater
```

### 4.3 The workers the FTE controls

These are **Redis Stream consumers**, not chat sub-agents — the FTE controls them by (a) creating
them, (b) health-checking them, (c) restarting them, and (d) gracefully shutting them down. The
controller is `ConsumerManager`.

| Worker (Phase 7) | Reads | Does | Source |
|------------------|-------|------|--------|
| **MetricsAggregator** | `story_events` | Rolls raw events into metrics | `src/consumers/metricsAggregator.ts` |
| **AlertEvaluator** | `story_events` | Evaluates alert rules, fires webhooks (dedup window) | `src/consumers/alertEvaluator.ts` |
| **AuditArchiver** | `story_events` | Batches events to durable archive (local/S3/GCS, gzip) | `src/consumers/auditArchiver.ts` |
| **DashboardUpdater** | `story_events` | Refreshes materialized views for dashboards | `src/consumers/dashboardUpdater.ts` |

**How the FTE controls them** — `src/consumers/consumerManager.ts`:

- **Create/start** — `ConsumerManager.start()` instantiates each worker with a unique consumer name
  and calls `consumer.start()`; failure to start aborts startup.
- **Health-check** — `startHealthChecks()` runs every **30s** (`healthCheckIntervalMs`), marking a
  worker `degraded` if failure rate > 10% after 100 messages, and persisting a row into
  `health_metrics`.
- **Restart** — `restartConsumer(name)` stops then starts a single worker without touching the rest.
- **Graceful shutdown** — `stop()` races each `consumer.stop()` against a 30s timeout; SIGTERM/SIGINT
  are wired via `setupSignalHandlers()`.

### 4.4 The pipeline "brain" — state machines

Grounding: `src/shared/events.ts`.

The FTE's decision logic is two explicit **finite state machines**:

- `storyStateMachine` — `STORY_TRANSITIONS`: `draft → planning → awaiting_approval → approved →
  in_progress → generating → merging → completed`, plus guarded pauses
  (`paused_cost`, `paused_rate_limit`, `paused_sacred_guard`) and `failed` / `cancelled`.
- `shotStateMachine` — `SHOT_TRANSITIONS`: `planned → awaiting_approval → approved → in_admission →
  admission_passed → dispatched → generating → completed`, with `failed`, `timeout → dispatched`
  (fallback), and `cancelled`.

Every transition runs guards + side-effects, then emits an immutable event to Postgres **and** Redis.
One side-effect worth noting: `generating → merging` triggers `generateCrossShotConsistencyReport`
(the cross-shot Face-Lock report) automatically.

---

## 5. The Complete Workflow, Step by Step

### 5.1 Admission — the mandatory gate (before any dispatch)

Grounding: `src/admission/admissionController.ts:runAdmissionPipeline`, spec FR-009.

Every shot passes a **fixed, immutable order**. The order never changes:

```
   ┌────────────┐   ┌──────────────┐   ┌────────────┐   ┌─────────────┐
──▶│ 1.Moderation│─▶│2.Sacred Guard│─▶│3.Cost Guard │─▶│4.Rate Limit │─▶ dispatch
   └─────┬──────┘   └──────┬───────┘   └─────┬──────┘   └──────┬──────┘
      block on          block on          pause on          hold on
   policy category   sacred match      budget overrun    limit exceeded
```

- **Moderation** — violence / sexual / hate / PII / CSAM → categorized block.
- **Sacred Guard** — exact + transliterated + fuzzy + visual/semantic match against protected
  personalities; **five enforcement points** (story create, character upload, pre-moderation,
  pre-dispatch, post-generation audit). Any match blocks. This ordering is a spec invariant and must
  survive verbatim.
- **Cost Guard** — estimated shot cost vs remaining budget / project ceiling → pause with options.
- **Rate Limit** — per-model / per-user / global limits → hold with estimated wait.

A block flips the story into the matching `paused_*` state; the Principal decides disposition.

### 5.2 Dispatch, generation, and automatic fallback

Grounding: `src/dispatch/shotDispatcher.ts`.

```
approved shot
   │
   ▼ runAdmissionPipeline() ── fail ─▶ paused_* (escalate)
   │ pass
   ▼ getAdapter(model.id).dispatch(compiledPrompt)   ── provider request id
   │
   ▼ shot: dispatched ─▶ generating       startDispatchTimeout(...)
   │                                             │ no webhook in time
   │  provider webhook (async) ◀── ── ──         ▼
   ▼                                       fallback to next model
completed (or) timeout ─▶ re-dispatched   (Face-Lock conditioning preserved)
```

- **No duplicate dispatch** — `isShotDispatched()` guards against re-sending a shot already
  `dispatched/generating/completed`.
- **Fallback** — `dispatchWithFallback()` tries the primary model, then each eligible fallback in
  priority order, **re-compiling the prompt with the same character conditioning** so Face-Lock
  survives the model switch.
- **Async recovery** — timeouts move a shot `timeout → dispatched` (`SHOT_TRANSITIONS`), so a lost
  provider callback never strands a shot or double-charges.

### 5.3 Face-Lock — identity consistency

Grounding: `src/verification/faceLockVerification.ts`, `src/generation/promptCompiler.ts`.

- **Conditioning** — each character's reference image is injected per-model into the compiled prompt.
- **Post-generation verification** — generated frames are compared (cosine similarity) against the
  registry; below threshold ⇒ auto-regeneration (default 2 retries).
- **Cross-shot report** — on `generating → merging`, a consistency report across every shot is
  generated automatically (`events.ts` side-effect).

### 5.4 Merge, audio, subtitles, delivery

Grounding: `src/merger/merger.ts`.

- **Merge** — `mergeStoryShots()` orders completed shots, builds an FFmpeg filter graph, and
  `executeMerge()` runs FFmpeg (`libx264 -crf 23`, `aac 128k`, `+faststart`).
- **Audio** — three layers: (1) the model's **native audio** is preserved when the model emits it
  (`GenerationResult.nativeAudioUrl`, `types.ts:407`); (2) **voice-over** via `generateTTSAudio()` →
  ElevenLabs (key mandatory, §3.2); (3) **music** via `getMusicTrack()` (`merger.ts:280`), whose source
  is one of `royalty_free` | `elevenlabs` | `custom` (`MusicConfig.source`, `types.ts:439`). `getMusicTrack()`
  is a placeholder stub today — the royalty-free library selector is not yet wired.
- **Subtitles** — SRT (default), VTT, or ASS (`generateSRTContent` / `…VTT…` / `…ASS…`).
- **Delivery** — `generateDeliveryPackage()` produces a signed URL (7-day TTL), cost summary, logs,
  and verification reports.

---

## 6. Transitions — Who Generates Them vs Who Applies Them

> This section answers the explicit requirement: **in the workflow tree, show who *generates*
> transitions and who *applies* them in the video.** These are two different components.

**Key fact: transitions are NOT AI-generated.** They are a fixed catalog of **pre-defined FFmpeg
`xfade` presets** — no model, no LLM, no per-story creativity. The FTE picks one and FFmpeg renders it.

```
                         ┌───────────────────────────────────────────────┐
   GENERATE (define)     │  src/merger/transitionSystem.ts               │
   ──────────────────    │  • TRANSITION_PRESETS: 21 hardcoded presets   │
   The catalog of        │    crossfade(default,0.5s→'fade'), slide,     │
   transitions is        │    slideLeft/Right/Up/Down, zoom/In/Out,      │
   DEFINED here as        │    wipe/Right/Up/Down, circleOpen/Close,       │
   static FFmpeg presets  │    pixelize, hlSlice, vlSlice, distance, smooth│
   (not produced by AI). │  • buildTransitionFilter() → xfade filter str │
                         │  • buildMergeFiltersWithTransitions() → graph  │
                         └───────────────────────┬───────────────────────┘
                                                 │ filter graph string
                                                 ▼
                         ┌───────────────────────────────────────────────┐
   APPLY (render)        │  src/merger/merger.ts                         │
   ──────────────────    │  • mergeStoryShots() picks transition:        │
   The transition is      │      options.transition || config.merger      │
   APPLIED to the video   │      .defaultTransition (crossfade 0.5s)       │
   here, by FFmpeg, when  │  • buildMergeFilterComplex() assembles it     │
   shots are merged.     │  • executeMerge() spawns FFmpeg → xfade runs  │
                         │    between each adjacent pair of shots         │
                         └───────────────────────────────────────────────┘
```

Details:

- **Default** — `crossfade`, `0.5s` (`config/development.yaml` `merger.defaultTransition`;
  preset `crossfade → ffmpegTransition 'fade'`).
- **Per-shot override** — `mergeTransitionConfigs(global, shot)` lets a shot override the global
  transition; shot wins, else global, else crossfade 0.5s.
- **Offset math** — for adjacent shots, `offset = max(0, prevDuration − transitionDuration)`
  (`buildMergeFiltersWithTransitions`).
- **So, in one line**: `transitionSystem.ts` **generates/defines** the transition filter;
  `merger.ts` **applies** it to the actual video via FFmpeg.

---

## 7. Result Generation Tree — What Is Produced, By Whom, and How It Merges

This is the "tree showing how each result is generated, merged, and who runs it" view. Each leaf
names the **component that runs it**.

```
STORY BRIEF (you)
│
├─ PLAN ───────────────── storyService / promptCompiler ─▶ shot list ─▶ YOU APPROVE
│
├─ PER SHOT (repeated, concurrent) ───────────────────────────────────────────────
│   │
│   ├─ ADMISSION ───────── admissionController ─▶ Moderation▸SacredGuard▸Cost▸Rate
│   │
│   ├─ DISPATCH ────────── shotDispatcher + autoRouter ─▶ model adapter (Veo3/Runway)
│   │     └─ on timeout ── timeoutManager ─▶ dispatchWithFallback ─▶ next model
│   │
│   ├─ GENERATE ────────── EXTERNAL provider ─▶ webhook ─▶ webhookHandler
│   │
│   └─ VERIFY (Face-Lock)  faceLockVerification ─▶ pass │ fail ─▶ auto-regenerate (×2)
│
├─ CROSS-SHOT REPORT ───── events.ts side-effect on generating→merging
│
├─ MERGE ─────────────────────────────────────────────────────────────────────────
│   │
│   ├─ TRANSITIONS: define ▶ transitionSystem.ts   apply ▶ merger.ts (FFmpeg xfade)
│   ├─ VIDEO: merger.executeMerge ─▶ FFmpeg (libx264 crf23, aac128k, +faststart)
│   ├─ AUDIO/VOICE: merger.generateTTSAudio ─▶ ElevenLabs (key required)
│   ├─ MUSIC: merger.getMusicTrack ─▶ royalty_free | elevenlabs | custom (stub today)
│   └─ SUBTITLES: merger.generateSRT/VTT/ASSContent ─▶ SRT default
│
└─ DELIVER ─────────────── merger.generateDeliveryPackage
        ├─ final video (downloadable, signed URL, 7-day TTL)
        ├─ cost summary
        ├─ verification reports (Face-Lock, cross-shot)
        ├─ subtitles
        └─ logs
```

**Who runs what (quick map):**

| Result | Produced by | Merged/assembled by |
|--------|-------------|---------------------|
| Shot plan | `storyService` + `promptCompiler` | — (you approve) |
| Individual shot video | External model via `modelAdapter` | — |
| Identity consistency | `faceLockVerification` | cross-shot report on merge |
| Transition **definition** | `transitionSystem.ts` (presets) | — |
| Transition **applied in video** | — | `merger.ts` via FFmpeg `xfade` |
| Voice-over | ElevenLabs via `merger.generateTTSAudio` | muxed by FFmpeg in `executeMerge` |
| Music | `merger.getMusicTrack` — `royalty_free` \| `elevenlabs` \| `custom` (stub today) | muxed by FFmpeg in `executeMerge` |
| Subtitles | `merger.generate{SRT,VTT,ASS}Content` | packaged in delivery |
| Final video + package | — | `merger.generateDeliveryPackage` |

---

## 8. How To Use It — Operator Flow

> Endpoints are grounded in `src/server.ts` route mounts (`/stories`, `/admission`, `/router`,
> `/dispatch`, `/merger`, `/health`, `/metrics`). Exact request bodies live in each module's
> `routes.ts`; treat the shapes below as the shape of the flow, not a frozen contract.

1. **Provide keys** — set `VEO_API_KEY` (and/or `RUNWAY_API_KEY`) and, if the story has audio,
   `ELEVENLABS_API_KEY`, plus the Vault connection vars (§3.3).
2. **Submit a story** — `POST /stories` with narrative text, target duration, aspect ratio
   (16:9 default; 9:16, 1:1, 4:5 supported), optional character reference images.
3. **Review the plan** — the FTE decomposes into shots and presents them (`awaiting_approval`).
4. **Approve (or revise)** — approval moves the story to `approved` and generation begins.
5. **Watch progress** — poll story status or watch Grafana dashboards fed by the consumer workers;
   metrics at `:9090/metrics`.
6. **Handle escalations** — if a guard trips (`paused_cost`, `paused_rate_limit`,
   `paused_sacred_guard`), choose: reduce scope, raise budget, or cancel.
7. **Collect delivery** — on `completed`, fetch the delivery package (signed URL, 7-day TTL).
8. **Partial regeneration (optional)** — request re-gen of specific shots; only those are redone,
   Face-Lock re-verified, and the video re-merged (`merger.partialRegenerate`).

---

## 9. How It Behaves — What To Expect

| Situation | Behavior | Grounding |
|-----------|----------|-----------|
| Sacred personality referenced | Blocked at admission; no generation; clear reason | spec SC-003, FR-011/FR-012 |
| Cost exceeds budget | Pauses **before** dispatch; options presented | spec SC-004, FR-013 |
| Primary model fails/times out | Automatic fallback to next eligible model, no user action | spec SC-005, `dispatchWithFallback` |
| Provider callback lost | Auto-recovery; no duplicate generation or charge | spec SC-008, `timeout→dispatched` |
| Character across many shots | Same identity every shot (Face-Lock verify + regenerate) | spec SC-002 |
| 20+ shot story | Shots generated concurrently; progress reported | spec SC-006 |
| Re-gen 2 shots later | Only those redone; others untouched; re-merged | spec SC-007, `partialRegenerate` |

**Results you get**: a merged, publish-ready downloadable video (MP4, `+faststart`) at the requested
resolution/aspect ratio, plus subtitles, a cost summary, and Face-Lock/cross-shot verification
reports — bundled in a delivery package behind a 7-day signed URL.

---

## 10. Verify These Claims Yourself

| Claim | File |
|-------|------|
| FTE role & autonomy | `specs/ai-video-fte/spec.md` §2 |
| Admission order (fixed) | `src/admission/admissionController.ts` |
| Video keys / env mapping | `src/shared/config.ts` (`getEnvOverrides`) |
| ElevenLabs key mandatory for audio | `src/merger/merger.ts` (`generateTTSAudio`) |
| `.env` git-ignored | `.gitignore` lines 10–13, 41 |
| Vault encryption design | `src/shared/vault.ts`, `CLAUDE.md` §16 |
| Streams & consumer groups | `src/shared/redis.ts` |
| Worker lifecycle control | `src/consumers/consumerManager.ts` |
| State machines | `src/shared/events.ts` |
| Dispatch & fallback | `src/dispatch/shotDispatcher.ts` |
| Transitions **defined** | `src/merger/transitionSystem.ts` |
| Transitions **applied** | `src/merger/merger.ts` |

---

*Generated for the AI Video Production Specialist Digital FTE. Behaviour-level guide; code is the
build output and the source of truth. Where current code and the intended secure design differ
(provider-key storage, §3.3), both are stated explicitly.*
