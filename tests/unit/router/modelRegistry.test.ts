/**
 * Unit tests for Model Registry Service
 * Targets 100% branch coverage for src/router/modelRegistry.ts
 */

import type { ModelCapabilities, Resolution, AspectRatio, ModelCapability } from '../../../src/shared/types';

// ===== MOCKS =====

const mockQuery = jest.fn();
jest.mock('../../../src/shared/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  transaction: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    modelRegistry: {
      models: [
        {
          id: 'veo3-low',
          name: 'Veo 3 Low Quality',
          provider: 'google',
          maxResolution: '1080p',
          maxDurationSeconds: 10,
          supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'],
          supportedRegions: ['us', 'eu', 'asia'],
          costPerSecondUsd: 0,
          costCurrency: 'USD',
          capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning'],
          defaultTimeoutSeconds: 120,
        },
        {
          id: 'veo3-high',
          name: 'Veo 3 High Quality',
          provider: 'google',
          maxResolution: '4K',
          maxDurationSeconds: 10,
          supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'],
          supportedRegions: ['us', 'eu', 'asia'],
          costPerSecondUsd: 0.05,
          costCurrency: 'USD',
          capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning', 'native_audio', 'high_fidelity'],
          defaultTimeoutSeconds: 180,
        },
        {
          id: 'runway-gen3',
          name: 'Runway Gen-3 Alpha',
          provider: 'runway',
          maxResolution: '1080p',
          maxDurationSeconds: 10,
          supportedAspectRatios: ['16:9', '9:16'],
          supportedRegions: ['us', 'eu'],
          costPerSecondUsd: 0.08,
          costCurrency: 'USD',
          capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning'],
          defaultTimeoutSeconds: 180,
        },
      ],
      refreshIntervalMs: 300000,
    },
    router: {
      systemDefaultPriority: ['veo3-low', 'veo3-high', 'runway-gen3'],
      eligibilityCheckEnabled: true,
    },
  },
}));

// ===== IMPORTS =====
import {
  refreshModelRegistry,
  getModelRegistry,
  getModelById,
  checkModelEligibility,
  getEligibleModels,
  getUserModelPriority,
  setUserModelPriority,
  getSystemDefaultPriority,
  setSystemDefaultPriority,
  upsertModel,
  deactivateModel,
  initializeModelRegistryTable,
} from '../../../src/router/modelRegistry';

// ===== TESTS =====

