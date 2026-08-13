# Phase 7 Observability Integration Map

**Project**: AI Video Production Specialist Digital FTE
**Date**: 2026-08-07
**Phase**: 7 — Observability, Audit & Non-Functional Integration Analysis

---

## Executive Summary

This document maps the integration points for Phase 7 (Observability, Audit & Non-Functional) across all completed phases (0-6). It identifies existing event emission points, database tables requiring audit triggers, Redis Streams consumers for metrics aggregation, health check endpoints needed per service, cross-phase correlation IDs for distributed tracing, and alerting integration points.

---

## 1. Phase 0 (Foundation) — Infrastructure Integration

### 1.1 PostgreSQL Schema Integration Points

| Table | Current Use | Observability Hooks Needed |
|-------|-------------|----------------------------|
| `stories` | Core entity, tracks status, costs | **Metrics**: `story_created_total`, `story_duration_seconds`, `story_cost_usd`<br>**Audit**: All status transitions already in `story_events` |
| `shots` | Shot lifecycle, model assignment | **Metrics**: `shot_generation_latency_seconds`, `shot_fallback_count`, `shot_status_gauge`<br>**Audit**: Admission decisions in `admission_audit`, dispatch in `dispatch_records` |
| `characters` | Character registry, encrypted embeddings | **Metrics**: `character_registered_total`, `character_verification_success_rate`<br>**Audit**: Sacred Guard blocks at registry (already implemented) |
| `story_events` | Immutable event log (state changes) | **Primary observability source** — all state transitions flow here |
| `admission_audit` **IMMUTABLE** | Gate decisions (moderation, sacred, cost, rate) | **Critical for FR-015, FR-032, AC-027** — already append-only via trigger |
| `sacred_denylist` + `sacred_entity_audit` **IMMUTABLE** | Sacred Guard governance | **Audit trail complete** — dual-authorization enforced |
| `cost_records` | Cost attribution (estimated/actual/drift) | **Metrics**: `cost_estimated_usd`, `cost_actual_usd`, `cost_drift_percentage`<br>**Alerting**: Drift alerts already recorded as `cost_type='drift_alert'` |
| `dispatch_records` | Generation dispatch attempts & fallbacks | **Metrics**: `dispatch_attempts_total`, `dispatch_fallback_total`, `dispatch_latency_seconds` |
| `face_lock_verifications` | Verification results per character/shot | **Metrics**: `facelock_verification_total`, `facelock_pass_rate`, `facelock_retry_count` |
| `delivery_packages` | Final delivery artifacts | **Metrics**: `delivery_package_created_total`, `delivery_download_total` |
| `rate_limit_counters` | Sliding window counters | **Metrics**: `rate_limit_usage_gauge`, `rate_limit_exceeded_total` |
| `health_metrics` | Component health snapshots | **Ready for consumer** — populate from health check endpoints |

### 1.2 Redis Streams Integration Points

| Stream | Consumer Group | Events Published | Observability Consumption |
|--------|----------------|------------------|---------------------------|
| `story_commands` | `command-handler` | create, approve, revise, cancel, regenerate_shots | **Metrics**: command throughput, latency |
| `story_events` | `event-processor` | All StateChangeEvent transitions | **Primary observability stream** — all phases emit here |
| `webhook_ingress` | `webhook-handler` | Model provider webhooks | **Metrics**: webhook_received_total, webhook_processing_latency |
| `job_status` | `job-monitor` | queued, processing, completed, failed, timeout | **Metrics**: job_queue_depth, job_duration_seconds |

**Recommended Consumers for Phase 7**:
1. **Metrics Aggregator** — consumes `story_events`, `job_status`, `webhook_ingress` → writes to `health_metrics`, Prometheus
2. **Alert Evaluator** — consumes `story_events` for Sacred Guard blocks, cost drift, rate limit pauses → fires alerts
3. **Audit Archiver** — consumes `story_events` → cold storage (S3/GCS) for 7-year retention (NFR-008)

### 1.3 Vault Transit Integration

- **Key Rotation Metrics**: `vault_dek_rotation_total`, `vault_kek_rotation_total`
- **Encryption/Decryption Latency**: `vault_encrypt_duration_seconds`, `vault_decrypt_duration_seconds`
- **Health Check**: Vault connectivity + Transit key accessibility

### 1.4 Event Bus (`src/shared/events.ts`)

**Already Implemented**:
- `StateChangeEvent` with correlation IDs (event.id)
- Dual persistence: PostgreSQL (`story_events`) + Redis Streams (`story_events`)
- State machines for Story/Shot/Character with guarded transitions
- `emitStoryStateChange`, `emitShotStateChange`, `emitCharacterStateChange`
- Cross-shot consistency report emission (`emitCrossShotConsistencyReport`)

**Phase 7 Hooks Needed**:
- Add `correlationId` field to `StateChangeEvent` for distributed tracing
- Add `traceId` propagation through all async operations
- Structured logging with correlation IDs

---

## 2. Phase 1 (Story Ingestion) — Integration Points

### 2.1 Existing Event Emission Points (`src/ingestion/storyService.ts`)

