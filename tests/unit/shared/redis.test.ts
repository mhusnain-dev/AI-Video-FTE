import { jest, describe, test, expect, beforeEach, afterEach, afterAll } from '@jest/globals';
import { EventEmitter } from 'events';

const mockRedisEventEmitter = new EventEmitter();

const mockRedisInstance: any = {
  status: 'ready',
  xgroup: jest.fn(),
  xadd: jest.fn(),
  xreadgroup: jest.fn(),
  xack: jest.fn(),
  xautoclaim: jest.fn(),
  xlen: jest.fn(),
  xtrim: jest.fn(),
  quit: jest.fn(),
  on: jest.fn((event: string, cb: (...args: any[]) => void) => {
    mockRedisEventEmitter.on(event, cb);
    return mockRedisInstance;
  }),
  once: jest.fn((event: string, cb: (...args: any[]) => void) => {
    mockRedisEventEmitter.once(event, cb);
    return mockRedisInstance;
  }),
};

jest.mock('ioredis', () => ({
  Redis: jest.fn(() => mockRedisInstance),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: 'testpass',
      db: 0,
    },
  },
}));

jest.mock('../../../src/shared/metrics', () => ({
  redisCommandDurationSeconds: {
    observe: jest.fn(),
  },
  redisConnectionGauge: {
    set: jest.fn(),
  },
}));

import {
  getRedis,
  getSubscriber,
  ensureRedisConnected,
  initializeStreams,
  publishStoryCommand,
  publishStoryEvent,
  publishWebhookIngress,
  publishJobStatus,
  consumeStream,
  acknowledgeMessage,
  claimStalledMessages,
  getStreamLength,
  trimStream,
  closeRedis,
  STREAMS,
  CONSUMER_GROUPS,
} from '../../../src/shared/redis';

const Redis = require('ioredis').Redis;
const metricsModule = require('../../../src/shared/metrics');

