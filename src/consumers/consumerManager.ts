/**
 * Consumer Manager
 * Orchestrates all Phase 7 consumers with graceful startup/shutdown
 * Handles lifecycle, health checks, and coordination
 * Implements FR-031, FR-032, FR-033, FR-034, NFR-004, NFR-005
 */

import { BaseConsumer, ConsumerOptions, ConsumerStats } from './baseConsumer.js';
import { MetricsAggregatorConsumer, MetricsAggregatorOptions } from './metricsAggregator.js';
import { AlertEvaluatorConsumer, AlertEvaluatorOptions } from './alertEvaluator.js';
import { AuditArchiverConsumer, AuditArchiverOptions } from './auditArchiver.js';
import { DashboardUpdaterConsumer, DashboardUpdaterOptions } from './dashboardUpdater.js';
import { CommandHandlerConsumer, CommandHandlerOptions } from './commandHandler.js';
import { query } from '../shared/db.js';
import { config } from '../shared/config.js';
import { CONSUMER_GROUPS, STREAMS } from '../shared/redis.js';

export interface ConsumerManagerOptions {
  /** Metrics Aggregator options */
  metricsAggregator?: MetricsAggregatorOptions | false;
  /** Alert Evaluator options */
  alertEvaluator?: AlertEvaluatorOptions | false;
  /** Audit Archiver options */
  auditArchiver?: AuditArchiverOptions | false;
  /** Dashboard Updater options */
  dashboardUpdater?: DashboardUpdaterOptions | false;
  /** Command Handler options */
  commandHandler?: CommandHandlerOptions | false;
  /** Health check interval (ms) */
  healthCheckIntervalMs?: number;
  /** Graceful shutdown timeout (ms) */
  shutdownTimeoutMs?: number;
}

export interface ConsumerHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'stopped';
  stats: ConsumerStats;
  lastCheck: Date;
  error?: string;
}

export class ConsumerManager {
  private readonly options: Required<ConsumerManagerOptions>;
  private consumers: Map<string, BaseConsumer> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private startupTime: Date | null = null;

  constructor(options: ConsumerManagerOptions = {}) {
    this.options = {
      metricsAggregator: options.metricsAggregator ?? false,
      alertEvaluator: options.alertEvaluator ?? false,
      auditArchiver: options.auditArchiver ?? false,
      dashboardUpdater: options.dashboardUpdater ?? false,
      commandHandler: options.commandHandler ?? false,
      healthCheckIntervalMs: options.healthCheckIntervalMs ?? 30000,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 30000,
    };
  }

  /**
   * Initialize and start all consumers
   */
  async start(): Promise<void> {
    if (this.startupTime) {
      console.warn('ConsumerManager already started');
      return;
    }

    this.startupTime = new Date();
    console.log('Starting ConsumerManager...');

    // Create consumers
    await this.createConsumers();

    // Start all consumers sequentially to avoid Redis connection races
    for (const [name, consumer] of this.consumers.entries()) {
      try {
        console.log(`Starting consumer: ${name}`);
        await consumer.start();
        console.log(`Consumer ${name} started successfully`);
      } catch (error) {
        console.error(`Failed to start consumer ${name}:`, error);
        throw error;
      }
    }

    // Start health checks
    this.startHealthChecks();

    console.log('All consumers started successfully');
  }

