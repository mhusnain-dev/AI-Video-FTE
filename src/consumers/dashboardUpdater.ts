/**
 * Dashboard Updater Consumer
 * Consumes story_events, job_status, webhook_ingress streams
 * Maintains materialized views for Grafana dashboards
 * Implements FR-033, NFR-004, NFR-005
 */

import { BaseConsumer, ConsumerOptions } from './baseConsumer.js';
import { query } from '../shared/db.js';
import type { StreamMessage, StateChangeEvent } from '../shared/types.js';
import { STREAMS } from '../shared/redis.js';

// Payload type for StateChangeEvent metadata
interface EventPayload {
  modelId?: string;
  characterName?: string;
  storyId?: string;
  hasVoice?: boolean;
  shotCount?: number;
  decompositionDurationMs?: number;
  userId?: string;
  revisionType?: string;
  durationSeconds?: number;
  dispatchLatencyMs?: number;
  timeoutSeconds?: number;
  fromModel?: string;
  toModel?: string;
  trigger?: string;
  overallPassed?: boolean;
  overallDriftDetected?: boolean;
  [key: string]: unknown;
}

export interface DashboardUpdaterOptions extends ConsumerOptions {
  /** Refresh interval for materialized views (ms) */
  refreshIntervalMs?: number;
  /** Whether to enable real-time updates */
  realtime?: boolean;
}

export interface MaterializedView {
  name: string;
  query: string;
  lastRefreshed: Date | null;
}

interface ViewState {
  storyStates: Map<string, { state: string; updatedAt: Date }>;
  shotStates: Map<string, { state: string; modelId: string; updatedAt: Date }>;
  characterStates: Map<string, { registered: boolean; hasVoice: boolean; updatedAt: Date }>;
  activeStoriesCount: number;
  activeShotsCount: number;
  pendingMergesCount: number;
  webhookCounts: Map<string, { received: number; unrecognized: number }>;
}

export class DashboardUpdaterConsumer extends BaseConsumer {
  private readonly refreshIntervalMs: number;
  private readonly realtime: boolean;
  private viewState: ViewState;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(options: DashboardUpdaterOptions) {
    super({
      ...options,
      groupName: options.groupName,
      consumerName: options.consumerName,
      stream: options.stream,
      count: options.count ?? 500,
      blockMs: options.blockMs ?? 1000,
    });

    this.refreshIntervalMs = options.refreshIntervalMs ?? 5000;
    this.realtime = options.realtime ?? true;

    this.viewState = {
      storyStates: new Map(),
      shotStates: new Map(),
      characterStates: new Map(),
      activeStoriesCount: 0,
      activeShotsCount: 0,
      pendingMergesCount: 0,
      webhookCounts: new Map(),
    };
  }

  async start(): Promise<void> {
    await super.start();

    // Load initial state from database
    await this.loadInitialState();

    // Start periodic refresh of materialized views
    if (this.realtime) {
      this.refreshTimer = setInterval(() => this.refreshViews(), this.refreshIntervalMs);
      this.refreshTimer.unref();
    }

    console.log('Dashboard Updater started');
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    await super.stop();
  }

  protected async processMessage(message: StreamMessage): Promise<void> {
    if (message.stream === STREAMS.STORY_EVENTS) {
      const event = this.parseStateChangeEvent(message);
      if (event) {
        this.updateViewState(event);
      }
    } else if (message.stream === STREAMS.JOB_STATUS) {
      this.processJobStatus(message);
    } else if (message.stream === STREAMS.WEBHOOK_INGRESS) {
      this.processWebhookIngress(message);
    }
  }