| Function | State Transition | Event Emitted | correlationId Available |
|----------|------------------|---------------|------------------------|
| `createStory()` | `draft` → `planning` | `decompose_shots` | ❌ (uses random UUID) |
| `presentShotPlan()` | `planning` → `awaiting_approval` | `present_plan` | ❌ |
| `approveShotPlan()` | `awaiting_approval` → `approved` | `user_approve` | ❌ |
| `reviseShotPlan()` | (same state) | `plan_revised` | ❌ |

### 2.2 Character Service Events (`src/ingestion/characterService.ts`)

| Function | Event | Audit Location |
|----------|-------|----------------|
| `uploadCharacterReference()` | `character_registered` | `story_events` + `sacred_entity_audit` (if blocked) |

### 2.3 Metrics Needed

| Metric Name | Type | Labels | Source |
|-------------|------|--------|--------|
| `story_created_total` | Counter | `user_id`, `status` | `createStory()` |
| `story_decomposition_duration_seconds` | Histogram | `shot_count` | `decomposeStoryToShots()` |
| `character_registered_total` | Counter | `story_id`, `has_voice` | `uploadCharacterReference()` |
| `character_sacred_guard_block_total` | Counter | `match_type` | Sacred Guard check |
| `shot_plan_revised_total` | Counter | `action` (add/remove/reorder/edit) | `reviseShotPlan()` |

### 2.4 Health Check Endpoint

```
GET /health/ingestion
Response: {
  status: "healthy|degraded|unhealthy",
  checks: {
    database: { status, latencyMs },
    vault: { status, latencyMs },
    redis: { status, latencyMs }
  },
  metrics: { activeStories, storiesInPlanning, charactersRegistered }
}
```

---

## 3. Phase 2 (Model Selection & Routing) — Integration Points

### 3.1 Existing Event Emission Points (`src/router/autoRouter.ts`)

| Function | Event Location | Data Captured |
|----------|----------------|---------------|
| `selectModelForShot()` | No direct event (called from dispatcher) | Returns `RoutingDecision` |
| `getNextFallback()` | Called from timeout manager | Returns fallback model |
| `recordDispatchAttempt()` | Writes to `dispatch_records` | Already audited |

### 3.2 Model Registry (`src/router/modelRegistry.ts`)

- Registry loaded from config, refreshable
- No events emitted currently

### 3.3 Metrics Needed

| Metric Name | Type | Labels | Source |
|-------------|------|--------|--------|
| `model_selection_total` | Counter | `model_id`, `reason` (override/user_priority/system_default), `is_override` | `selectModelForShot()` |
| `model_eligibility_filtered_total` | Counter | `model_id`, `reason` (resolution/aspect/duration/region/capability) | `checkEligibility()` |
| `model_fallback_total` | Counter | `from_model`, `to_model`, `reason` (timeout/failed) | `getNextFallback()` |
| `model_registry_refresh_total` | Counter | `success` | Registry refresh |

### 3.4 Health Check Endpoint

```
GET /health/router
Response: {
  status: "healthy|degraded|unhealthy",
  checks: {
    registry: { status, modelCount, lastRefreshMs }
  },
  metrics: { eligibleModelsByCapability }
}
```

---

## 4. Phase 3 (Admission Control) — Integration Points

### 4.1 Admission Pipeline — All 5 Gates Event Emission (`src/admission/admissionController.ts`)

| Gate | Function | Event Emitted | Audit Table |
|------|----------|---------------|-------------|
| 1. Moderation | `checkModeration()` → `recordModerationAudit()` | `admission_audit` | ✅ `admission_audit` |
| 2. Sacred Guard | `checkSacredGuard()` → audit INSERT | `admission_audit` + `sacred_entity_audit` (registry) | ✅ `admission_audit` |
| 3. Cost Guard | `checkCostGuard()` → `recordCostGuardAudit()` | `admission_audit` + `cost_records` (estimated) | ✅ both |
| 4. Rate Limit | `checkRateLimit()` → `recordRateLimitAudit()` | `admission_audit` + `rate_limit_counters` | ✅ both |

**CRITICAL**: Pipeline order is IMMUTABLE (CON-001): Moderation → Sacred Guard → Cost Guard → Rate Limit

### 4.2 Sacred Guard Enforcement Points (FR-012, CON-002)

| Enforcement Point | Function | Location |
|-------------------|----------|----------|
| (a) Story creation | `checkStoryCreationAdmission()` | AdmissionController |
| (b) Character registry | `uploadCharacterReference()` | characterService.ts |
| (c) Pre-moderation admission | `runAdmissionPipeline()` gate 2 | AdmissionController |
| (d) Pre-dispatch | `runAdmissionPipeline()` gate 2 | AdmissionController (main path) |
| (e) Post-generation audit | `checkPostGenerationAdmission()` | AdmissionController + webhookHandler |

### 4.3 Metrics Needed

| Metric Name | Type | Labels | Source |
|-------------|------|--------|--------|
| `admission_pipeline_duration_seconds` | Histogram | `gate`, `result` (pass/fail/warn) | All gates |
| `admission_gate_decision_total` | Counter | `gate`, `decision`, `reason_category` | All gates |
| `sacred_guard_block_total` | Counter | `enforcement_point`, `match_type`, `model_id` | Sacred Guard |
| `cost_guard_pause_total` | Counter | `reason` (user_budget/project_ceiling/committed_spend) | Cost Guard |
| `rate_limit_exceeded_total` | Counter | `scope` (model/user/global/project), `model_id` | Rate Limit |
| `admission_audit_write_duration_seconds` | Histogram | `gate` | Audit INSERT latency |