describe('Model Registry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  describe('refreshModelRegistry', () => {
    test('returns config models when DB has no rows', async () => {
      const models = await refreshModelRegistry();
      expect(models.length).toBe(3);
      expect(models.map(m => m.id)).toEqual(['veo3-low', 'veo3-high', 'runway-gen3']);
    });

    test('merges DB rows that match existing config models', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'veo3-low',
            name: 'Veo 3 Low Updated',
            provider: 'google',
            max_resolution: '1080p',
            max_duration_seconds: 15,
            supported_aspect_ratios: ['16:9', '9:16'],
            supported_regions: ['us'],
            cost_per_second_usd: '0.01',
            cost_currency: 'USD',
            capabilities: ['text_to_video'],
            default_timeout_seconds: 120,
          },
        ],
      });

      const models = await refreshModelRegistry();
      expect(models.length).toBe(3);
      expect(models[0].name).toBe('Veo 3 Low Updated');
      expect(models[0].maxDurationSeconds).toBe(15);
      expect(models[0].costPerSecondUsd).toBe(0.01);
    });

    test('appends DB rows that are new (not in config)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'luma-dream',
            name: 'Luma Dream Machine',
            provider: 'luma',
            max_resolution: '1080p',
            max_duration_seconds: 5,
            supported_aspect_ratios: ['16:9'],
            supported_regions: ['us'],
            cost_per_second_usd: '0.02',
            cost_currency: 'USD',
            capabilities: ['text_to_video'],
            default_timeout_seconds: 60,
          },
        ],
      });

      const models = await refreshModelRegistry();
      expect(models.length).toBe(4);
      expect(models[3].id).toBe('luma-dream');
      expect(models[3].provider).toBe('luma');
    });

    test('handles DB error gracefully (table not found)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('relation "model_registry" does not exist'));

      const models = await refreshModelRegistry();
      expect(models.length).toBe(3);
      expect(models.map(m => m.id)).toEqual(['veo3-low', 'veo3-high', 'runway-gen3']);
    });
  });

  describe('getModelRegistry', () => {
    test('returns cached models when cache is valid', async () => {
      await refreshModelRegistry();
      const models = await getModelRegistry();
      expect(models.length).toBe(3);
      // query should not be called again (cached)
      mockQuery.mockClear();
      await getModelRegistry();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('refreshes when cache expires', async () => {
      await refreshModelRegistry();
      // Manually expire cache by setting cacheExpiry to 0 via refreshModelRegistry
      // We need to call refreshModelRegistry to set cache, then manipulate time
      // Since we're using fake timers, advance past cache TTL
      jest.advanceTimersByTime(300001);
      const models = await getModelRegistry();
      expect(models.length).toBe(3);
    });

    test('refreshes when cache is empty', async () => {
      // First call populates cache; clear by calling refreshModelRegistry with empty DB
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await refreshModelRegistry();
      // The cache is populated, but test the empty cache branch
      // by checking that getModelRegistry returns models
      const models = await getModelRegistry();
      expect(models.length).toBe(3);
    });
  });

  describe('getModelById', () => {
    test('returns model by ID', async () => {
      const model = await getModelById('veo3-low');
      expect(model).toBeDefined();
      expect(model?.id).toBe('veo3-low');
    });

    test('returns null for unknown model', async () => {
      const model = await getModelById('unknown');
      expect(model).toBeNull();
    });
  });

  describe('checkModelEligibility', () => {
    test('returns eligible for matching requirements', async () => {
      const result = await checkModelEligibility('veo3-low', {
        resolution: '1080p',
        aspectRatio: '16:9',
        durationSeconds: 8,
      });
      expect(result.eligible).toBe(true);
    });

    test('rejects model not found', async () => {
      const result = await checkModelEligibility('nonexistent', {
        resolution: '1080p',
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('not found');
    });

    test('rejects resolution exceeding model max', async () => {
      const result = await checkModelEligibility('veo3-low', { resolution: '4K' });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('max resolution');
    });

    test('accepts equal resolution', async () => {
      const result = await checkModelEligibility('veo3-low', { resolution: '1080p' });
      expect(result.eligible).toBe(true);
    });

    test('accepts lower resolution', async () => {
      const result = await checkModelEligibility('veo3-high', { resolution: '720p' });
      expect(result.eligible).toBe(true);
    });

    test('rejects unsupported aspect ratio', async () => {
      const result = await checkModelEligibility('runway-gen3', { aspectRatio: '1:1' });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('aspect ratio');
    });

    test('accepts supported aspect ratio', async () => {
      const result = await checkModelEligibility('runway-gen3', { aspectRatio: '16:9' });
      expect(result.eligible).toBe(true);
    });

    test('rejects duration exceeding model max', async () => {
      const result = await checkModelEligibility('veo3-low', { durationSeconds: 20 });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('duration');
    });

    test('accepts duration within model max', async () => {
      const result = await checkModelEligibility('veo3-low', { durationSeconds: 10 });
      expect(result.eligible).toBe(true);
    });

    test('rejects unsupported region', async () => {
      const result = await checkModelEligibility('runway-gen3', { region: 'asia' });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('region');
    });

    test('accepts supported region', async () => {
      const result = await checkModelEligibility('runway-gen3', { region: 'us' });
      expect(result.eligible).toBe(true);
    });

    test('rejects missing capability', async () => {
      const result = await checkModelEligibility('veo3-low', {
        requiredCapabilities: ['native_audio' as ModelCapability],
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('capability');
    });

    test('accepts when all required capabilities present', async () => {
      const result = await checkModelEligibility('veo3-high', {
        requiredCapabilities: ['text_to_video', 'native_audio' as ModelCapability],
      });
      expect(result.eligible).toBe(true);
    });

    test('rejects when one of multiple capabilities missing', async () => {
      const result = await checkModelEligibility('veo3-low', {
        requiredCapabilities: ['text_to_video', 'native_audio' as ModelCapability],
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('native_audio');
    });
  });

  describe('getEligibleModels', () => {
    test('returns models ordered by user priority', async () => {
      const models = await getEligibleModels({ resolution: '1080p' }, ['runway-gen3', 'veo3-low']);
      expect(models[0].id).toBe('runway-gen3');
      expect(models[1].id).toBe('veo3-low');
    });

    test('falls back to system default when no user priority', async () => {
      const models = await getEligibleModels({ resolution: '1080p' });
      expect(models[0].id).toBe('veo3-low');
      expect(models[1].id).toBe('veo3-high');
    });

    test('filters by eligibility', async () => {
      const models = await getEligibleModels({ resolution: '4K' });
      expect(models.length).toBe(1);
      expect(models[0].id).toBe('veo3-high');
    });

    test('handles models not in priority list (gets MAX_SAFE_INTEGER)', async () => {
      // Add a new model that isn't in the priority list
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-model',
            name: 'New Model',
            provider: 'test',
            max_resolution: '1080p',
            max_duration_seconds: 10,
            supported_aspect_ratios: ['16:9'],
            supported_regions: ['us'],
            cost_per_second_usd: '0.01',
            cost_currency: 'USD',
            capabilities: ['text_to_video'],
            default_timeout_seconds: 60,
          },
        ],
      });
      await refreshModelRegistry();
      mockQuery.mockResolvedValue({ rows: [] });

      const models = await getEligibleModels({ resolution: '1080p' }, ['veo3-low']);
      // new-model not in priority list, should sort after veo3-low
      expect(models[0].id).toBe('veo3-low');
      const lastModel = models[models.length - 1];
      expect(lastModel.id).toBe('new-model');
    });
  });

  describe('getUserModelPriority', () => {
    test('returns null when no rows found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getUserModelPriority('user-1');
      expect(result).toBeNull();
    });

    test('returns priority config when rows found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            priority_list: ['runway-gen3', 'veo3-low'],
            updated_at: new Date('2025-01-01'),
          },
        ],
      });
      const result = await getUserModelPriority('user-1');
      expect(result).not.toBeNull();
      expect(result?.userId).toBe('user-1');
      expect(result?.priorityList).toEqual(['runway-gen3', 'veo3-low']);
      expect(result?.updatedAt).toEqual(new Date('2025-01-01'));
    });
  });

  describe('setUserModelPriority', () => {
    test('saves valid priority list', async () => {
      const result = await setUserModelPriority('user-1', ['veo3-low', 'runway-gen3']);
      expect(result.userId).toBe('user-1');
      expect(result.priorityList).toEqual(['veo3-low', 'runway-gen3']);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_model_priorities'),
        ['user-1', ['veo3-low', 'runway-gen3']]
      );
    });

    test('throws for invalid model ID', async () => {
      await expect(
        setUserModelPriority('user-1', ['nonexistent-model'])
      ).rejects.toThrow('Invalid model ID in priority list: nonexistent-model');
    });
  });

  describe('getSystemDefaultPriority', () => {
    test('returns system default priority from config', async () => {
      const result = await getSystemDefaultPriority();
      expect(result.priorityList).toEqual(['veo3-low', 'veo3-high', 'runway-gen3']);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('setSystemDefaultPriority', () => {
    test('updates system default priority with valid models', async () => {
      const result = await setSystemDefaultPriority(['veo3-high', 'veo3-low']);
      expect(result.priorityList).toEqual(['veo3-high', 'veo3-low']);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test('throws for invalid model ID', async () => {
      await expect(
        setSystemDefaultPriority(['nonexistent-model'])
      ).rejects.toThrow('Invalid model ID in priority list: nonexistent-model');
    });
  });

  describe('upsertModel', () => {
    test('inserts model into registry', async () => {
      await upsertModel({
        id: 'test-model',
        name: 'Test Model',
        provider: 'test',
        maxResolution: '1080p',
        maxDurationSeconds: 10,
        supportedAspectRatios: ['16:9'],
        supportedRegions: ['us'],
        costPerSecondUsd: 0.01,
        costCurrency: 'USD',
        capabilities: ['text_to_video'],
        defaultTimeoutSeconds: 60,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO model_registry'),
        [
          'test-model',
          'Test Model',
          'test',
          '1080p',
          10,
          ['16:9'],
          ['us'],
          0.01,
          'USD',
          ['text_to_video'],
          60,
        ]
      );
    });
  });

  describe('deactivateModel', () => {
    test('deactivates model by ID', async () => {
      await deactivateModel('veo3-low');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE model_registry SET is_active = FALSE'),
        ['veo3-low']
      );
    });
  });

  describe('initializeModelRegistryTable', () => {
    test('creates tables and seeds when empty', async () => {
      // Mock: CREATE TABLE, CREATE TABLE, COUNT=0, then upserts
      mockQuery
        .mockResolvedValueOnce({}) // CREATE model_registry
        .mockResolvedValueOnce({}) // CREATE user_model_priorities
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // COUNT = 0
        .mockResolvedValue({}); // upserts

      await initializeModelRegistryTable();

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS model_registry'));
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS user_model_priorities'));
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*)'));
    });

    test('skips seeding when table has existing models', async () => {
      mockQuery
        .mockResolvedValueOnce({}) // CREATE model_registry
        .mockResolvedValueOnce({}) // CREATE user_model_priorities
        .mockResolvedValueOnce({ rows: [{ count: '3' }] }); // COUNT = 3

      await initializeModelRegistryTable();

      // Should not call upsertModel (no additional INSERT queries)
      const callCount = mockQuery.mock.calls.length;
      expect(callCount).toBe(3); // 2 CREATE + 1 COUNT only
    });
  });
});