  private async loadInitialState(): Promise<void> {
    try {
      // Load recent story states
      const stories = await query(
        `SELECT id, status, updated_at FROM stories WHERE updated_at > NOW() - INTERVAL '24 hours'`
      );
      for (const row of stories.rows) {
        this.viewState.storyStates.set(row.id, {
          state: row.status,
          updatedAt: new Date(row.updated_at),
        });
      }

      // Load recent shot states
      const shots = await query(
        `SELECT id, status, model_id, updated_at FROM shots WHERE updated_at > NOW() - INTERVAL '24 hours'`
      );
      for (const row of shots.rows) {
        this.viewState.shotStates.set(row.id, {
          state: row.status,
          modelId: row.model_id,
          updatedAt: new Date(row.updated_at),
        });
      }

      // Count active stories/shots
      const counts = await query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('planning', 'approved', 'in_progress', 'merging')) as active_stories,
           COUNT(*) FILTER (WHERE status IN ('dispatched', 'generating')) as active_shots,
           COUNT(*) FILTER (WHERE status = 'pending_merge') as pending_merges
         FROM stories`
      );
      this.viewState.activeStoriesCount = parseInt(counts.rows[0].active_stories) || 0;
      this.viewState.activeShotsCount = parseInt(counts.rows[0].active_shots) || 0;
      this.viewState.pendingMergesCount = parseInt(counts.rows[0].pending_merges) || 0;

      // Load webhook counts
      const webhooks = await query(
        `SELECT provider, COUNT(*) as cnt FROM dispatch_records
         WHERE dispatched_at > NOW() - INTERVAL '1 hour'
         GROUP BY provider`
      );
      for (const row of webhooks.rows) {
        this.viewState.webhookCounts.set(row.provider, { received: parseInt(row.cnt), unrecognized: 0 });
      }

      const unrecognized = await query(
        `SELECT provider, COUNT(*) as cnt FROM webhook_unrecognized_log
         WHERE received_at > NOW() - INTERVAL '1 hour'
         GROUP BY provider`
      );
      for (const row of unrecognized.rows) {
        const existing = this.viewState.webhookCounts.get(row.provider) || { received: 0, unrecognized: 0 };
        existing.unrecognized = parseInt(row.cnt);
      }

      console.log(`Loaded initial state: ${this.viewState.storyStates.size} stories, ${this.viewState.shotStates.size} shots`);
    } catch (error) {
      console.error('Failed to load initial dashboard state:', error);
    }
  }

  private updateViewState(event: StateChangeEvent): void {
    const now = new Date();

    switch (event.entityType) {
      case 'story':
        this.updateStoryState(event, now);
        break;
      case 'shot':
        this.updateShotState(event, now);
        break;
      case 'character':
        this.updateCharacterState(event, now);
        break;
    }
  }

  private updateStoryState(event: StateChangeEvent, now: Date): void {
    const prev = this.viewState.storyStates.get(event.entityId);
    const prevState = prev?.state;

    this.viewState.storyStates.set(event.entityId, { state: event.toState, updatedAt: now });

    // Update active stories count
    const wasActive = ['planning', 'approved', 'in_progress', 'merging'].includes(prevState ?? '');
    const isActive = ['planning', 'approved', 'in_progress', 'merging'].includes(event.toState);

    if (wasActive && !isActive) {
      this.viewState.activeStoriesCount = Math.max(0, this.viewState.activeStoriesCount - 1);
    } else if (!wasActive && isActive) {
      this.viewState.activeStoriesCount++;
    }

    // Track pending merges
    if (event.toState === 'pending_merge') {
      this.viewState.pendingMergesCount++;
    } else if (prevState === 'pending_merge' && event.toState !== 'pending_merge') {
      this.viewState.pendingMergesCount = Math.max(0, this.viewState.pendingMergesCount - 1);
    }
  }

  private updateShotState(event: StateChangeEvent, now: Date): void {
    const prev = this.viewState.shotStates.get(event.entityId);
    const prevState = prev?.state;
    const payload = event.metadata?.payload as EventPayload | undefined;
    const modelId = payload?.modelId ?? prev?.modelId ?? 'unknown';

    this.viewState.shotStates.set(event.entityId, { state: event.toState, modelId, updatedAt: now });

    // Update active shots count
    const wasActive = ['dispatched', 'generating'].includes(prevState ?? '');
    const isActive = ['dispatched', 'generating'].includes(event.toState);

    if (wasActive && !isActive) {
      this.viewState.activeShotsCount = Math.max(0, this.viewState.activeShotsCount - 1);
    } else if (!wasActive && isActive) {
      this.viewState.activeShotsCount++;
    }
  }

  private updateCharacterState(event: StateChangeEvent, now: Date): void {
    const payload = event.metadata?.payload as EventPayload | undefined;
    const characterName = payload?.characterName ?? event.entityId;
    const storyId = payload?.storyId;

    if (event.metadata?.action === 'character_registered') {
      this.viewState.characterStates.set(`${storyId}:${characterName}`, {
        registered: true,
        hasVoice: !!payload?.hasVoice,
        updatedAt: now,
      });
    }
  }

  private processJobStatus(message: StreamMessage): void {
    const data = message.data;
    const status = data.status;

    if (status === 'queued' || status === 'processing') {
      this.viewState.pendingMergesCount++;
    } else if (status === 'completed' || status === 'failed') {
      this.viewState.pendingMergesCount = Math.max(0, this.viewState.pendingMergesCount - 1);
    }
  }

  private processWebhookIngress(message: StreamMessage): void {
    const data = message.data;
    const payload = data.payload ? JSON.parse(data.payload) : {};
    const provider = payload.provider ?? 'unknown';

    const existing = this.viewState.webhookCounts.get(provider) || { received: 0, unrecognized: 0 };
    existing.received++;
    this.viewState.webhookCounts.set(provider, existing);
  }

  /**
   * Refresh materialized views in database
   */
  private async refreshViews(): Promise<void> {
    try {
      // Refresh story state summary view
      await this.refreshStoryStateSummary();

      // Refresh shot state summary view
      await this.refreshShotStateSummary();

      // Refresh cost summary view
      await this.refreshCostSummary();

      // Refresh provider health view
      await this.refreshProviderHealth();

      // Refresh Face-Lock metrics view
      await this.refreshFaceLockMetrics();

      // Refresh queue depth view
      await this.refreshQueueDepth();

    } catch (error) {
      console.error('Dashboard view refresh failed:', error);
    }
  }

  private async refreshStoryStateSummary(): Promise<void> {
    // Materialized view: story_state_summary
    await query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS story_state_summary AS
      SELECT
        status,
        COUNT(*) as story_count,
        MAX(updated_at) as last_update
      FROM stories
      WHERE updated_at > NOW() - INTERVAL '24 hours'
      GROUP BY status
    `);

