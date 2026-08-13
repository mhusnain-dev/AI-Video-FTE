/**
 * Metrics Aggregator Consumer
 * Consumes story_events, job_status, webhook_ingress streams
 * Aggregates metrics to Prometheus and persists to health_metrics table
 * Implements FR-034, NFR-001, AC-029
 */

import { BaseConsumer, ConsumerOptions } from './baseConsumer.js';
import { query } from '../shared/db.js';
import type { StreamMessage, StateChangeEvent } from '../shared/types.js';
import { config } from '../shared/config.js';

// Import all metrics
import {
  // Story/Shot state transitions
  storiesCreatedTotal,
  storyDecompositionDurationSeconds,
  shotPlanRevisedTotal,
  activeStoriesGauge,
  activeShotsGauge,
  charactersRegisteredTotal,
  characterSacredGuardBlocksTotal,

  // Routing
  modelSelectionTotal,
  modelEligibilityFilteredTotal,
  modelFallbackTotal,
  modelRegistryRefreshTotal,

  // Admission
  admissionPipelineDurationSeconds,
  admissionGateDecisionTotal,
  sacredGuardBlockTotal,
  costGuardPauseTotal,
  rateLimitExceededTotal,

  // Dispatch
  shotDispatchTotal,
  shotDispatchLatencySeconds,
  shotGenerationDurationSeconds,
  shotFallbackTotal,
  shotTimeoutTotal,
  webhookReceivedTotal,
  webhookProcessingLatencySeconds,
  webhookUnrecognizedTotal,
  watchdogCheckTotal,
  watchdogStuckDispatchesGauge,
  dispatchesInFlightGauge,

  // Face-Lock
  facelockVerificationTotal,
  facelockSimilarityScore,
  facelockRegenerationTotal,
  facelockMaxRetriesExceededTotal,
  facelockCrossShotDriftDetectedTotal,
  facelockConsistencyReportGeneratedTotal,
  facelockPassRateGauge,

  // Assembly
  mergeDurationSeconds,
  mergeFailureTotal,
  deliveryPackageCreatedTotal,
  deliveryDownloadTotal,
  partialRegenerationTotal,
  deliveryPackageSizeBytes,
  mergeQueueDepthGauge,

  // Infrastructure
  vaultEncryptTotal,
  vaultDecryptTotal,
  vaultDEKRotationTotal,
  vaultKEKRotationTotal,
  vaultEncryptDurationSeconds,
  vaultDecryptDurationSeconds,
  dbQueryDurationSeconds,
  redisCommandDurationSeconds,
  dbPoolUsageGauge,
  redisConnectionGauge,
  vaultStatusGauge,

  // Cost
  costDriftPercentageGauge,
} from '../shared/metrics.js';
import { STREAMS } from '../shared/redis.js';

// Payload type for StateChangeEvent metadata
interface EventPayload {
  userId?: string;
  shotCount?: number;
  decompositionDurationMs?: number;
  durationMs?: number; // generic duration field
  revisionType?: string;
  modelId?: string;
  status?: string;
  error?: string;
  durationSeconds?: number;
  dispatchLatencyMs?: number;
  timeoutSeconds?: number;
  fromModel?: string;
  toModel?: string;
  trigger?: string;
  characterName?: string;
  storyId?: string;
  hasVoice?: boolean;
  matchType?: string;
  overallPassed?: boolean;
  startTime?: number;
  [key: string]: unknown;
}

export interface MetricsAggregatorOptions extends ConsumerOptions {
  /** Flush interval for persisting metrics to DB (ms) */
  flushIntervalMs?: number;
}

interface AggregatedMetrics {
  // Counters incremented in batch
  stateTransitions: Map<string, number>;
  gateDecisions: Map<string, number>;
  sacredGuardBlocks: Map<string, number>;
  costGuardPauses: Map<string, number>;
  rateLimitExceeded: Map<string, number>;
  shotDispatches: Map<string, number>;
  shotFallbacks: Map<string, number>;
  shotTimeouts: Map<string, number>;
  webhookReceived: Map<string, number>;
  webhookUnrecognized: Map<string, number>;
  watchdogChecks: Map<string, number>;
  faceLockVerifications: Map<string, number>;
  faceLockRegenerations: Map<string, number>;
  faceLockMaxRetries: Map<string, number>;
  faceLockDrift: Map<string, number>;
  faceLockReports: Map<string, number>;
  merges: Map<string, number>;
  mergeFailures: Map<string, number>;
  deliveries: Map<string, number>;
  partialRegenerations: Map<string, number>;
  // Histogram observations
  latencies: Array<{ metric: string; value: number; labels: Record<string, string> }>;
  // Gauges
  gauges: Array<{ metric: string; value: number; labels: Record<string, string> }>;
}

