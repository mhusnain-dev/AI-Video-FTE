/**
 * Base Consumer for Redis Streams
 * Implements common patterns for all Phase 7 consumers
 * Implements FR-031, FR-032, FR-034, NFR-004, NFR-005
 */

import { getRedis, ensureRedisConnected, consumeStream, acknowledgeMessage, claimStalledMessages } from '../shared/redis.js';
import { query } from '../shared/db.js';
import type { StreamMessage, StateChangeEvent } from '../shared/types.js';

export interface ConsumerOptions {
  /** Consumer group name (from CONSUMER_GROUPS) */
  groupName: string;
  /** Unique consumer name suffix */
  consumerName: string;
  /** Stream to consume from */
  stream: string;
  /** Max messages per batch */
  count?: number;
  /** Block timeout in ms */
  blockMs?: number;
  /** Min idle time for claiming stalled messages (ms) */
  minIdleTimeMs?: number;
  /** Max stalled messages to claim */
  claimCount?: number;
  /** Whether to claim stalled messages on each cycle */
  claimStalled?: boolean;
}

export interface ConsumerStats {
  messagesProcessed: number;
  messagesFailed: number;
  lastProcessedAt: Date | null;
  lastError: string | null;
  isRunning: boolean;
  uptimeMs: number;
}

export abstract class BaseConsumer {
  protected readonly options: Required<ConsumerOptions>;
  protected readonly stats: ConsumerStats;
  protected readonly startTime: number;
  protected running = false;
  protected intervalId: NodeJS.Timeout | null = null;

  constructor(options: ConsumerOptions) {
    this.options = {
      groupName: options.groupName,
      consumerName: options.consumerName,
      stream: options.stream,
      count: options.count ?? 100,
      blockMs: options.blockMs ?? 5000,
      minIdleTimeMs: options.minIdleTimeMs ?? 60000, // 1 minute default
      claimCount: options.claimCount ?? 10,
      claimStalled: options.claimStalled ?? true,
    };

    this.stats = {
      messagesProcessed: 0,
      messagesFailed: 0,
      lastProcessedAt: null,
      lastError: null,
      isRunning: false,
      uptimeMs: 0,
    };

    this.startTime = Date.now();
  }

  /**
   * Start the consumer loop
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn(`Consumer ${this.options.consumerName} already running`);
      return;
    }

    this.running = true;
    this.stats.isRunning = true;
    console.log(`Starting consumer: ${this.options.consumerName} on stream ${this.options.stream}`);

    // Ensure streams and consumer groups exist
    const redis = getRedis();
    await ensureRedisConnected();

    // Run consumer loop
    this.runLoop();
  }

  /**
   * Stop the consumer loop
   */
  async stop(): Promise<void> {
    this.running = false;
    this.stats.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log(`Stopped consumer: ${this.options.consumerName}`);
  }

  /**
   * Main consumer loop
   */
  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.processBatch();
      } catch (error) {
        this.stats.messagesFailed++;
        this.stats.lastError = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Consumer ${this.options.consumerName} error:`, error);

        // Brief pause before retrying
        await this.sleep(1000);
      }
    }
  }

  /**
   * Process a batch of messages
   */
  private async processBatch(): Promise<void> {
    const messages = await consumeStream(
      this.options.stream,
      this.options.groupName,
      this.options.consumerName,
      this.options.count,
      this.options.blockMs
    );

    if (messages.length === 0) {
      // No messages, maybe claim stalled
      if (this.options.claimStalled) {
        await this.claimStalledMessages();
      }
      return;
    }

    // Process each message
    for (const message of messages) {
      try {
        await this.processMessage(message);
        await acknowledgeMessage(this.options.stream, this.options.groupName, message.id);
        this.stats.messagesProcessed++;
        this.stats.lastProcessedAt = new Date();
      } catch (error) {
        this.stats.messagesFailed++;
        this.stats.lastError = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to process message ${message.id}:`, error);
        // Don't acknowledge - will be redelivered or claimed by another consumer
      }
    }

    // Update uptime
    this.stats.uptimeMs = Date.now() - this.startTime;

    // Claim stalled messages periodically
    if (this.options.claimStalled && Math.random() < 0.1) { // ~10% of cycles
      await this.claimStalledMessages();
    }
  }

  /**
   * Claim stalled messages that have been idle too long
   */
  private async claimStalledMessages(): Promise<void> {
    try {
      const claimed = await claimStalledMessages(
        this.options.stream,
        this.options.groupName,
        this.options.consumerName,
        this.options.minIdleTimeMs,
        this.options.claimCount
      );

      for (const message of claimed) {
        try {
          await this.processMessage(message);
          await acknowledgeMessage(this.options.stream, this.options.groupName, message.id);
          this.stats.messagesProcessed++;
          this.stats.lastProcessedAt = new Date();
        } catch (error) {
          this.stats.messagesFailed++;
          this.stats.lastError = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Failed to process claimed message ${message.id}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Claim stalled failed for ${this.options.consumerName}:`, error);
    }
  }

  /**
   * Process a single message - must be implemented by subclasses
   */
  protected abstract processMessage(message: StreamMessage): Promise<void>;

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get consumer statistics
   */
  getStats(): ConsumerStats {
    return { ...this.stats, uptimeMs: Date.now() - this.startTime };
  }

  /**
   * Parse StateChangeEvent from stream message
   */
  protected parseStateChangeEvent(message: StreamMessage): StateChangeEvent | null {
    try {
      const eventData = message.data.event;
      if (!eventData) {
        console.warn(`Message ${message.id} missing event field`);
        return null;
      }
      return JSON.parse(eventData) as StateChangeEvent;
    } catch (error) {
      console.error(`Failed to parse StateChangeEvent from message ${message.id}:`, error);
      return null;
    }
  }

  /**
   * Persist health metric to database
   */
  protected async persistHealthMetric(
    component: string,
    status: 'healthy' | 'degraded' | 'unhealthy',
    latencyMs?: number,
    details: Record<string, any> = {}
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO health_metrics (component, status, latency_ms, details)
         VALUES ($1, $2, $3, $4)`,
        [component, status, latencyMs ?? null, JSON.stringify(details)]
      );
    } catch (error) {
      console.error(`Failed to persist health metric for ${component}:`, error);
    }
  }

  /**
   * Extract trace context from message
   */
  protected extractTraceContext(message: StreamMessage): { traceId?: string; spanId?: string; parentSpanId?: string } {
    return {
      traceId: message.data.traceId,
      spanId: message.data.spanId,
      parentSpanId: message.data.parentSpanId,
    };
  }
}