### 4.4 Alerting Integration Points

| Alert | Condition | Severity | Source |
|-------|-----------|----------|--------|
| `SacredGuardBlock` | Any block at any enforcement point | CRITICAL | `admission_audit` gate=sacred_guard |
| `CostGuardBudgetExceeded` | Cost Guard pause | WARNING | `admission_audit` gate=cost_guard |
| `RateLimitExceeded` | Rate limit gate blocks | WARNING | `admission_audit` gate=rate_limit |
| `MultipleGateFailure` | Sacred + Cost both trigger | CRITICAL | Admission pipeline result |

### 4.5 Health Check Endpoint

```
GET /health/admission
Response: {
  status: "healthy|degraded|unhealthy",
  checks: {
    moderation: { status, latencyMs },
    sacredGuard: { status, latencyMs, denylistSize, cacheAgeMs },
    costGuard: { status, latencyMs, userBudgetRemaining, projectCeilingRemaining },
    rateLimit: { status, latencyMs, globalUsage, globalLimit }
  },
  metrics: { pipelineLatencyP50, pipelineLatencyP99, blocksByGate }
}
```

---

## 5. Phase 4 (Shot Generation) — Integration Points

### 5.1 Shot Dispatcher (`src/dispatch/shotDispatcher.ts`)

| Function | Events Emitted | Metrics Source |
|----------|----------------|----------------|
| `dispatchShot()` | `dispatch_to_model` (via `emitShotStateChange`) | ✅ |
| `dispatchWithFallback()` | `fallback_dispatch` (shot state: timeout → dispatched) | ✅ via state machine |
| `createDispatchRecord()` | INSERT `dispatch_records` | ✅ |
| `updateDispatchRecord()` | UPDATE `dispatch_records` | ✅ |

### 5.2 Webhook Handler (`src/dispatch/webhookHandler.ts`)

| Function | Events Emitted | Idempotency |
|----------|----------------|-------------|
| `handleWebhook()` | `generation_complete` / `generation_failed` via `emitShotStateChange` | ✅ HMAC + duplicate check |
| `logUnrecognizedWebhook()` | `unrecognized_webhook` event + `webhook_unrecognized_log` table | ✅ |

### 5.3 Timeout Manager (`src/dispatch/timeoutManager.ts`)

| Function | Events Emitted | Fallback |
|----------|----------------|----------|
| `startDispatchTimeout()` | `generation_timeout` (via `emitShotStateChange`) | Triggers `dispatchWithFallback()` |
| `cancelDispatchTimeout()` | Called on webhook receipt | Prevents duplicate fallback |

### 5.4 Webhook Watchdog (`src/dispatch/webhookWatchdog.ts`)

| Function | Recovery Action | Metrics |
|----------|----------------|---------|
| `runWatchdog()` / `runWatchdogOnce()` | Polls provider, reuses `handleWebhook()` | Returns `WatchdogResult` (checked, recovered, timedOut, failed) |
| `getWatchdogStats()` | Returns stuck dispatch counts | ✅ |

### 5.5 Metrics Needed

| Metric Name | Type | Labels | Source |
|-------------|------|--------|--------|
| `shot_dispatch_total` | Counter | `model_id`, `status` (dispatched/failed) | `dispatchShot()` |
| `shot_dispatch_latency_seconds` | Histogram | `model_id` | dispatch → webhook |
| `shot_generation_duration_seconds` | Histogram | `model_id`, `shot_duration` | webhook completion |
| `shot_fallback_total` | Counter | `from_model`, `to_model`, `trigger` (timeout/failed/all_failed) | `dispatchWithFallback()` |
| `shot_timeout_total` | Counter | `model_id`, `timeout_seconds` | `timeoutManager` |
| `webhook_received_total` | Counter | `provider`, `status`, `duplicate` | `handleWebhook()` |
| `webhook_processing_latency_seconds` | Histogram | `provider` | `handleWebhook()` |
| `webhook_unrecognized_total` | Counter | `provider` | `logUnrecognizedWebhook()` |
| `watchdog_check_total` | Counter | `result` (recovered/timed_out/failed/still_processing) | `runWatchdogOnce()` |
| `watchdog_stuck_dispatches_gauge` | Gauge | `model_id`, `status` | `getWatchdogStats()` |

### 5.6 Health Check Endpoints

```
GET /health/dispatch
Response: {
  status: "healthy|degraded|unhealthy",
  checks: {
    adapters: { [modelId]: { status, latencyMs } },
    timeoutManager: { activeTimers, oldestTimerMs },
    watchdog: { lastRun, stuckDispatches }
  },
  metrics: { dispatchesInFlight, avgDispatchLatency, fallbackRate }
}
```

---

## 6. Phase 5 (Face-Lock) — Integration Points

### 6.1 Verification Service (`src/verification/faceLockVerification.ts`)