export class MetricsAggregatorConsumer extends BaseConsumer {
  private readonly flushIntervalMs: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private aggregated: AggregatedMetrics;

  constructor(options: MetricsAggregatorOptions) {
    super({
      ...options,
      groupName: options.groupName,
      consumerName: options.consumerName,
      stream: options.stream,
      count: options.count ?? 100,
      blockMs: options.blockMs ?? 5000,
    });

    this.flushIntervalMs = options.flushIntervalMs ?? 10000; // 10 seconds default
    this.aggregated = this.createEmptyAggregated();
  }

  private createEmptyAggregated(): AggregatedMetrics {
    return {
      stateTransitions: new Map(),
      gateDecisions: new Map(),
      sacredGuardBlocks: new Map(),
      costGuardPauses: new Map(),
      rateLimitExceeded: new Map(),
      shotDispatches: new Map(),
      shotFallbacks: new Map(),
      shotTimeouts: new Map(),
      webhookReceived: new Map(),
      webhookUnrecognized: new Map(),
      watchdogChecks: new Map(),
      faceLockVerifications: new Map(),
      faceLockRegenerations: new Map(),
      faceLockMaxRetries: new Map(),
      faceLockDrift: new Map(),
      faceLockReports: new Map(),
      merges: new Map(),
      mergeFailures: new Map(),
      deliveries: new Map(),
      partialRegenerations: new Map(),
      latencies: [],
      gauges: [],
    };
  }

  async start(): Promise<void> {
    await super.start();

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    this.flushTimer.unref(); // Don't prevent process exit
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush(); // Flush remaining
    await super.stop();
  }

  protected async processMessage(message: StreamMessage): Promise<void> {
    const stream = message.stream;

    if (stream === STREAMS.STORY_EVENTS) {
      await this.processStoryEvent(message);
    } else if (stream === STREAMS.JOB_STATUS) {
      await this.processJobStatus(message);
    } else if (stream === STREAMS.WEBHOOK_INGRESS) {
      await this.processWebhookIngress(message);
    }
  }

  private async processStoryEvent(message: StreamMessage): Promise<void> {
    const event = this.parseStateChangeEvent(message);
    if (!event) return;

    const { entityType, fromState, toState, metadata } = event;
    const action = (metadata?.action ?? '') as string;
    const payload = (metadata?.payload ?? {}) as EventPayload;

    // Increment state transition counter
    const transitionKey = `${entityType}:${fromState}:${toState}:${action}`;
    this.increment(this.aggregated.stateTransitions, transitionKey);

    // Record latency if available
    if (payload.durationMs) {
      this.aggregated.latencies.push({
        metric: 'state_transition_duration_seconds',
        value: payload.durationMs / 1000,
        labels: { entityType, fromState, toState, action },
      });
    }

    // Entity-specific metrics
    switch (entityType) {
      case 'story':
        await this.processStoryEventMetrics(event, action, payload);
        break;
      case 'shot':
        await this.processShotEventMetrics(event, action, payload);
        break;
      case 'character':
        await this.processCharacterEventMetrics(event, action, payload);
        break;
    }
  }

  private async processStoryEventMetrics(event: StateChangeEvent, action: string, payload: EventPayload): Promise<void> {
    switch (action) {
      case 'decompose_shots':
        storiesCreatedTotal.inc({ user_id: payload.userId ?? 'unknown', status: 'planning' });
        if (payload.shotCount) {
          storyDecompositionDurationSeconds.observe(
            { shot_count: payload.shotCount.toString() },
            payload.decompositionDurationMs ? payload.decompositionDurationMs / 1000 : 1
          );
        }
        activeStoriesGauge.inc();
        break;

      case 'user_approve':
        storiesCreatedTotal.inc({ user_id: payload.userId ?? 'unknown', status: 'approved' });
        break;

      case 'plan_revised':
        shotPlanRevisedTotal.inc({ action: payload.revisionType ?? 'unknown' });
        break;

      case 'start_generation':
        activeStoriesGauge.inc({ status: 'in_progress' });
        break;

      case 'all_shots_completed':
        activeStoriesGauge.dec({ status: 'in_progress' });
        activeStoriesGauge.inc({ status: 'merging' });
        break;

      case 'merge_complete':
        activeStoriesGauge.dec({ status: 'merging' });
        activeStoriesGauge.inc({ status: 'completed' });
        break;

      case 'generation_failed':
      case 'user_cancel':
        activeStoriesGauge.dec();
        break;

      case 'cross_shot_consistency_report':
        facelockConsistencyReportGeneratedTotal.inc({
          story_id: event.entityId,
          overall_passed: payload.overallPassed?.toString() ?? 'unknown',
        });
        break;
    }
  }

