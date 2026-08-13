/**
 * Redis Streams client for durable work queues
 * Implements: story_commands, story_events, webhook_ingress, job_status
 * Consumer groups for reliable processing (CON-004, FR-017, FR-019)
 */

import { Redis as RedisClient, type Redis as RedisType } from 'ioredis';
import { config } from './config.js';
import type { Story, ShotPlan, WebhookPayload, StateChangeEvent } from './types.js';
import { redisCommandDurationSeconds, redisConnectionGauge } from './metrics.js';

let redis: RedisType | null = null;
let subscriber: RedisType | null = null;

const STREAMS = {
  STORY_COMMANDS: 'story_commands',
  STORY_EVENTS: 'story_events',
  WEBHOOK_INGRESS: 'webhook_ingress',
  JOB_STATUS: 'job_status',
} as const;

const CONSUMER_GROUPS = {
  COMMAND_HANDLER: 'command-handler',
  EVENT_PROCESSOR: 'event-processor',
  WEBHOOK_HANDLER: 'webhook-handler',
  JOB_MONITOR: 'job-monitor',
  METRICS_AGGREGATOR: 'metrics-aggregator',
  ALERT_EVALUATOR: 'alert-evaluator',
  AUDIT_ARCHIVER: 'audit-archiver',
  DASHBOARD_UPDATER: 'dashboard-updater',
} as const;

function getRedisClient(): RedisType {
  if (!redis) {
    redis = new RedisClient({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redis.on('error', (err: Error) => {
      console.error('Redis connection error:', err);
    });

    redis.on('connect', () => {
      console.log('Redis connected');
      redisConnectionGauge.set(1);
    });

    redis.on('close', () => {
      redisConnectionGauge.set(0);
    });
  }
  return redis!;
}

export function getRedis(): RedisType {
  return getRedisClient();
}

export function getSubscriber(): RedisType {
  if (!subscriber) {
    subscriber = new RedisClient({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: 3,
    });
  }
  return subscriber!;
}

async function measureRedisCommand<T>(command: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const duration = Date.now() - start;
    redisCommandDurationSeconds.observe({ command }, duration / 1000);
  }
}

export async function initializeStreams(): Promise<void> {
  const r = getRedis();
  if (r.status !== 'ready') {
    await r.connect();
  }

  // Create consumer groups for each stream
  for (const [streamName, groupName] of Object.entries({
    [STREAMS.STORY_COMMANDS]: CONSUMER_GROUPS.COMMAND_HANDLER,
    [STREAMS.STORY_EVENTS]: CONSUMER_GROUPS.EVENT_PROCESSOR,
    [STREAMS.WEBHOOK_INGRESS]: CONSUMER_GROUPS.WEBHOOK_HANDLER,
    [STREAMS.JOB_STATUS]: CONSUMER_GROUPS.JOB_MONITOR,
  })) {
    try {
      await r.xgroup('CREATE', streamName, groupName, '0', 'MKSTREAM');
      console.log(`Created consumer group ${groupName} for ${streamName}`);
    } catch (err: any) {
      if (!err.message.includes('BUSYGROUP')) {
        throw err;
      }
      console.log(`Consumer group ${groupName} already exists for ${streamName}`);
    }
  }
}

// ============================================
// Producer Functions
// ============================================

export async function publishStoryCommand(
  command: 'create' | 'approve' | 'revise' | 'cancel' | 'regenerate_shots',
  payload: Record<string, any>
): Promise<string | null> {
  const r = getRedis();
  return measureRedisCommand('xadd', () => r.xadd(STREAMS.STORY_COMMANDS, '*', 'command', command, 'payload', JSON.stringify(payload)));
}

export async function publishStoryEvent(event: StateChangeEvent): Promise<string | null> {
  const r = getRedis();
  const fields: string[] = ['event', JSON.stringify(event)];
  if (event.traceId) fields.push('traceId', event.traceId);
  if (event.spanId) fields.push('spanId', event.spanId);
  if (event.parentSpanId) fields.push('parentSpanId', event.parentSpanId);
  return measureRedisCommand('xadd', () => r.xadd(STREAMS.STORY_EVENTS, '*', ...fields));
}

export async function publishWebhookIngress(payload: WebhookPayload): Promise<string | null> {
  const r = getRedis();
  return measureRedisCommand('xadd', () => r.xadd(STREAMS.WEBHOOK_INGRESS, '*', 'payload', JSON.stringify(payload)));
}

export async function publishJobStatus(
  jobId: string,
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'timeout',
  metadata: Record<string, any>
): Promise<string | null> {
  const r = getRedis();
  return measureRedisCommand('xadd', () => r.xadd(STREAMS.JOB_STATUS, '*', 'job_id', jobId, 'status', status, 'metadata', JSON.stringify(metadata)));
}

// ============================================
// Consumer Functions
// ============================================

export interface StreamMessage {
  id: string;
  stream: string;
  data: Record<string, string>;
}

export async function consumeStream(
  stream: string,
  groupName: string,
  consumerName: string,
  count: number = 10,
  blockMs: number = 5000
): Promise<StreamMessage[]> {
  const r = getRedis();
  const results = await measureRedisCommand('xreadgroup', () =>
    r.xreadgroup(
      'GROUP', groupName, consumerName,
      'COUNT', count,
      'BLOCK', blockMs,
      'STREAMS', stream, '>'
    )
  ) as [string, [string, [string, string][]][]][];

  if (!results) return [];

  // results is [ [streamName, [[id, [key, val, ...]], ...]], ... ]
  return results.flatMap((entry) => {
    const streamName = entry[0];
    const messages = entry[1];
    return messages.map((msg) => ({
      id: msg[0],
      stream: streamName,
      data: Object.fromEntries(msg[1]),
    }));
  });
}

export async function acknowledgeMessage(stream: string, groupName: string, messageId: string): Promise<void> {
  const r = getRedis();
  await measureRedisCommand('xack', () => r.xack(stream, groupName, messageId));
}

export async function claimStalledMessages(
  stream: string,
  groupName: string,
  consumerName: string,
  minIdleTimeMs: number,
  count: number = 10
): Promise<StreamMessage[]> {
  const r = getRedis();
  const results = await measureRedisCommand('xautoclaim', () =>
    r.xautoclaim(
      stream,
      groupName,
      consumerName,
      minIdleTimeMs,
      '0-0',
      'COUNT', count
    )
  ) as [string, [string, [string, string][]][]] | null;

  if (!results) return [];

  // results[1] is the array of messages from xautoclaim
  return results[1].map((msg): StreamMessage => ({
    id: msg[0],
    stream,
    data: Object.fromEntries(msg[1]),
  }));
}

// ============================================
// Utility Functions
// ============================================

export async function getStreamLength(stream: string): Promise<number> {
  const r = getRedis();
  return measureRedisCommand('xlen', () => r.xlen(stream));
}

export async function trimStream(stream: string, maxLength: number): Promise<void> {
  const r = getRedis();
  await measureRedisCommand('xtrim', () => r.xtrim(stream, 'MAXLEN', '~', maxLength));
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
  redisConnectionGauge.set(0);
}

export { STREAMS, CONSUMER_GROUPS };