| Function | Events/Data Emitted | Storage |
|----------|---------------------|---------|
| `verifyCharacterInShot()` | Returns `FaceLockVerificationResult` | `face_lock_verifications` |
| `verifyShotCharacters()` | Batch verification per shot | `face_lock_verifications` |
| `storeVerificationResult()` | INSERT `face_lock_verifications` | ✅ |
| `shouldRegenerateShot()` | Decision logic | — |
| `triggerFaceLockRegeneration()` | Re-dispatches shot (calls `dispatchShot()`) | Creates new dispatch record |
| `generateCrossShotConsistencyReport()` | Returns `CrossShotConsistencyReport` | Event emitted via `emitCrossShotConsistencyReport()` |

### 6.2 Webhook Handler Integration (`src/dispatch/webhookHandler.ts` → `performFaceLockVerification()`)

- Called after successful generation webhook
- Runs verification for each character in shot
- Triggers auto-regeneration on failure (up to `maxRetries`)

### 6.3 Metrics Needed

| Metric Name | Type | Labels | Source |
|-------------|------|--------|--------|
| `facelock_verification_total` | Counter | `character_name`, `model_id`, `result` (pass/fail) | `verifyCharacterInShot()` |
| `facelock_similarity_score` | Histogram | `character_name`, `model_id` | `verifyCharacterInShot()` |
| `facelock_regeneration_total` | Counter | `shot_id`, `retry_count`, `trigger` (auto/user_override) | `triggerFaceLockRegeneration()` |
| `facelock_max_retries_exceeded_total` | Counter | `character_name`, `model_id` | `shouldRegenerateShot()` |
| `facelock_cross_shot_drift_detected_total` | Counter | `character_name`, `story_id` | `generateCrossShotConsistencyReport()` |
| `facelock_consistency_report_generated_total` | Counter | `story_id`, `overall_passed` | `generateCrossShotConsistencyReport()` |

### 6.4 Alerting Integration Points

| Alert | Condition | Severity | Source |
|-------|-----------|----------|--------|
| `FaceLockFailureRateHigh` | Failure rate > 20% over 5min window | WARNING | `facelock_verification_total` |
| `FaceLockMaxRetriesExceeded` | Any character hits max retries | WARNING | `facelock_max_retries_exceeded_total` |
| `FaceLockCrossShotDrift` | Drift detected in consistency report | INFO | `facelock_cross_shot_drift_detected_total` |

### 6.5 Health Check Endpoint

```
GET /health/facelock
Response: {
  status: "healthy|degraded|unhealthy",
  checks: {
    verificationEngine: { status, latencyMs },
    frameExtraction: { status, latencyMs }
  },
  metrics: { passRate, avgSimilarity, regenerationsInProgress }
}
```

---

## 7. Phase 6 (Video Assembly) — Integration Points

### 7.1 Merger Service (`src/merger/merger.ts`)

| Function | Events/Data Emitted | Storage |
|----------|---------------------|---------|
| `mergeStoryShots()` | `merge_complete` via `emitStoryStateChange` | Updates `stories` (merged_* columns) |
| `generateDeliveryPackage()` | Returns `DeliveryPackage` | INSERT `delivery_packages` |
| `partialRegenerate()` | Resets shots → re-dispatch → merge | State transitions logged |

### 7.2 Delivery Package (`delivery_packages` table)

- Contains: video URL (7-day TTL), cost summary, logs, verification reports, metadata
- Expires at `expires_at` (7 days)

### 7.3 Metrics Needed

| Metric Name | Type | Labels | Source |
|-------------|------|--------|--------|
| `merge_duration_seconds` | Histogram | `story_id`, `shot_count`, `resolution` | `mergeStoryShots()` |
| `merge_failure_total` | Counter | `story_id`, `error_type` | `mergeStoryShots()` catch |
| `delivery_package_created_total` | Counter | `story_id`, `resolution`, `format` | `generateDeliveryPackage()` |
| `delivery_download_total` | Counter | `story_id`, `resolution` | Download endpoint (not implemented) |
| `partial_regeneration_total` | Counter | `story_id`, `shot_count` | `partialRegenerate()` |
| `delivery_package_size_bytes` | Histogram | `resolution`, `format` | `generateDeliveryPackage()` |

### 7.4 Alerting Integration Points

| Alert | Condition | Severity | Source |
|-------|-----------|----------|--------|
| `MergeFailure` | Any merge fails | CRITICAL | `merge_failure_total` |
| `MergeLatencyHigh` | P99 > 5 min | WARNING | `merge_duration_seconds` |
| `DeliveryPackageExpired` | Package not downloaded before TTL | INFO | `delivery_packages` + download tracking |

### 7.5 Health Check Endpoint

```
GET /health/merger
Response: {
  status: "healthy|degraded|unhealthy",
  checks: {
    ffmpeg: { status, version, latencyMs },
    storage: { status, latencyMs, availableSpaceGB }
  },
  metrics: { mergeQueueDepth, avgMergeDuration, successRate }
}
```

---

## 8. Cross-Phase Correlation IDs for Distributed Tracing

### 8.1 Current State

| Phase | Correlation ID Usage |
|-------|---------------------|
| Events | `StateChangeEvent.id` = `crypto.randomUUID()` per event (NOT propagated) |
| Dispatch | `dispatch_records.provider_request_id` (provider-specific) |
| Webhook | `WebhookPayload.requestId` (provider-specific) |
| Cost | `cost_records` linked by `story_id`, `shot_id` |
| Admission | `admission_audit` linked by `story_id`, `shot_id` |

### 8.2 Required Enhancement: Trace Context Propagation