  /**
   * Create consumer instances based on configuration
   */
  private async createConsumers(): Promise<void> {
    const consumerId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Metrics Aggregator
    if (this.options.metricsAggregator !== false) {
      const opts = this.options.metricsAggregator as MetricsAggregatorOptions;
      const consumer = new MetricsAggregatorConsumer({
        groupName: CONSUMER_GROUPS.METRICS_AGGREGATOR,
        consumerName: `metrics-aggregator-${consumerId()}`,
        stream: STREAMS.STORY_EVENTS,
        count: opts.count,
        blockMs: opts.blockMs,
        minIdleTimeMs: opts.minIdleTimeMs,
        claimCount: opts.claimCount,
        claimStalled: opts.claimStalled,
        flushIntervalMs: opts.flushIntervalMs,
      });
      this.consumers.set('metricsAggregator', consumer);
    }

    // Alert Evaluator
    if (this.options.alertEvaluator !== false) {
      const opts = this.options.alertEvaluator as AlertEvaluatorOptions;
      const consumer = new AlertEvaluatorConsumer({
        groupName: CONSUMER_GROUPS.ALERT_EVALUATOR,
        consumerName: `alert-evaluator-${consumerId()}`,
        stream: STREAMS.STORY_EVENTS,
        count: opts.count,
        blockMs: opts.blockMs,
        minIdleTimeMs: opts.minIdleTimeMs,
        claimCount: opts.claimCount,
        claimStalled: opts.claimStalled,
        alertWebhookUrl: opts.alertWebhookUrl,
        customRules: opts.customRules,
        dedupWindowMs: opts.dedupWindowMs,
      });
      this.consumers.set('alertEvaluator', consumer);
    }

    // Audit Archiver
    if (this.options.auditArchiver !== false) {
      const opts = this.options.auditArchiver as AuditArchiverOptions;
      const consumer = new AuditArchiverConsumer({
        groupName: CONSUMER_GROUPS.AUDIT_ARCHIVER,
        consumerName: `audit-archiver-${consumerId()}`,
        stream: STREAMS.STORY_EVENTS,
        count: opts.count,
        blockMs: opts.blockMs,
        minIdleTimeMs: opts.minIdleTimeMs,
        claimCount: opts.claimCount,
        claimStalled: opts.claimStalled,
        storageBackend: opts.storageBackend,
        bucketName: opts.bucketName,
        prefix: opts.prefix,
        batchSize: opts.batchSize,
        flushIntervalMs: opts.flushIntervalMs,
        compression: opts.compression,
        encryptionKey: opts.encryptionKey,
        localPath: opts.localPath,
      });
      this.consumers.set('auditArchiver', consumer);
    }

    // Dashboard Updater
    if (this.options.dashboardUpdater !== false) {
      const opts = this.options.dashboardUpdater as DashboardUpdaterOptions;
      const consumer = new DashboardUpdaterConsumer({
        groupName: CONSUMER_GROUPS.DASHBOARD_UPDATER,
        consumerName: `dashboard-updater-${consumerId()}`,
        stream: STREAMS.STORY_EVENTS,
        count: opts.count,
        blockMs: opts.blockMs,
        minIdleTimeMs: opts.minIdleTimeMs,
        claimCount: opts.claimCount,
        claimStalled: opts.claimStalled,
        refreshIntervalMs: opts.refreshIntervalMs,
        realtime: opts.realtime,
      });
      this.consumers.set('dashboardUpdater', consumer);
    }

    // Command Handler
    if (this.options.commandHandler !== false) {
      const opts = this.options.commandHandler as CommandHandlerOptions;
      const consumer = new CommandHandlerConsumer({
        consumerName: `command-handler-${consumerId()}`,
        count: opts.count,
        blockMs: opts.blockMs,
        minIdleTimeMs: opts.minIdleTimeMs,
        claimCount: opts.claimCount,
        claimStalled: opts.claimStalled,
        maxConcurrentDispatches: opts.maxConcurrentDispatches,
        defaultTimeoutSeconds: opts.defaultTimeoutSeconds,
      });
      this.consumers.set('commandHandler', consumer);
    }
  }

  /**
   * Stop all consumers gracefully
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) {
      console.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    console.log('Initiating graceful shutdown...');

    // Stop health checks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Stop all consumers with timeout
    const stopPromises = Array.from(this.consumers.entries()).map(
      async ([name, consumer]) => {
        try {
          console.log(`Stopping consumer: ${name}`);
          const stopPromise = consumer.stop();
          const timeoutPromise = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Shutdown timeout')), this.options.shutdownTimeoutMs)
          );
          await Promise.race([stopPromise, timeoutPromise]);
          console.log(`Consumer ${name} stopped`);
        } catch (error) {
          console.error(`Error stopping consumer ${name}:`, error);
        }
      }
    );

    await Promise.all(stopPromises);
    this.consumers.clear();

    console.log('All consumers stopped. Shutdown complete.');
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      if (this.isShuttingDown) return;

      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Health check failed:', error);
      }
    }, this.options.healthCheckIntervalMs);

    this.healthCheckTimer.unref();
  }

  /**
   * Perform health check on all consumers
   */
  private async performHealthCheck(): Promise<void> {
    const checks = await Promise.all(
      Array.from(this.consumers.entries()).map(async ([name, consumer]) => {
        const stats = consumer.getStats();
        let status: ConsumerHealth['status'] = 'healthy';

        // Check if consumer is running
        if (!stats.isRunning) {
          status = 'stopped';
        } else if (stats.messagesFailed > stats.messagesProcessed * 0.1 && stats.messagesProcessed > 100) {
          // >10% failure rate after 100 messages
          status = 'degraded';
        } else if (stats.lastError && Date.now() - new Date(stats.lastProcessedAt || 0).getTime() > 60000) {
          // No messages processed in 60 seconds with recent error
          status = 'degraded';
        }

        // Persist health metric
        await query(
          `INSERT INTO health_metrics (component, status, latency_ms, details)
           VALUES ($1, $2, $3, $4)`,
          [
            `consumer:${name}`,
            status,
            null,
            JSON.stringify({
              messagesProcessed: stats.messagesProcessed,
              messagesFailed: stats.messagesFailed,
              uptimeMs: stats.uptimeMs,
              lastError: stats.lastError,
            }),
          ]
        );

        return {
          name,
          status,
          stats,
          lastCheck: new Date(),
        } as ConsumerHealth;
      })
    );

    // Log degraded/unhealthy consumers
    for (const check of checks) {
      if (check.status !== 'healthy') {
        console.warn(`Consumer ${check.name} health: ${check.status}`, check.stats);
      }
    }
  }

