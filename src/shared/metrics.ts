/**
 * Prometheus Metrics Singleton
 * Provides centralized metrics collection for the FTE
 * Implements FR-034, NFR-001, NFR-002, NFR-003, AC-029
 */

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { config } from './config.js';

let metricsRegistry: Registry | null = null;
let metricsInitialized = false;

/**
 * Get or create the Prometheus registry singleton
 */
export function getMetricsRegistry(): Registry {
  if (!metricsRegistry) {
    metricsRegistry = new Registry();
    // Set default labels for all metrics
    metricsRegistry.setDefaultLabels({
      app: 'ai-video-fte',
      environment: process.env.NODE_ENV || 'development',
    });
    // Collect default Node.js metrics (event loop, memory, CPU, etc.)
    collectDefaultMetrics({ register: metricsRegistry, prefix: 'ai_video_' });
  }
  return metricsRegistry;
}

/**
 * Initialize metrics (called once at startup)
 */
export function initializeMetrics(): Registry {
  if (metricsInitialized) {
    return getMetricsRegistry();
  }
  metricsInitialized = true;
  return getMetricsRegistry();
}

// ============================================================================
// Metric Creators
// ============================================================================

/**
 * Create a counter metric
 */
export function createCounter(
  name: string,
  help: string,
  labelNames: string[] = []
): Counter {
  const registry = getMetricsRegistry();
  const existing = registry.getSingleMetric(`ai_video_${name}`);
  if (existing && existing instanceof Counter) {
    return existing;
  }
  return new Counter({ name: `ai_video_${name}`, help, labelNames, registers: [registry] });
}

/**
 * Create a gauge metric
 */
export function createGauge(
  name: string,
  help: string,
  labelNames: string[] = []
): Gauge {
  const registry = getMetricsRegistry();
  const existing = registry.getSingleMetric(`ai_video_${name}`);
  if (existing && existing instanceof Gauge) {
    return existing;
  }
  return new Gauge({ name: `ai_video_${name}`, help, labelNames, registers: [registry] });
}

/**
 * Create a histogram metric
 */