Add to `StateChangeEvent` and all async operations:

```typescript
interface StateChangeEvent {
  id: string;                 // Event ID (span ID)
  traceId: string;            // NEW: Root trace ID (story creation)
  parentSpanId: string;       // NEW: Parent span ID
  // ... existing fields
}
```

### 8.3 Trace ID Generation & Propagation

| Origin | Trace ID Generation | Propagation Path |
|--------|---------------------|------------------|
| `createStory()` | Generate new `traceId` (UUID) | Pass through: Story → Shots → Admission → Dispatch → Webhook → Face-Lock → Merge |
| CLI/API calls | Extract from header `X-Trace-ID` or generate | Pass in all service calls |
| Async workers | Read from Redis Stream message metadata | Continue trace |

### 8.4 Correlation ID Mapping Table

| Entity | Primary ID | Trace ID Source |
|--------|-----------|-----------------|
| Story | `stories.id` | Generated at creation |
| Shot | `shots.id` | Inherits from story |
| Character | `characters.id` | Inherits from story |
| Dispatch | `dispatch_records.id` | Inherits from shot |
| Cost Record | `cost_records.id` | Inherits from story/shot |
| Verification | `face_lock_verifications.id` | Inherits from shot |
| Delivery | `delivery_packages.id` | Inherits from story |

---

## 9. Consolidated Metrics Inventory (All Phases)

### 9.1 Metrics by Category

| Category | Counters | Histograms | Gauges |
|----------|----------|------------|--------|
| **Ingestion** | story_created_total, character_registered_total, shot_plan_revised_total, sacred_guard_block_total | story_decomposition_duration_seconds | active_stories_gauge, stories_in_planning_gauge |
| **Routing** | model_selection_total, model_eligibility_filtered_total, model_fallback_total, model_registry_refresh_total | — | eligible_models_gauge |
| **Admission** | admission_gate_decision_total, sacred_guard_block_total, cost_guard_pause_total, rate_limit_exceeded_total | admission_pipeline_duration_seconds, admission_audit_write_duration_seconds | rate_limit_usage_gauge (per scope) |
| **Dispatch** | shot_dispatch_total, shot_fallback_total, shot_timeout_total, webhook_received_total, webhook_unrecognized_total, watchdog_check_total | shot_dispatch_latency_seconds, shot_generation_duration_seconds, webhook_processing_latency_seconds | dispatches_in_flight_gauge, watchdog_stuck_dispatches_gauge |
| **Face-Lock** | facelock_verification_total, facelock_regeneration_total, facelock_max_retries_exceeded_total, facelock_cross_shot_drift_detected_total, facelock_consistency_report_generated_total | facelock_similarity_score | facelock_pass_rate_gauge |
| **Assembly** | merge_failure_total, delivery_package_created_total, delivery_download_total, partial_regeneration_total | merge_duration_seconds, delivery_package_size_bytes | merge_queue_depth_gauge |
| **Infrastructure** | vault_encrypt_total, vault_decrypt_total, vault_dek_rotation_total, vault_kek_rotation_total | vault_encrypt_duration_seconds, vault_decrypt_duration_seconds, db_query_duration_seconds, redis_command_duration_seconds | db_pool_usage_gauge, redis_connection_gauge, vault_status_gauge |

### 9.2 Recommended Prometheus Metric Names (OpenMetrics Format)

```
# HELP ai_video_stories_created_total Total stories created
# TYPE ai_video_stories_created_total counter
ai_video_stories_created_total{user_id="...",status="planning"} 123

# HELP ai_video_shot_generation_duration_seconds Shot generation latency
# TYPE ai_video_shot_generation_duration_seconds histogram
ai_video_shot_generation_duration_seconds_bucket{model_id="veo3-low",le="60"} 45
ai_video_shot_generation_duration_seconds_bucket{model_id="veo3-low",le="120"} 78
ai_video_shot_generation_duration_seconds_bucket{model_id="veo3-low",le="+Inf"} 82
ai_video_shot_generation_duration_seconds_sum{model_id="veo3-low"} 4520.5
ai_video_shot_generation_duration_seconds_count{model_id="veo3-low"} 82

# HELP ai_video_admission_gate_decision_total Admission gate decisions
# TYPE ai_video_admission_gate_decision_total counter
ai_video_admission_gate_decision_total{gate="sacred_guard",decision="fail",category="visual_semantic"} 3

# HELP ai_video_facelock_verification_total Face-Lock verifications
# TYPE ai_video_facelock_verification_total counter
ai_video_facelock_verification_total{character="john",model_id="veo3-low",result="pass"} 15

# HELP ai_video_merge_duration_seconds Video merge duration
# TYPE ai_video_merge_duration_seconds histogram
ai_video_merge_duration_seconds_bucket{resolution="1080p",shot_count="5",le="60"} 12
```

---

## 10. Health Check Endpoints Consolidation

### 10.1 Per-Service Health Endpoints

| Service | Path | Dependencies Checked |
|---------|------|---------------------|
| Ingestion | `GET /health/ingestion` | PostgreSQL, Vault, Redis |
| Router | `GET /health/router` | Model Registry (config) |
| Admission | `GET /health/admission` | PostgreSQL (budgets, rate limits), Sacred Guard cache |
| Dispatch | `GET /health/dispatch` | Model Adapters, Timeout Manager, Watchdog |
| Face-Lock | `GET /health/facelock` | Frame extraction, Verification engine |
| Merger | `GET /health/merger` | FFmpeg, Storage |
| **Aggregate** | `GET /health` | All above + infrastructure |