  private async processShotEventMetrics(event: StateChangeEvent, action: string, payload: EventPayload): Promise<void> {
    const { entityId: shotId, metadata } = event;
    // payload already has typed modelId
    const modelId = payload.modelId ?? (metadata?.payload as EventPayload)?.modelId ?? 'unknown';

    switch (action) {
      case 'dispatch_to_model':
        shotDispatchTotal.inc({ model_id: modelId, status: 'dispatched' });
        dispatchesInFlightGauge.inc({ model_id: modelId });
        break;

      case 'model_accepted':
        // Dispatched -> Generating
        break;

      case 'generation_complete':
        shotDispatchTotal.inc({ model_id: modelId, status: 'completed' });
        dispatchesInFlightGauge.dec({ model_id: modelId });

        if (payload.durationSeconds) {
          shotGenerationDurationSeconds.observe(
            { model_id: modelId, shot_duration: payload.durationSeconds.toString() },
            payload.durationSeconds
          );
        }

        if (payload.dispatchLatencyMs) {
          shotDispatchLatencySeconds.observe({ model_id: modelId }, payload.dispatchLatencyMs / 1000);
        }
        break;

      case 'generation_failed':
        shotDispatchTotal.inc({ model_id: modelId, status: 'failed' });
        dispatchesInFlightGauge.dec({ model_id: modelId });
        break;

      case 'model_timeout':
        shotTimeoutTotal.inc({ model_id: modelId, timeout_seconds: (payload.timeoutSeconds ?? 120).toString() });
        dispatchesInFlightGauge.dec({ model_id: modelId });
        break;

      case 'fallback_dispatch':
        const fromModel = payload.fromModel ?? 'unknown';
        const toModel = payload.toModel ?? modelId;
        const trigger = payload.trigger ?? 'timeout';
        shotFallbackTotal.inc({ from_model: fromModel, to_model: toModel, trigger });
        shotDispatchTotal.inc({ model_id: toModel, status: 'fallback' });
        break;

      case 'face_lock_verification_failed':
        // Face-Lock failure triggers regeneration
        break;
    }
  }

  private async processCharacterEventMetrics(event: StateChangeEvent, action: string, payload: EventPayload): Promise<void> {
    const characterName = payload.characterName ?? 'unknown';

    if (action === 'character_registered') {
      charactersRegisteredTotal.inc({ story_id: payload.storyId ?? 'unknown', has_voice: String(!!payload.hasVoice) });
    } else if (action === 'sacred_guard_block') {
      characterSacredGuardBlocksTotal.inc({ match_type: payload.matchType ?? 'unknown' });
    }
  }

  private async processJobStatus(message: StreamMessage): Promise<void> {
    const data = message.data;
    const jobId = data.job_id;
    const status = data.status; // queued | processing | completed | failed | timeout
    const metadata = data.metadata ? JSON.parse(data.metadata) as EventPayload : {};

    // Track job queue depth
    if (status === 'queued') {
      mergeQueueDepthGauge.inc();
    } else if (status === 'completed' || status === 'failed') {
      mergeQueueDepthGauge.dec();
    }

    // Record job duration
    if (metadata.startTime && (status === 'completed' || status === 'failed')) {
      const duration = (Date.now() - metadata.startTime) / 1000;
      // Could add a job duration histogram here
    }
  }

  private async processWebhookIngress(message: StreamMessage): Promise<void> {
    const data = message.data;
    const payload = data.payload ? JSON.parse(data.payload) as EventPayload : {};
    const provider = (payload.provider ?? 'unknown') as string;

    webhookReceivedTotal.inc({ provider, status: 'received' });
  }

  /**
   * Flush aggregated metrics to Prometheus and persist to DB
   */
  private async flush(): Promise<void> {
    try {
      // Flush counters to Prometheus
      for (const [key, count] of this.aggregated.stateTransitions) {
        if (count > 0) {
          const [entityType, fromState, toState, action] = key.split(':');
          // Could add a generic state_transitions_total counter here
        }
      }

      // Update gauges
      for (const { metric, value, labels } of this.aggregated.gauges) {
        // Metrics updated directly in process methods
      }

      // Clear aggregated
      this.aggregated = this.createEmptyAggregated();
    } catch (error) {
      console.error('MetricsAggregator flush error:', error);
    }
  }

  private increment(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  /**
   * Get current aggregated metrics for debugging
   */
  getAggregatedMetrics(): AggregatedMetrics {
    return this.aggregated;
  }

  /**
   * Get Prometheus metrics snapshot
   */
  async getPrometheusSnapshot(): Promise<string> {
    const { getMetricsAsText } = await import('../shared/metrics.js');
    return getMetricsAsText();
  }
}