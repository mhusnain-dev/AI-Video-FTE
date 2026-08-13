/**
 * Unit tests for Router Services (Phase 2)
 * Consolidated: Model Registry + AUTO Router + Model Adapter
 */

import type { ModelCapabilities, Resolution, AspectRatio, ModelCapability } from '../../../src/shared/types';

// ===== MOCKS - Must be before any imports =====

// Mock database
const mockQuery = jest.fn();
jest.mock('../../../src/shared/db', () => ({
  query: mockQuery,
  transaction: jest.fn(),
}));

// Mock config
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

// Mock initializeModelRegistryTable to no-op AND getUserModelPriority to configurable mock
let mockGetUserModelPriority = jest.fn().mockResolvedValue(null);
jest.mock('../../../src/router/modelRegistry', () => {
  const actual = jest.requireActual('../../../src/router/modelRegistry');
  return {
    ...actual,
    initializeModelRegistryTable: jest.fn().mockResolvedValue(undefined),
    getUserModelPriority: (...args: any[]) => mockGetUserModelPriority(...args),
  };
});

// Now import modules
import {
  getModelRegistry,
  getModelById,
  checkModelEligibility,
  getEligibleModels,
  getUserModelPriority,
} from '../../../src/router/modelRegistry';
import { selectModelForShot, getNextFallback } from '../../../src/router/autoRouter';
import { BaseModelAdapter, registerAdapter, getAdapter, clearAdapters } from '../../../src/router/modelAdapter';

// ===== TESTS =====

describe('Model Registry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockGetUserModelPriority.mockResolvedValue(null);
  });

  describe('getModelRegistry', () => {
    test('returns models from config', async () => {
      const models = await getModelRegistry();
      expect(models.length).toBe(3);
      expect(models.map(m => m.id)).toEqual(['veo3-low', 'veo3-high', 'runway-gen3']);
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

    test('rejects resolution exceeding model max', async () => {
      const result = await checkModelEligibility('veo3-low', { resolution: '4K' });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('max resolution');
    });

    test('rejects unsupported aspect ratio', async () => {
      const result = await checkModelEligibility('runway-gen3', { aspectRatio: '1:1' });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('aspect ratio');
    });

    test('rejects duration exceeding model max', async () => {
      const result = await checkModelEligibility('veo3-low', { durationSeconds: 20 });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('duration');
    });

    test('rejects unsupported region', async () => {
      const result = await checkModelEligibility('runway-gen3', { region: 'asia' });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('region');
    });

    test('rejects missing capability', async () => {
      const result = await checkModelEligibility('veo3-low', {
        requiredCapabilities: ['native_audio' as ModelCapability],
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('capability');
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
  });
});

describe('AUTO Router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockGetUserModelPriority.mockResolvedValue(null);
  });

  describe('selectModelForShot', () => {
    test('uses manual override when provided', async () => {
      const decision = await selectModelForShot('user-1', {
        resolution: '1080p',
        modelOverride: 'runway-gen3',
      });
      expect(decision.modelId).toBe('runway-gen3');
      expect(decision.isOverride).toBe(true);
      expect(decision.reason).toContain('override');
    });

    test('rejects override with ineligible model', async () => {
      await expect(selectModelForShot('user-1', {
        resolution: '4K',
        modelOverride: 'runway-gen3',
      })).rejects.toThrow('not eligible');
    });

    test('uses user priority list', async () => {
      // Mock getUserModelPriority to return custom priority
      mockGetUserModelPriority.mockResolvedValue({
        userId: 'user-1',
        priorityList: ['runway-gen3', 'veo3-low'],
        updatedAt: new Date(),
      });

      const decision = await selectModelForShot('user-1', { resolution: '1080p' });
      expect(decision.modelId).toBe('runway-gen3');
      expect(decision.reason).toContain('User priority');
    });

    test('falls back to system default', async () => {
      const decision = await selectModelForShot('user-unknown', { resolution: '1080p' });
      expect(decision.modelId).toBe('veo3-low');
      expect(decision.reason).toContain('System default');
    });
  });

  describe('getNextFallback', () => {
    test('returns next eligible model not tried', async () => {
      const fallback = await getNextFallback('shot-1', 'veo3-low', { resolution: '1080p' }, 'user-1');
      expect(fallback).toBeDefined();
      expect(fallback?.id).not.toBe('veo3-low');
    });

    test('returns null when all models exhausted', async () => {
      // Query order in getNextFallback:
      // 1. dispatch_records (SELECT DISTINCT model_id...)
      // 2. getUserModelPriority (SELECT * FROM user_model_priorities)
      // 3. getModelRegistry -> initializeModelRegistryTable (SELECT COUNT(*) FROM model_registry)
      // 4. getModelRegistry -> may do INSERTs (but we return empty for those)
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { model_id: 'veo3-low' },
            { model_id: 'veo3-high' },
            { model_id: 'runway-gen3' },
          ],
        }) // dispatch_records - all 3 models tried
        .mockResolvedValueOnce({ rows: [] }) // getUserModelPriority
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // model_registry COUNT
        .mockResolvedValue({ rows: [] }); // any INSERTs

      const fallback = await getNextFallback('shot-1', 'veo3-low', { resolution: '1080p' }, 'user-1');
      expect(fallback).toBeNull();
    });
  });
});

describe('Model Adapter Interface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAdapters();
  });

  test('registers and retrieves adapter', () => {
    class TestAdapter extends BaseModelAdapter {
      readonly modelId = 'test-model';
      readonly provider = 'test';

      protected async makeDispatchRequest() { return { providerRequestId: 'test' }; }
      protected async makeStatusCheck() { return { status: 'completed' as const }; }
      protected async makeCancelRequest() { return true; }
      protected verifySignature() { return true; }
      protected parseWebhookPayload() { return null; }

      getDefaultTimeoutSeconds() { return 60; }
      getCostPerSecond() { return 0.01; }
      supportsCapability() { return true; }
      getMaxDurationSeconds() { return 10; }
      getSupportedResolutions() { return ['1080p']; }
      getSupportedAspectRatios() { return ['16:9']; }
    }

    const adapter = new TestAdapter();
    registerAdapter(adapter);

    const retrieved = getAdapter('test-model');
    expect(retrieved).toBe(adapter);
  });

  test('returns undefined for unknown model', () => {
    const adapter = getAdapter('unknown');
    expect(adapter).toBeUndefined();
  });
});