### 10.2 Aggregate Health Response Format

```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2026-08-07T12:00:00Z",
  "version": "1.0.0",
  "checks": {
    "database": { "status": "healthy", "latencyMs": 5 },
    "redis": { "status": "healthy", "latencyMs": 2 },
    "vault": { "status": "healthy", "latencyMs": 10 },
    "ingestion": { "status": "healthy", "latencyMs": 15 },
    "router": { "status": "healthy", "latencyMs": 1 },
    "admission": { "status": "healthy", "latencyMs": 45 },
    "dispatch": { "status": "healthy", "latencyMs": 30 },
    "facelock": { "status": "healthy", "latencyMs": 200 },
    "merger": { "status": "healthy", "latencyMs": 50 }
  },
  "metrics": {
    "activeStories": 42,
    "shotsInFlight": 15,
    "dispatchedShots": 8,
    "generatingShots": 7,
    "pendingFaceLock": 3,
    "mergingStories": 2,
    "costDriftPercentage": 5.2,
    "rateLimitGlobalUsage": 23
  }
}
```

### 10.3 Kubernetes Probe Integration

| Probe | Path | Interval | Timeout | Failure Threshold |
|-------|------|----------|---------|-------------------|
| Liveness | `GET /health/live` | 10s | 5s | 3 |
| Readiness | `GET /health/ready` | 5s | 3s | 3 |
| Startup | `GET /health/startup` | 5s | 10s | 30 |

---

## 11. Alerting Rules Consolidation

### 11.1 Critical Alerts (Page Immediately)

| Alert | Expression | For | Labels |
|-------|------------|-----|--------|
| `SacredGuardBlock` | `increase(ai_video_admission_gate_decision_total{gate="sacred_guard",decision="fail"}[5m]) > 0` | 0m | `severity=critical`, `runbook=sacred-guard-block` |
| `MergeFailure` | `increase(ai_video_merge_failure_total[5m]) > 0` | 0m | `severity=critical`, `runbook=merge-failure` |
| `AllModelsFailedForShot` | `increase(ai_video_shot_dispatch_total{status="all_failed"}[5m]) > 0` | 0m | `severity=critical`, `runbook=all-models-failed` |
| `DatabaseUnavailable` | `ai_video_db_health_status == 0` | 1m | `severity=critical`, `runbook=db-down` |
| `VaultUnavailable` | `ai_video_vault_health_status == 0` | 1m | `severity=critical`, `runbook=vault-down` |

### 11.2 Warning Alerts (Ticket + Notify)

| Alert | Expression | For | Labels |
|-------|------------|-----|--------|
| `CostDriftHigh` | `ai_video_cost_drift_percentage > 20` | 5m | `severity=warning`, `runbook=cost-drift` |
| `FaceLockFailureRateHigh` | `rate(ai_video_facelock_verification_total{result="fail"}[5m]) / rate(ai_video_facelock_verification_total[5m]) > 0.2` | 5m | `severity=warning`, `runbook=facelock-failures` |
| `RateLimitExceeded` | `increase(ai_video_admission_gate_decision_total{gate="rate_limit",decision="fail"}[5m]) > 10` | 5m | `severity=warning`, `runbook=rate-limit` |
| `HighShotTimeoutRate` | `rate(ai_video_shot_timeout_total[5m]) > 0.1` | 5m | `severity=warning`, `runbook=shot-timeouts` |
| `WebhookUnrecognizedSpike` | `increase(ai_video_webhook_unrecognized_total[5m]) > 5` | 5m | `severity=warning`, `runbook=webhook-unrecognized` |
| `WatchdogStuckDispatches` | `ai_video_watchdog_stuck_dispatches_gauge > 10` | 5m | `severity=warning`, `runbook=watchdog-stuck` |

### 11.3 Info Alerts (Log Only)

| Alert | Expression | For | Labels |
|-------|------------|-----|--------|
| `FaceLockCrossShotDrift` | `increase(ai_video_facelock_cross_shot_drift_detected_total[1h]) > 0` | 0m | `severity=info` |
| `DeliveryPackageExpired` | `ai_video_delivery_packages_expired_total > 0` | 1h | `severity=info` |
| `ModelFallbackTriggered` | `increase(ai_video_model_fallback_total[1h]) > 0` | 0m | `severity=info` |

---

## 12. Database Audit Triggers Needed

### 12.1 Existing Immutable Tables (✅ Complete)

| Table | Trigger | Enforcement |
|-------|---------|-------------|
| `story_events` | `story_events_immutable_trigger` | BEFORE UPDATE/DELETE → RAISE EXCEPTION |
| `admission_audit` | `admission_audit_immutable_trigger` | BEFORE UPDATE/DELETE → RAISE EXCEPTION |
| `sacred_entity_audit` | No UPDATE/DELETE in code | Application-level only |

### 12.2 Additional Audit Triggers Recommended for Phase 7