describe('redis module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisInstance.status = 'ready';
    mockRedisInstance.xgroup.mockReset();
    mockRedisInstance.xadd.mockReset();
    mockRedisInstance.xreadgroup.mockReset();
    mockRedisInstance.xack.mockReset();
    mockRedisInstance.xautoclaim.mockReset();
    mockRedisInstance.xlen.mockReset();
    mockRedisInstance.xtrim.mockReset();
    mockRedisInstance.quit.mockReset();
    mockRedisInstance.on.mockReset();
    mockRedisInstance.once.mockReset();
  });

  afterEach(async () => {
    try { await closeRedis(); } catch {}
  });

  describe('getRedis', () => {
    test('returns a Redis client instance', () => {
      const client = getRedis();
      expect(client).toBeDefined();
      expect(Redis).toHaveBeenCalled();
    });

    test('returns same instance on subsequent calls (singleton)', () => {
      const client1 = getRedis();
      const client2 = getRedis();
      expect(client1).toBe(client2);
    });

    test('retryStrategy returns increasing delays capped at 3000', () => {
      let capturedOpts: any = null;
      (Redis as jest.Mock).mockImplementation((opts: any) => {
        capturedOpts = opts;
        return mockRedisInstance;
      });
      getRedis();
      const retryStrategy = capturedOpts.retryStrategy;
      expect(retryStrategy(1)).toBe(100);
      expect(retryStrategy(2)).toBe(200);
      expect(retryStrategy(30)).toBe(3000);
      expect(retryStrategy(100)).toBe(3000);
    });
  });

  describe('getSubscriber', () => {
    test('returns a subscriber Redis client instance', () => {
      const sub = getSubscriber();
      expect(sub).toBeDefined();
      expect(Redis).toHaveBeenCalled();
    });

    test('returns same subscriber instance on subsequent calls (singleton)', () => {
      const sub1 = getSubscriber();
      const sub2 = getSubscriber();
      expect(sub1).toBe(sub2);
    });
  });

  describe('ensureRedisConnected', () => {
    let savedTimers: any;

    beforeEach(() => {
      savedTimers = { ...globalThis };
      jest.useRealTimers();
    });

    afterEach(() => {
      jest.useFakeTimers();
    });

    test('resolves immediately when status is ready', async () => {
      mockRedisInstance.status = 'ready';
      mockRedisInstance.once.mockImplementation((_event: string, _cb: Function) => mockRedisInstance);

      await ensureRedisConnected();
    });

    test('rejects on timeout after 10 seconds', async () => {
      mockRedisInstance.status = 'connecting';
      mockRedisInstance.once.mockImplementation((_event: string, _cb: Function) => mockRedisInstance);

      await expect(ensureRedisConnected()).rejects.toThrow('Redis connection timeout');
    }, 15000);

    test('resolves when ready event fires', async () => {
      mockRedisInstance.status = 'connecting';
      mockRedisInstance.once.mockImplementation((event: string, cb: Function) => {
        if (event === 'ready') {
          setTimeout(() => cb(), 10);
        }
        return mockRedisInstance;
      });

      await expect(ensureRedisConnected()).resolves.toBeUndefined();
    }, 15000);

    test('rejects when error event fires', async () => {
      mockRedisInstance.status = 'connecting';
      mockRedisInstance.once.mockImplementation((event: string, cb: Function) => {
        if (event === 'error') {
          setTimeout(() => cb(new Error('Connection refused')), 10);
        }
        return mockRedisInstance;
      });

      await expect(ensureRedisConnected()).rejects.toThrow('Connection refused');
    }, 15000);
  });

  describe('initializeStreams', () => {
    test('creates all consumer groups successfully', async () => {
      mockRedisInstance.status = 'ready';
      mockRedisInstance.once.mockImplementation((_event: string, _cb: Function) => mockRedisInstance);
      mockRedisInstance.xgroup.mockResolvedValue('OK');

      await initializeStreams();

      expect(mockRedisInstance.xgroup).toHaveBeenCalledTimes(8);
      expect(mockRedisInstance.xgroup).toHaveBeenCalledWith(
        'CREATE', STREAMS.STORY_COMMANDS, CONSUMER_GROUPS.COMMAND_HANDLER, '0', 'MKSTREAM'
      );
      expect(mockRedisInstance.xgroup).toHaveBeenCalledWith(
        'CREATE', STREAMS.STORY_EVENTS, CONSUMER_GROUPS.DASHBOARD_UPDATER, '0', 'MKSTREAM'
      );
    });

    test('ignores BUSYGROUP errors (group already exists)', async () => {
      mockRedisInstance.status = 'ready';
      mockRedisInstance.once.mockImplementation((_event: string, _cb: Function) => mockRedisInstance);
      mockRedisInstance.xgroup.mockRejectedValue(new Error('BUSYGROUP Consumer Group name already exists'));

      await expect(initializeStreams()).resolves.toBeUndefined();
    });

    test('throws non-BUSYGROUP errors', async () => {
      mockRedisInstance.status = 'ready';
      mockRedisInstance.once.mockImplementation((_event: string, _cb: Function) => mockRedisInstance);
      mockRedisInstance.xgroup.mockRejectedValue(new Error('Connection lost'));

      await expect(initializeStreams()).rejects.toThrow('Connection lost');
    });
  });

  describe('publishStoryCommand', () => {
    test('publishes command to story_commands stream', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1234567890-0');

      const id = await publishStoryCommand('create', { storyId: 's1' });

      expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
        'story_commands', '*', 'command', 'create', 'payload', JSON.stringify({ storyId: 's1' })
      );
      expect(id).toBe('1234567890-0');
    });

    test('publishes all command types', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const commands = ['create', 'approve', 'revise', 'cancel', 'regenerate_shots'] as const;
      for (const cmd of commands) {
        await publishStoryCommand(cmd, {});
        expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
          'story_commands', '*', 'command', cmd, 'payload', JSON.stringify({})
        );
      }
      expect(mockRedisInstance.xadd).toHaveBeenCalledTimes(commands.length);
    });
  });

  describe('publishStoryEvent', () => {
    test('publishes event with base fields', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const event = {
        id: 'e1',
        entityType: 'story' as const,
        entityId: 's1',
        fromState: 'created',
        toState: 'planning',
        timestamp: new Date(),
        metadata: {},
      };

      const id = await publishStoryEvent(event);

      expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
        'story_events', '*', 'event', JSON.stringify(event)
      );
      expect(id).toBe('1');
    });

    test('includes traceId when present', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const event = {
        id: 'e1',
        entityType: 'story' as const,
        entityId: 's1',
        fromState: 'created',
        toState: 'planning',
        timestamp: new Date(),
        metadata: {},
        traceId: 'trace-abc',
      };

      await publishStoryEvent(event);

      expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
        'story_events', '*',
        'event', JSON.stringify(event),
        'traceId', 'trace-abc',
      );
    });

    test('includes spanId when present', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const event = {
        id: 'e1',
        entityType: 'story' as const,
        entityId: 's1',
        fromState: 'created',
        toState: 'planning',
        timestamp: new Date(),
        metadata: {},
        spanId: 'span-1',
      };

      await publishStoryEvent(event);

      expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
        'story_events', '*',
        'event', JSON.stringify(event),
        'spanId', 'span-1',
      );
    });

    test('includes parentSpanId when present', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const event = {
        id: 'e1',
        entityType: 'story' as const,
        entityId: 's1',
        fromState: 'created',
        toState: 'planning',
        timestamp: new Date(),
        metadata: {},
        traceId: 'trace-abc',
        spanId: 'span-2',
        parentSpanId: 'span-1',
      };

      await publishStoryEvent(event);

      expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
        'story_events', '*',
        'event', JSON.stringify(event),
        'traceId', 'trace-abc',
        'spanId', 'span-2',
        'parentSpanId', 'span-1',
      );
    });

    test('does not include traceId/spanId/parentSpanId when absent', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const event = {
        id: 'e1',
        entityType: 'story' as const,
        entityId: 's1',
        fromState: 'created',
        toState: 'planning',
        timestamp: new Date(),
        metadata: {},
      };

      await publishStoryEvent(event);

      const fields = mockRedisInstance.xadd.mock.calls[0] as any[];
      expect(fields).toHaveLength(4);
      expect(fields[0]).toBe('story_events');
      expect(fields[1]).toBe('*');
      expect(fields[2]).toBe('event');
    });
  });

  describe('publishWebhookIngress', () => {
    test('publishes webhook payload', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const payload = {
        provider: 'kie',
        requestId: 'req-1',
        status: 'completed' as const,
        timestamp: new Date(),
        signature: 'sig123',
      };

      const id = await publishWebhookIngress(payload);

      expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
        'webhook_ingress', '*', 'payload', JSON.stringify(payload)
      );
      expect(id).toBe('1');
    });
  });

  describe('publishJobStatus', () => {
    test('publishes job status with all fields', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const id = await publishJobStatus('job-1', 'processing', { model: 'kie-veo3-fast' });

      expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
        'job_status', '*',
        'job_id', 'job-1',
        'status', 'processing',
        'metadata', JSON.stringify({ model: 'kie-veo3-fast' }),
      );
      expect(id).toBe('1');
    });

    test('publishes all status types', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      const statuses = ['queued', 'processing', 'completed', 'failed', 'timeout'] as const;
      for (const status of statuses) {
        await publishJobStatus('job-1', status, {});
        expect(mockRedisInstance.xadd).toHaveBeenCalledWith(
          'job_status', '*',
          'job_id', 'job-1',
          'status', status,
          'metadata', JSON.stringify({}),
        );
      }
    });
  });

  describe('consumeStream', () => {
    test('parses stream messages from xreadgroup result', async () => {
      mockRedisInstance.xreadgroup.mockResolvedValue([
        [
          'story_commands',
          [
            ['1234567890-0', ['command', 'create', 'payload', '{"storyId":"s1"}']],
            ['1234567890-1', ['command', 'approve', 'payload', '{"storyId":"s2"}']],
          ],
        ],
      ]);

      const messages = await consumeStream('story_commands', 'command-handler', 'consumer-1');

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('1234567890-0');
      expect(messages[0].stream).toBe('story_commands');
      expect(messages[0].data).toEqual({ command: 'create', payload: '{"storyId":"s1"}' });
      expect(messages[1].data).toEqual({ command: 'approve', payload: '{"storyId":"s2"}' });
    });

    test('returns empty array when no messages', async () => {
      mockRedisInstance.xreadgroup.mockResolvedValue(null);

      const messages = await consumeStream('story_commands', 'command-handler', 'consumer-1');

      expect(messages).toEqual([]);
    });

    test('calls xreadgroup with correct arguments', async () => {
      mockRedisInstance.xreadgroup.mockResolvedValue(null);

      await consumeStream('story_commands', 'command-handler', 'consumer-1', 5, 3000);

      expect(mockRedisInstance.xreadgroup).toHaveBeenCalledWith(
        'GROUP', 'command-handler', 'consumer-1',
        'COUNT', 5,
        'STREAMS', 'story_commands', '>'
      );
    });

    test('uses default count and block values', async () => {
      mockRedisInstance.xreadgroup.mockResolvedValue(null);

      await consumeStream('story_commands', 'command-handler', 'consumer-1');

      expect(mockRedisInstance.xreadgroup).toHaveBeenCalledWith(
        'GROUP', 'command-handler', 'consumer-1',
        'COUNT', 10,
        'STREAMS', 'story_commands', '>'
      );
    });
  });

  describe('acknowledgeMessage', () => {
    test('calls xack with correct arguments', async () => {
      mockRedisInstance.xack.mockResolvedValue(1);

      await acknowledgeMessage('story_commands', 'command-handler', '1234567890-0');

      expect(mockRedisInstance.xack).toHaveBeenCalledWith(
        'story_commands', 'command-handler', '1234567890-0'
      );
    });
  });

  describe('claimStalledMessages', () => {
    test('claims stalled messages from xautoclaim', async () => {
      mockRedisInstance.xautoclaim.mockResolvedValue([
        '0-0',
        [
          ['1234567890-0', ['command', 'create', 'payload', '{}']],
          ['1234567890-1', ['command', 'revise', 'payload', '{}']],
        ],
      ]);

      const messages = await claimStalledMessages(
        'story_commands', 'command-handler', 'consumer-1', 60000, 5
      );

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('1234567890-0');
      expect(messages[0].stream).toBe('story_commands');
      expect(messages[0].data).toEqual({ command: 'create', payload: '{}' });
      expect(messages[1].data).toEqual({ command: 'revise', payload: '{}' });
    });

    test('returns empty array when no stalled messages', async () => {
      mockRedisInstance.xautoclaim.mockResolvedValue(null);

      const messages = await claimStalledMessages(
        'story_commands', 'command-handler', 'consumer-1', 60000
      );

      expect(messages).toEqual([]);
    });

    test('calls xautoclaim with correct arguments', async () => {
      mockRedisInstance.xautoclaim.mockResolvedValue(['0-0', []]);

      await claimStalledMessages('story_commands', 'command-handler', 'consumer-1', 30000, 3);

      expect(mockRedisInstance.xautoclaim).toHaveBeenCalledWith(
        'story_commands', 'command-handler', 'consumer-1', 30000, '0-0', 'COUNT', 3
      );
    });

    test('uses default count of 10', async () => {
      mockRedisInstance.xautoclaim.mockResolvedValue(['0-0', []]);

      await claimStalledMessages('story_commands', 'command-handler', 'consumer-1', 60000);

      expect(mockRedisInstance.xautoclaim).toHaveBeenCalledWith(
        'story_commands', 'command-handler', 'consumer-1', 60000, '0-0', 'COUNT', 10
      );
    });
  });

  describe('getStreamLength', () => {
    test('returns stream length', async () => {
      mockRedisInstance.xlen.mockResolvedValue(42);

      const length = await getStreamLength('story_commands');

      expect(mockRedisInstance.xlen).toHaveBeenCalledWith('story_commands');
      expect(length).toBe(42);
    });
  });

  describe('trimStream', () => {
    test('trims stream with MAXLEN ~ prefix', async () => {
      mockRedisInstance.xtrim.mockResolvedValue(5);

      await trimStream('story_commands', 1000);

      expect(mockRedisInstance.xtrim).toHaveBeenCalledWith('story_commands', 'MAXLEN', '~', 1000);
    });
  });

  describe('closeRedis', () => {
    test('quits both redis and subscriber clients', async () => {
      getRedis();
      getSubscriber();
      mockRedisInstance.quit.mockResolvedValue('OK');

      await closeRedis();

      expect(mockRedisInstance.quit).toHaveBeenCalled();
      expect(metricsModule.redisConnectionGauge.set).toHaveBeenCalledWith(0);
    });

    test('does nothing when redis is already null', async () => {
      await closeRedis();
      await closeRedis();
    });
  });

  describe('STREAMS and CONSUMER_GROUPS constants', () => {
    test('has correct stream names', () => {
      expect(STREAMS.STORY_COMMANDS).toBe('story_commands');
      expect(STREAMS.STORY_EVENTS).toBe('story_events');
      expect(STREAMS.WEBHOOK_INGRESS).toBe('webhook_ingress');
      expect(STREAMS.JOB_STATUS).toBe('job_status');
    });

    test('has correct consumer group names', () => {
      expect(CONSUMER_GROUPS.COMMAND_HANDLER).toBe('command-handler');
      expect(CONSUMER_GROUPS.EVENT_PROCESSOR).toBe('event-processor');
      expect(CONSUMER_GROUPS.WEBHOOK_HANDLER).toBe('webhook-handler');
      expect(CONSUMER_GROUPS.JOB_MONITOR).toBe('job-monitor');
      expect(CONSUMER_GROUPS.METRICS_AGGREGATOR).toBe('metrics-aggregator');
      expect(CONSUMER_GROUPS.ALERT_EVALUATOR).toBe('alert-evaluator');
      expect(CONSUMER_GROUPS.AUDIT_ARCHIVER).toBe('audit-archiver');
      expect(CONSUMER_GROUPS.DASHBOARD_UPDATER).toBe('dashboard-updater');
    });
  });

  describe('redis event handlers', () => {
    beforeEach(() => {
      mockRedisEventEmitter.removeAllListeners();
      mockRedisInstance.on.mockImplementation((event: string, cb: (...args: any[]) => void) => {
        mockRedisEventEmitter.on(event, cb);
        return mockRedisInstance;
      });
      mockRedisInstance.once.mockImplementation((event: string, cb: (...args: any[]) => void) => {
        mockRedisEventEmitter.once(event, cb);
        return mockRedisInstance;
      });
    });

    test('error handler logs error message', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const testErr = new Error('test connection error');

      getRedis();
      mockRedisEventEmitter.emit('error', testErr);

      expect(consoleSpy).toHaveBeenCalledWith('[Redis] Connection error:', testErr.message);
      consoleSpy.mockRestore();
    });

    test('connect handler logs and sets connection gauge to 1', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      getRedis();
      mockRedisEventEmitter.emit('connect');

      expect(consoleSpy).toHaveBeenCalledWith('[Redis] Connected');
      expect(metricsModule.redisConnectionGauge.set).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
    });

    test('ready handler logs', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      getRedis();
      mockRedisEventEmitter.emit('ready');

      expect(consoleSpy).toHaveBeenCalledWith('[Redis] Ready');
      consoleSpy.mockRestore();
    });

    test('close handler logs and sets connection gauge to 0', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      getRedis();
      mockRedisEventEmitter.emit('close');

      expect(consoleSpy).toHaveBeenCalledWith('[Redis] Connection closed');
      expect(metricsModule.redisConnectionGauge.set).toHaveBeenCalledWith(0);
      consoleSpy.mockRestore();
    });

    test('reconnecting handler logs', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      getRedis();
      mockRedisEventEmitter.emit('reconnecting');

      expect(consoleSpy).toHaveBeenCalledWith('[Redis] Reconnecting...');
      consoleSpy.mockRestore();
    });
  });

  describe('metric recording', () => {
    test('publishStoryCommand records redis command duration', async () => {
      mockRedisInstance.xadd.mockResolvedValue('1');

      await publishStoryCommand('create', {});

      expect(metricsModule.redisCommandDurationSeconds.observe).toHaveBeenCalledWith(
        { command: 'xadd' },
        expect.any(Number)
      );
    });

    test('consumeStream records redis command duration', async () => {
      mockRedisInstance.xreadgroup.mockResolvedValue(null);

      await consumeStream('story_commands', 'group', 'consumer');

      expect(metricsModule.redisCommandDurationSeconds.observe).toHaveBeenCalledWith(
        { command: 'xreadgroup' },
        expect.any(Number)
      );
    });

    test('acknowledgeMessage records redis command duration', async () => {
      mockRedisInstance.xack.mockResolvedValue(1);

      await acknowledgeMessage('story_commands', 'group', 'msg-1');

      expect(metricsModule.redisCommandDurationSeconds.observe).toHaveBeenCalledWith(
        { command: 'xack' },
        expect.any(Number)
      );
    });

    test('claimStalledMessages records redis command duration', async () => {
      mockRedisInstance.xautoclaim.mockResolvedValue(null);

      await claimStalledMessages('story_commands', 'group', 'consumer', 60000);

      expect(metricsModule.redisCommandDurationSeconds.observe).toHaveBeenCalledWith(
        { command: 'xautoclaim' },
        expect.any(Number)
      );
    });

    test('getStreamLength records redis command duration', async () => {
      mockRedisInstance.xlen.mockResolvedValue(0);

      await getStreamLength('story_commands');

      expect(metricsModule.redisCommandDurationSeconds.observe).toHaveBeenCalledWith(
        { command: 'xlen' },
        expect.any(Number)
      );
    });

    test('trimStream records redis command duration', async () => {
      mockRedisInstance.xtrim.mockResolvedValue(0);

      await trimStream('story_commands', 1000);

      expect(metricsModule.redisCommandDurationSeconds.observe).toHaveBeenCalledWith(
        { command: 'xtrim' },
        expect.any(Number)
      );
    });
  });
});