  /**
   * Get health status of all consumers
   */
  async getHealth(): Promise<ConsumerHealth[]> {
    return Promise.all(
      Array.from(this.consumers.entries()).map(async ([name, consumer]) => {
        const stats = consumer.getStats();
        let status: ConsumerHealth['status'] = 'healthy';

        if (!stats.isRunning) {
          status = 'stopped';
        } else if (stats.messagesFailed > stats.messagesProcessed * 0.1 && stats.messagesProcessed > 100) {
          status = 'degraded';
        } else if (stats.lastError && Date.now() - new Date(stats.lastProcessedAt || 0).getTime() > 60000) {
          status = 'degraded';
        }

        return {
          name,
          status,
          stats,
          lastCheck: new Date(),
        };
      })
    );
  }

  /**
   * Get combined stats from all consumers
   */
  getAllStats(): Map<string, ConsumerStats> {
    const stats = new Map<string, ConsumerStats>();
    for (const [name, consumer] of this.consumers) {
      stats.set(name, consumer.getStats());
    }
    return stats;
  }

  /**
   * Restart a specific consumer
   */
  async restartConsumer(name: string): Promise<void> {
    const consumer = this.consumers.get(name);
    if (!consumer) {
      throw new Error(`Consumer ${name} not found`);
    }

    console.log(`Restarting consumer: ${name}`);
    await consumer.stop();
    await consumer.start();
    console.log(`Consumer ${name} restarted`);
  }

  /**
   * Get a specific consumer by name
   */
  getConsumer<T extends BaseConsumer>(name: string): T | undefined {
    return this.consumers.get(name) as T | undefined;
  }

  /**
   * Get uptime of the manager
   */
  getUptime(): number {
    return this.startupTime ? Date.now() - this.startupTime.getTime() : 0;
  }

  /**
   * Perform graceful shutdown on process signals
   */
  setupSignalHandlers(): void {
    // Signal handlers are set up in main.ts
  }
}

/**
 * Factory function to create a fully configured ConsumerManager
 */
export function createConsumerManager(overrides: Partial<ConsumerManagerOptions> = {}): ConsumerManager {
  const defaultMetricsAggregator: MetricsAggregatorOptions = {
    count: 100,
    blockMs: 5000,
    flushIntervalMs: 10000,
    groupName: '',
    consumerName: '',
    stream: '',
  };

  const defaultAlertEvaluator: AlertEvaluatorOptions = {
    count: 50,
    blockMs: 5000,
    alertWebhookUrl: config.observability?.alertmanager?.webhookUrl,
    customRules: undefined,
    dedupWindowMs: 300000,
    groupName: '',
    consumerName: '',
    stream: '',
  };

  const defaultAuditArchiver: AuditArchiverOptions = {
    storageBackend: (config.observability?.archive?.backend as 's3' | 'gcs' | 'local') || 'local',
    bucketName: config.observability?.archive?.bucket || 'ai-video-fte-archive',
    prefix: 'story-events',
    batchSize: 1000,
    flushIntervalMs: 30000,
    compression: 'gzip',
    localPath: config.observability?.archive?.localPath || './data/archive',
    groupName: '',
    consumerName: '',
    stream: '',
  };

  const defaultDashboardUpdater: DashboardUpdaterOptions = {
    count: 500,
    blockMs: 1000,
    refreshIntervalMs: 5000,
    realtime: true,
    groupName: '',
    consumerName: '',
    stream: '',
  };

  const defaultCommandHandler: CommandHandlerOptions = {
    count: 10,
    blockMs: 5000,
    minIdleTimeMs: 60000,
    claimCount: 10,
    claimStalled: true,
    maxConcurrentDispatches: 3,
    defaultTimeoutSeconds: 600,
    consumerName: '',
  };

  const options: ConsumerManagerOptions = {
    metricsAggregator: overrides.metricsAggregator === false ? false : {
      ...defaultMetricsAggregator,
      ...(overrides.metricsAggregator ?? {}),
    },
    alertEvaluator: overrides.alertEvaluator === false ? false : {
      ...defaultAlertEvaluator,
      ...(overrides.alertEvaluator ?? {}),
    },
    auditArchiver: overrides.auditArchiver === false ? false : {
      ...defaultAuditArchiver,
      ...(overrides.auditArchiver ?? {}),
    },
    dashboardUpdater: overrides.dashboardUpdater === false ? false : {
      ...defaultDashboardUpdater,
      ...(overrides.dashboardUpdater ?? {}),
    },
    commandHandler: overrides.commandHandler === false ? false : {
      ...defaultCommandHandler,
      ...(overrides.commandHandler ?? {}),
    },
    healthCheckIntervalMs: overrides.healthCheckIntervalMs ?? 30000,
    shutdownTimeoutMs: overrides.shutdownTimeoutMs ?? 30000,
  };

  return new ConsumerManager(options);
}