    await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY story_state_summary`);
  }

  private async refreshShotStateSummary(): Promise<void> {
    // Materialized view: shot_state_summary
    await query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS shot_state_summary AS
      SELECT
        s.status,
        s.model_id,
        COUNT(*) as shot_count,
        AVG(EXTRACT(EPOCH FROM (s.completed_at - s.created_at))) as avg_duration_seconds
      FROM shots s
      WHERE s.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY s.status, s.model_id
    `);

    await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY shot_state_summary`);
  }

  private async refreshCostSummary(): Promise<void> {
    // Materialized view: cost_summary_hourly
    await query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS cost_summary_hourly AS
      SELECT
        DATE_TRUNC('hour', created_at) as hour,
        model_id,
        cost_type,
        SUM(amount_usd) as total_cost_usd,
        COUNT(*) as transaction_count
      FROM cost_records
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('hour', created_at), model_id, cost_type
    `);

    await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY cost_summary_hourly`);
  }

  private async refreshProviderHealth(): Promise<void> {
    // Materialized view: provider_health
    await query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS provider_health AS
      SELECT
        provider,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'timeout') as timeouts,
        AVG(EXTRACT(EPOCH FROM (completed_at - dispatched_at))) as avg_latency_seconds
      FROM dispatch_records
      WHERE dispatched_at > NOW() - INTERVAL '1 hour'
      GROUP BY provider
    `);

    await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY provider_health`);
  }

  private async refreshFaceLockMetrics(): Promise<void> {
    // Materialized view: facelock_metrics
    await query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS facelock_metrics AS
      SELECT
        story_id,
        model_id,
        AVG(similarity_score) as avg_similarity,
        COUNT(*) FILTER (WHERE passed) as passed_count,
        COUNT(*) FILTER (WHERE NOT passed) as failed_count,
        MAX(retry_count) as max_retries
      FROM face_lock_verifications
      WHERE verified_at > NOW() - INTERVAL '1 hour'
      GROUP BY story_id, model_id
    `);

    await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY facelock_metrics`);
  }

  private async refreshQueueDepth(): Promise<void> {
    // Materialized view: queue_depth
    await query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS queue_depth AS
      SELECT
        'dispatch' as queue_type,
        COUNT(*) FILTER (WHERE status = 'dispatched') as pending
      FROM dispatch_records
      WHERE dispatched_at > NOW() - INTERVAL '1 hour'
      UNION ALL
      SELECT
        'merge' as queue_type,
        COUNT(*) FILTER (WHERE status = 'pending_merge') as pending
      FROM stories
      WHERE updated_at > NOW() - INTERVAL '1 hour'
    `);

    await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY queue_depth`);
  }

  /**
   * Get current dashboard state for Prometheus / scraping
   */
  getDashboardState(): {
    activeStories: number;
    activeShots: number;
    pendingMerges: number;
    storyStates: Record<string, number>;
    shotStates: Record<string, number>;
    webhookCounts: Record<string, { received: number; unrecognized: number }>;
  } {
    const storyStates: Record<string, number> = {};
    for (const [_, { state }] of this.viewState.storyStates) {
      storyStates[state] = (storyStates[state] || 0) + 1;
    }

    const shotStates: Record<string, number> = {};
    for (const [_, { state }] of this.viewState.shotStates) {
      shotStates[state] = (shotStates[state] || 0) + 1;
    }

    const webhookCounts: Record<string, { received: number; unrecognized: number }> = {};
    for (const [provider, counts] of this.viewState.webhookCounts) {
      webhookCounts[provider] = counts;
    }

    return {
      activeStories: this.viewState.activeStoriesCount,
      activeShots: this.viewState.activeShotsCount,
      pendingMerges: this.viewState.pendingMergesCount,
      storyStates,
      shotStates,
      webhookCounts,
    };
  }
}