```sql
-- 1. Cost records immutability (FR-033)
CREATE OR REPLACE FUNCTION enforce_cost_records_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'cost_records is immutable - % not allowed', TG_OP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cost_records_immutable_trigger
    BEFORE UPDATE OR DELETE ON cost_records
    FOR EACH ROW EXECUTE FUNCTION enforce_cost_records_immutable();

-- 2. Dispatch records immutability (FR-017, FR-018, FR-019)
CREATE OR REPLACE FUNCTION enforce_dispatch_records_immutable()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow status updates for webhook completion, but not deletion
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'dispatch_records DELETE not allowed';
    END IF
    -- Prevent overwriting completed/failed status
    IF TG_OP = 'UPDATE' AND OLD.status IN ('completed', 'failed') AND NEW.status != OLD.status THEN
        RAISE EXCEPTION 'dispatch_records status transition from % to % not allowed', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispatch_records_immutable_trigger
    BEFORE UPDATE OR DELETE ON dispatch_records
    FOR EACH ROW EXECUTE FUNCTION enforce_dispatch_records_immutable();

-- 3. Face-Lock verifications immutability (FR-024, FR-025)
CREATE OR REPLACE FUNCTION enforce_face_lock_verifications_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'face_lock_verifications is immutable - % not allowed', TG_OP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER face_lock_verifications_immutable_trigger
    BEFORE UPDATE OR DELETE ON face_lock_verifications
    FOR EACH ROW EXECUTE FUNCTION enforce_face_lock_verifications_immutable();

-- 4. Delivery packages immutability (FR-030)
CREATE OR REPLACE FUNCTION enforce_delivery_packages_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'delivery_packages is immutable - % not allowed', TG_OP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delivery_packages_immutable_trigger
    BEFORE UPDATE OR DELETE ON delivery_packages
    FOR EACH ROW EXECUTE FUNCTION enforce_delivery_packages_immutable();
```

---

## 13. Redis Streams Consumer Architecture for Phase 7

### 13.1 Consumer Groups & Responsibilities

| Consumer Group | Stream | Handler | Output |
|----------------|--------|---------|--------|
| `metrics-aggregator` | `story_events` | Aggregate state transitions → Prometheus | `health_metrics` table + Prometheus metrics |
| `metrics-aggregator` | `job_status` | Track job queue depth, durations | Prometheus metrics |
| `metrics-aggregator` | `webhook_ingress` | Webhook volume, latency | Prometheus metrics |
| `alert-evaluator` | `story_events` | Real-time rule evaluation (Sacred Guard, Cost, Rate Limit) | Alertmanager / PagerDuty |
| `audit-archiver` | `story_events` | Batch write to cold storage (S3/GCS) | 7-year retention (NFR-008) |
| `dashboard-updater` | `story_events` | Materialized views for operational dashboard | Dashboard DB / Redis cache |

### 13.2 Consumer Implementation Pattern

```typescript
// Example: Metrics Aggregator Consumer
async function runMetricsAggregator() {
  const consumerName = `metrics-aggregator-${process.env.HOSTNAME}-${process.pid}`;
  
  while (true) {
    const messages = await consumeStream(
      STREAMS.STORY_EVENTS,
      CONSUMER_GROUPS.EVENT_PROCESSOR,  // Reuse existing group
      consumerName,
      100,
      5000
    );
    
    for (const msg of messages) {
      const event = JSON.parse(msg.data.event);
      await processEventForMetrics(event);
      await acknowledgeMessage(STREAMS.STORY_EVENTS, CONSUMER_GROUPS.EVENT_PROCESSOR, msg.id);
    }
  }
}

async function processEventForMetrics(event: StateChangeEvent) {
  // Extract metrics from event
  const labels = {
    entityType: event.entityType,
    fromState: event.fromState,
    toState: event.toState,
    action: event.metadata.action,
  };
  
  // Increment counters
  metrics.storyStateTransitionsTotal.inc(labels);
  
  // Record latency if available
  if (event.metadata.payload?.durationMs) {
    metrics.stateTransitionDurationSeconds.observe(labels, event.metadata.payload.durationMs / 1000);
  }
  
  // Special handling for critical events
  if (event.metadata.action === 'admission_fail' && event.metadata.payload.gate === 'sacred_guard') {
    metrics.sacredGuardBlocksTotal.inc({ matchType: event.metadata.payload.matchType });
    await evaluateAlert('SacredGuardBlock', event);
  }
}
```

---

## 14. File Location Summary

### 14.1 Core Observability Files (Phase 7 Targets)

| File | Purpose | Phase 7 Changes Needed |
|------|---------|------------------------|
| `src/shared/events.ts` | Event bus, state machines | Add `traceId`, `parentSpanId` to `StateChangeEvent` |
| `src/shared/types.ts` | Type definitions | Add `traceId`, `parentSpanId` to `StateChangeEvent`, `HealthStatus` |
| `src/shared/redis.ts` | Redis Streams client | Add consumer for metrics/alerting/audit |
| `src/shared/db.ts` | Database pool | Add query latency histogram |
| `src/shared/config.ts` | Configuration | Add observability config (metricsPort, retention) |
| `src/shared/vault.ts` | Vault Transit | Add encryption/decryption latency metrics |

### 14.2 Phase-Specific Files Requiring Metrics Hooks

