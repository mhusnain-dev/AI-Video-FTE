/**
 * Infrastructure integration tests
 * Verifies Phase 0 foundation components work together
 */

import { jest } from '@jest/globals';
import { config } from '../../src/shared/config.js';
import { randomUUID } from 'crypto';

// Use real timers for integration tests (global setup uses fake timers)
jest.useRealTimers();

import { getPool, healthCheck, query, closePool } from '../../src/shared/db.js';
import { getRedis, initializeStreams, closeRedis, publishStoryEvent, STREAMS } from '../../src/shared/redis.js';
import { initializeVaultKey, encryptEmbeddingForStorage, decryptEmbeddingFromStorage, generateDEK, encryptDEKWithKEK, decryptDEKWithKEK } from '../../src/shared/vault.js';
import { initializeEventBus, emitStoryStateChange, StoryState } from '../../src/shared/events.js';

describe('Phase 0: Foundation Infrastructure', () => {
  beforeAll(async () => {
    // Wait for services to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    await closePool();
    await closeRedis();
  });

  describe('Configuration', () => {
    test('loads config with defaults', () => {
      expect(config.postgres.host).toBeDefined();
      expect(config.redis.host).toBeDefined();
      expect(config.vault.address).toBeDefined();
      expect(config.admission.sacredGuard.visualSimilarityThreshold).toBe(0.775);
      expect(config.faceLock.maxRetries).toBe(2);
      expect(config.dispatch.watchdogPollIntervalMs).toBe(30000);
      expect(config.dispatch.watchdogMaxWaitMs).toBe(600000);
    });

    test('has model registry with Veo 3 low quality at zero cost', () => {
      const veo3Low = config.modelRegistry.models.find(m => m.id === 'veo3-low');
      expect(veo3Low).toBeDefined();
      expect(veo3Low!.costPerSecondUsd).toBe(0);
    });
  });

  describe('PostgreSQL', () => {
    test('health check passes', async () => {
      const healthy = await healthCheck();
      expect(healthy).toBe(true);
    });

    test('can execute queries', async () => {
      const result = await query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
    });

    test('migrations applied', async () => {
      const tables = await query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
      `);
      const tableNames = tables.rows.map(r => r.table_name);
      expect(tableNames).toContain('stories');
      expect(tableNames).toContain('shots');
      expect(tableNames).toContain('characters');
      expect(tableNames).toContain('admission_audit');
      expect(tableNames).toContain('sacred_denylist');
      expect(tableNames).toContain('story_events');
      expect(tableNames).toContain('cost_records');
    });

    test('pgvector extension enabled', async () => {
      const result = await query(`SELECT * FROM pg_extension WHERE extname = 'vector'`);
      expect(result.rows.length).toBeGreaterThan(0);
    });

    test('pgcrypto extension enabled', async () => {
      const result = await query(`SELECT * FROM pg_extension WHERE extname = 'pgcrypto'`);
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Redis Streams', () => {
    test('connects to Redis', async () => {
      const redis = getRedis();
      await redis.ping();
      expect(true).toBe(true);
    });

    test('streams and consumer groups initialized', async () => {
      await initializeStreams();
      const redis = getRedis();

      for (const stream of Object.values(STREAMS)) {
        const groups = await redis.xinfo('GROUPS', stream) as Array<{name: string}>;
        expect(groups.length).toBeGreaterThan(0);
      }
    });

    test('can publish and consume events', async () => {
      await publishStoryEvent({
        id: 'test-' + Date.now(),
        entityType: 'story',
        entityId: 'test-story',
        fromState: 'draft',
        toState: 'planning',
        timestamp: new Date(),
        metadata: { action: 'test', payload: {}, userId: 'test-user' },
      });

      const redis = getRedis();
      const len = await redis.xlen(STREAMS.STORY_EVENTS);
      expect(len).toBeGreaterThan(0);
    });
  });

  describe('Vault Transit', () => {
    test('key initialized', async () => {
      await initializeVaultKey();
      // If no error, key exists
      expect(true).toBe(true);
    });

    test('can encrypt and decrypt DEK', async () => {
      const dek = generateDEK();
      const encrypted = await encryptDEKWithKEK(dek);
      const decrypted = await decryptDEKWithKEK(encrypted);
      expect(decrypted).toBe(dek);
    });

    test('can encrypt and decrypt embeddings end-to-end', async () => {
      const embedding = new Array(512).fill(0).map(() => Math.random());
      const userId = 'test-user-' + Date.now();

      // Mock user DEK storage
      const userDeks = new Map<string, { dekBase64: string; encryptedDek: string }>();

      const stored = await encryptEmbeddingForStorage(
        embedding,
        userId,
        async (uid: string) => userDeks.get(uid) || null,
        async (uid: string, dek: string, enc: string) => { userDeks.set(uid, { dekBase64: dek, encryptedDek: enc }); }
      );

      expect(stored.envelope).toBeDefined();
      expect(stored.encryptedDek).toBeDefined();

      const decrypted = await decryptEmbeddingFromStorage(
        stored,
        userId,
        async (uid: string) => userDeks.get(uid) || null
      );

      expect(decrypted).toEqual(embedding);
    });
  });

  describe('Event Bus', () => {
    test('initializes', async () => {
      await initializeEventBus();
      expect(true).toBe(true);
    });

    test('emits state change events', async () => {
      const storyId = randomUUID();
      await emitStoryStateChange(storyId, 'draft', 'planning', 'decompose_shots', {}, 'test-user');

      const events = await query(
        'SELECT * FROM story_events WHERE entity_id = $1 ORDER BY timestamp DESC',
        [storyId]
      );
      expect(events.rows.length).toBe(1);
      expect(events.rows[0].event_type).toBe('decompose_shots');
      expect(events.rows[0].from_state).toBe('draft');
      expect(events.rows[0].to_state).toBe('planning');
    });
  });
});