export function createHistogram(
  name: string,
  help: string,
  labelNames: string[] = [],
  buckets?: number[]
): Histogram {
  const registry = getMetricsRegistry();
  const existing = registry.getSingleMetric(`ai_video_${name}`);
  if (existing && existing instanceof Histogram) {
    return existing;
  }
  return new Histogram({
    name: `ai_video_${name}`,
    help,
    labelNames,
    buckets: buckets || [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [registry],
  });
}

/**
 * Get metrics as Prometheus text format
 */
export async function getMetricsAsText(): Promise<string> {
  const registry = getMetricsRegistry();
  return registry.metrics();
}

/**
 * Get metrics as JSON
 */
export async function getMetricsAsJSON(): Promise<any> {
  const registry = getMetricsRegistry();
  return registry.getMetricsAsJSON();
}

/**
 * Get content type for Prometheus exposition
 */
export function getMetricsContentType(): string {
  const registry = getMetricsRegistry();
  return registry.contentType;
}

/**
 * Reset all metrics (for testing)
 */
export function resetMetrics(): void {
  if (metricsRegistry) {
    metricsRegistry.clear();
    metricsInitialized = false;
    metricsRegistry = null;
  }
}

// ============================================================================
// Pre-defined Core Metrics (per integration map)
// ============================================================================

// Ingestion
export const storiesCreatedTotal = createCounter(
  'stories_created_total',
  'Total stories created',
  ['user_id', 'status']
);

export const storyDecompositionDurationSeconds = createHistogram(
  'story_decomposition_duration_seconds',
  'Story decomposition latency in seconds',
  ['shot_count']
);

export const charactersRegisteredTotal = createCounter(
  'characters_registered_total',
  'Total characters registered',
  ['story_id', 'has_voice']
);

export const characterSacredGuardBlocksTotal = createCounter(
  'character_sacred_guard_block_total',
  'Sacred Guard blocks at character registration',
  ['match_type']
);

export const shotPlanRevisedTotal = createCounter(
  'shot_plan_revised_total',
  'Shot plan revisions',
  ['action']
);

// Routing
export const modelSelectionTotal = createCounter(
  'model_selection_total',
  'Model selections',
  ['model_id', 'reason', 'is_override']
);

export const modelEligibilityFilteredTotal = createCounter(
  'model_eligibility_filtered_total',
  'Models filtered by eligibility',
  ['model_id', 'reason']
);

export const modelFallbackTotal = createCounter(
  'model_fallback_total',
  'Model fallbacks',
  ['from_model', 'to_model', 'reason']
);

export const modelRegistryRefreshTotal = createCounter(
  'model_registry_refresh_total',
  'Model registry refreshes',
  ['success']
);

// Admission
export const admissionPipelineDurationSeconds = createHistogram(
  'admission_pipeline_duration_seconds',
  'Admission pipeline latency',
  ['gate', 'result']
);

export const admissionGateDecisionTotal = createCounter(
  'admission_gate_decision_total',
  'Admission gate decisions',
  ['gate', 'decision', 'reason_category']
);

export const sacredGuardBlockTotal = createCounter(
  'sacred_guard_block_total',
  'Sacred Guard blocks',
  ['enforcement_point', 'match_type', 'model_id']
);

export const costGuardPauseTotal = createCounter(
  'cost_guard_pause_total',
  'Cost Guard pauses',
  ['reason']
);

export const rateLimitExceededTotal = createCounter(
  'rate_limit_exceeded_total',
  'Rate limit exceeded',
  ['scope', 'model_id']
);

export const admissionAuditWriteDurationSeconds = createHistogram(
  'admission_audit_write_duration_seconds',
  'Admission audit write latency',
  ['gate']
);

export const rateLimitUsageGauge = createGauge(
  'rate_limit_usage_gauge',
  'Rate limit usage',
  ['scope_type', 'scope_key']
);

// Dispatch
export const shotDispatchTotal = createCounter(
  'shot_dispatch_total',
  'Shot dispatches',
  ['model_id', 'status']
);

export const shotDispatchLatencySeconds = createHistogram(
  'shot_dispatch_latency_seconds',
  'Shot dispatch to webhook latency',
  ['model_id']
);

export const shotGenerationDurationSeconds = createHistogram(
  'shot_generation_duration_seconds',
  'Shot generation duration',
  ['model_id', 'shot_duration']
);

export const shotFallbackTotal = createCounter(
  'shot_fallback_total',
  'Shot fallbacks',
  ['from_model', 'to_model', 'trigger']
);

export const shotTimeoutTotal = createCounter(
  'shot_timeout_total',
  'Shot timeouts',
  ['model_id', 'timeout_seconds']
);

export const webhookReceivedTotal = createCounter(
  'webhook_received_total',
  'Webhooks received',
  ['provider', 'status', 'duplicate']
);

export const webhookProcessingLatencySeconds = createHistogram(
  'webhook_processing_latency_seconds',
  'Webhook processing latency',
  ['provider']
);

export const webhookUnrecognizedTotal = createCounter(
  'webhook_unrecognized_total',
  'Unrecognized webhooks',
  ['provider']
);

export const watchdogCheckTotal = createCounter(
  'watchdog_check_total',
  'Watchdog checks',
  ['result']
);

export const watchdogStuckDispatchesGauge = createGauge(
  'watchdog_stuck_dispatches_gauge',
  'Stuck dispatches detected by watchdog',
  ['model_id', 'status']
);

export const dispatchesInFlightGauge = createGauge(
  'dispatches_in_flight_gauge',
  'Dispatches currently in flight',
  ['model_id']
);

// Face-Lock
export const facelockVerificationTotal = createCounter(
  'facelock_verification_total',
  'Face-Lock verifications',
  ['character_name', 'model_id', 'result']
);

export const facelockSimilarityScore = createHistogram(
  'facelock_similarity_score',
  'Face-Lock similarity scores',
  ['character_name', 'model_id']
);

export const facelockRegenerationTotal = createCounter(
  'facelock_regeneration_total',
  'Face-Lock auto-regenerations',
  ['shot_id', 'retry_count', 'trigger']
);

export const facelockMaxRetriesExceededTotal = createCounter(
  'facelock_max_retries_exceeded_total',
  'Face-Lock max retries exceeded',
  ['character_name', 'model_id']
);

export const facelockCrossShotDriftDetectedTotal = createCounter(
  'facelock_cross_shot_drift_detected_total',
  'Cross-shot drift detected',
  ['character_name', 'story_id']
);

export const facelockConsistencyReportGeneratedTotal = createCounter(
  'facelock_consistency_report_generated_total',
  'Cross-shot consistency reports generated',
  ['story_id', 'overall_passed']
);

export const facelockPassRateGauge = createGauge(
  'facelock_pass_rate_gauge',
  'Face-Lock pass rate',
  ['character_name', 'model_id']
);

// Assembly
export const mergeDurationSeconds = createHistogram(
  'merge_duration_seconds',
  'Video merge duration',
  ['story_id', 'shot_count', 'resolution']
);

export const mergeFailureTotal = createCounter(
  'merge_failure_total',
  'Merge failures',
  ['story_id', 'error_type']
);

export const deliveryPackageCreatedTotal = createCounter(
  'delivery_package_created_total',
  'Delivery packages created',
  ['story_id', 'resolution', 'format']
);

export const deliveryDownloadTotal = createCounter(
  'delivery_download_total',
  'Delivery downloads',
  ['story_id', 'resolution']
);

export const partialRegenerationTotal = createCounter(
  'partial_regeneration_total',
  'Partial regenerations',
  ['story_id', 'shot_count']
);

export const deliveryPackageSizeBytes = createHistogram(
  'delivery_package_size_bytes',
  'Delivery package size',
  ['resolution', 'format']
);

export const mergeQueueDepthGauge = createGauge(
  'merge_queue_depth_gauge',
  'Merge queue depth',
  []
);

// Infrastructure
export const vaultEncryptTotal = createCounter(
  'vault_encrypt_total',
  'Vault encrypt operations',
  ['status']
);

export const vaultDecryptTotal = createCounter(
  'vault_decrypt_total',
  'Vault decrypt operations',
  ['status']
);

export const vaultDEKRotationTotal = createCounter(
  'vault_dek_rotation_total',
  'Vault DEK rotations',
  ['status']
);

export const vaultKEKRotationTotal = createCounter(
  'vault_kek_rotation_total',
  'Vault KEK rotations',
  ['status']
);

export const vaultEncryptDurationSeconds = createHistogram(
  'vault_encrypt_duration_seconds',
  'Vault encrypt latency',
  []
);

export const vaultDecryptDurationSeconds = createHistogram(
  'vault_decrypt_duration_seconds',
  'Vault decrypt latency',
  []
);

export const dbQueryDurationSeconds = createHistogram(
  'db_query_duration_seconds',
  'Database query latency',
  ['operation']
);

export const redisCommandDurationSeconds = createHistogram(
  'redis_command_duration_seconds',
  'Redis command latency',
  ['command']
);

export const dbPoolUsageGauge = createGauge(
  'db_pool_usage_gauge',
  'Database pool usage',
  []
);

export const redisConnectionGauge = createGauge(
  'redis_connection_gauge',
  'Redis connections',
  []
);

export const vaultStatusGauge = createGauge(
  'vault_status_gauge',
  'Vault status (1=healthy, 0=unhealthy)',
  []
);

// Stories/Shots in flight
export const activeStoriesGauge = createGauge(
  'active_stories_gauge',
  'Active stories',
  []
);

export const activeShotsGauge = createGauge(
  'active_shots_gauge',
  'Active shots',
  []
);

export const costDriftPercentageGauge = createGauge(
  'cost_drift_percentage_gauge',
  'Cost drift percentage',
  []
);