| Phase | File | Functions to Instrument |
|-------|------|------------------------|
| 1 | `src/ingestion/storyService.ts` | `createStory`, `presentShotPlan`, `approveShotPlan`, `reviseShotPlan` |
| 1 | `src/ingestion/characterService.ts` | `uploadCharacterReference`, `validateCharacterReferences` |
| 2 | `src/router/autoRouter.ts` | `selectModelForShot`, `getNextFallback`, `recordDispatchAttempt` |
| 2 | `src/router/modelRegistry.ts` | `getEligibleModels`, `initializeModelRegistryTable` |
| 3 | `src/admission/admissionController.ts` | `runAdmissionPipeline`, `checkStoryCreationAdmission`, `checkPostGenerationAdmission`, `resolvePause` |
| 3 | `src/admission/moderationGate.ts` | `checkModeration`, `recordModerationAudit` |
| 3 | `src/admission/sacredGuard.ts` | `checkSacredGuard`, `addToDenylist`, `approveDenylistEntry` |
| 3 | `src/admission/costGuard.ts` | `checkCostGuard`, `recordActualCost`, `checkCostDrift` |
| 3 | `src/admission/rateLimitGate.ts` | `checkRateLimit`, `getRateLimitStatus` |
| 4 | `src/dispatch/shotDispatcher.ts` | `dispatchShot`, `dispatchWithFallback`, `createDispatchRecord` |
| 4 | `src/dispatch/webhookHandler.ts` | `handleWebhook`, `performFaceLockVerification`, `getWebhookStats` |
| 4 | `src/dispatch/timeoutManager.ts` | `startDispatchTimeout`, `cancelDispatchTimeout`, `getActiveTimeoutCount` |
| 4 | `src/dispatch/webhookWatchdog.ts` | `runWatchdogOnce`, `getWatchdogStats` |
| 5 | `src/verification/faceLockVerification.ts` | `verifyCharacterInShot`, `verifyShotCharacters`, `triggerFaceLockRegeneration`, `generateCrossShotConsistencyReport` |
| 6 | `src/merger/merger.ts` | `mergeStoryShots`, `generateDeliveryPackage`, `partialRegenerate` |

---

## 15. Implementation Priority (Phase 7)

### 15.1 Week 1: Foundation & Core Metrics
1. Add `traceId`/`parentSpanId` to `StateChangeEvent` and propagate through all services
2. Implement `MetricsCollector` singleton with Prometheus client
3. Add metrics instrumentation to `events.ts` emit functions
4. Add database query latency tracking in `db.ts`
5. Add Vault operation latency tracking in `vault.ts`

### 15.2 Week 2: Phase-Specific Metrics
1. Instrument Ingestion (Phase 1) — story/character events
2. Instrument Router (Phase 2) — model selection/fallback
3. Instrument Admission (Phase 3) — all 4 gates + Sacred Guard points
4. Instrument Dispatch (Phase 4) — dispatch, webhook, timeout, watchdog
5. Instrument Face-Lock (Phase 5) — verification, regeneration, consistency
6. Instrument Merger (Phase 6) — merge, delivery, partial regeneration

### 15.3 Week 3: Health Checks & Consumers
1. Implement per-service health check endpoints
2. Implement aggregate `/health` endpoint
3. Implement Redis Streams consumers:
   - Metrics Aggregator → Prometheus
   - Alert Evaluator → Alertmanager
   - Audit Archiver → S3/GCS
4. Add database immutability triggers (Section 12.2)

### 15.4 Week 4: Alerting & Dashboards
1. Define Prometheus alerting rules (Section 11)
2. Configure Alertmanager routes
3. Build operational dashboard (Grafana)
4. Add Kubernetes probe endpoints
5. Document runbooks for each critical alert

---

## 16. Compliance Traceability (FR-031 through FR-034)

| Requirement | Implementation Status | Location |
|-------------|----------------------|----------|
| **FR-031**: State change notification | ✅ Implemented | `events.ts` — all transitions emit to PG + Redis |
| **FR-032**: Immutable audit log | ✅ Implemented | `admission_audit`, `story_events`, `sacred_entity_audit` with triggers |
| **FR-033**: Cost attribution | ✅ Implemented | `cost_records` table with story/shot/model/user/timestamp |
| **FR-034**: Operational health | ⚠️ Partial | `health_metrics` table exists; endpoints + consumers needed |

---

## 17. Appendix: Correlation ID Header Propagation

### 17.1 HTTP Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-Trace-ID` | In/Out | Root trace identifier (UUID) |
| `X-Span-ID` | In/Out | Current span identifier |
| `X-Parent-Span-ID` | Out | Parent span for child operations |

### 17.2 Redis Stream Message Headers

```typescript
// When publishing to Redis Streams, include trace context
await r.xadd(STREAMS.STORY_EVENTS, '*',
  'event', JSON.stringify(event),
  'traceId', event.traceId,
  'spanId', event.id,
  'parentSpanId', event.metadata.parentSpanId || ''
);
```

### 17.3 Async Worker Context

```typescript
// In consumer, extract and propagate
const traceId = msg.data.traceId;
const spanId = msg.data.spanId;
const parentSpanId = msg.data.parentSpanId;

// Create child span for processing
const childSpanId = crypto.randomUUID();
await doWork({ traceId, spanId: childSpanId, parentSpanId: spanId });
```

---

*End of Integration Map*