import {
  selectModelForShot,
  getNextFallback,
  recordDispatchAttempt,
  getModelEligibility,
  getDispatchHistory,
} from '../../../src/router/autoRouter';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/router/modelRegistry', () => ({
  initializeModelRegistryTable: jest.fn().mockResolvedValue(undefined),
  getUserModelPriority: jest.fn().mockResolvedValue(null),
  getModelById: jest.fn(),
  getModelRegistry: jest.fn(),
  getEligibleModels: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    router: {
      systemDefaultPriority: ['kie-veo3-fast', 'kie-veo3-quality', 'kie-veo3-lite', 'runway-gen3'],
      eligibilityCheckEnabled: true,
    },
  },
}));

jest.mock('../../../src/shared/metrics', () => ({
  modelSelectionTotal: { inc: jest.fn() },
  modelEligibilityFilteredTotal: { inc: jest.fn() },
}));

const mockQuery = require('../../../src/shared/db').query;
const modelRegistry = require('../../../src/router/modelRegistry');
const metrics = require('../../../src/shared/metrics');

const mockModel1 = {
  id: 'kie-veo3-fast',
  name: 'KIE Veo3 Fast',
  provider: 'kie',
  maxResolution: '1080p' as const,
  maxDurationSeconds: 120,
  supportedAspectRatios: ['16:9', '9:16'] as any[],
  supportedRegions: ['us-east', 'eu-west'],
  costPerSecondUsd: 0.01,
  costCurrency: 'USD',
  capabilities: ['text_to_video', 'fast_generation'] as any[],
  defaultTimeoutSeconds: 120,
};

const mockModel2 = {
  id: 'kie-veo3-quality',
  name: 'KIE Veo3 Quality',
  provider: 'kie',
  maxResolution: '4K' as const,
  maxDurationSeconds: 180,
  supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'] as any[],
  supportedRegions: ['us-east', 'eu-west', 'ap-south'],
  costPerSecondUsd: 0.04,
  costCurrency: 'USD',
  capabilities: ['text_to_video', 'high_fidelity', 'reference_conditioning'] as any[],
  defaultTimeoutSeconds: 180,
};

const mockModel3 = {
  id: 'runway-gen3',
  name: 'Runway Gen3',
  provider: 'runway',
  maxResolution: '4K' as const,
  maxDurationSeconds: 180,
  supportedAspectRatios: ['16:9'] as any[],
  supportedRegions: ['us-east'],
  costPerSecondUsd: 0.08,
  costCurrency: 'USD',
  capabilities: ['text_to_video', 'image_to_video', 'high_fidelity'] as any[],
  defaultTimeoutSeconds: 180,
};

describe('AutoRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modelRegistry.initializeModelRegistryTable.mockResolvedValue(undefined);
  });

  describe('selectModelForShot', () => {
    test('selects first eligible model by system default priority', async () => {
      modelRegistry.getUserModelPriority.mockResolvedValue(null);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1, mockModel2]);

      const result = await selectModelForShot('user-1', {});

      expect(result.modelId).toBe('kie-veo3-fast');
      expect(result.model).toBe(mockModel1);
      expect(result.fallbackModels).toEqual([mockModel2]);
      expect(result.isOverride).toBe(false);
      expect(result.reason).toBe('System default priority');
      expect(metrics.modelSelectionTotal.inc).toHaveBeenCalledWith({
        model_id: 'kie-veo3-fast',
        reason: 'System default priority',
        is_override: 'false',
      });
    });

    test('uses user priority list when available', async () => {
      modelRegistry.getUserModelPriority.mockResolvedValue({
        userId: 'user-1',
        priorityList: ['kie-veo3-quality', 'kie-veo3-fast'],
      });
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel2, mockModel1]);

      const result = await selectModelForShot('user-1', {});

      expect(result.modelId).toBe('kie-veo3-quality');
      expect(result.reason).toBe('User priority list');
      expect(metrics.modelSelectionTotal.inc).toHaveBeenCalledWith({
        model_id: 'kie-veo3-quality',
        reason: 'User priority list',
        is_override: 'false',
      });
    });

    test('applies manual model override (FR-008)', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel2);
      modelRegistry.getUserModelPriority.mockResolvedValue(null);

      // checkEligibility needs getEligibleModels for fallbacks
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1, mockModel2]);

      const result = await selectModelForShot('user-1', {
        modelOverride: 'kie-veo3-quality',
      });

      expect(result.modelId).toBe('kie-veo3-quality');
      expect(result.isOverride).toBe(true);
      expect(result.reason).toBe('Manual model override');
      expect(result.fallbackModels).toBeDefined();
      expect(metrics.modelSelectionTotal.inc).toHaveBeenCalledWith({
        model_id: 'kie-veo3-quality',
        reason: 'Manual model override',
        is_override: 'true',
      });
    });

    test('throws when override model not found', async () => {
      modelRegistry.getModelById.mockResolvedValue(null);

      await expect(
        selectModelForShot('user-1', { modelOverride: 'nonexistent-model' })
      ).rejects.toThrow('Override model not found: nonexistent-model');
    });

    test('throws when override model is not eligible', async () => {
      modelRegistry.getModelById.mockResolvedValue({
        ...mockModel1,
        maxResolution: '720p',
      });
      modelRegistry.getEligibleModels.mockResolvedValue([]);

      await expect(
        selectModelForShot('user-1', {
          modelOverride: 'kie-veo3-fast',
          resolution: '4K',
        })
      ).rejects.toThrow('Override model kie-veo3-fast not eligible');
      expect(metrics.modelEligibilityFilteredTotal.inc).toHaveBeenCalled();
    });

    test('throws when no eligible models', async () => {
      modelRegistry.getUserModelPriority.mockResolvedValue(null);
      modelRegistry.getEligibleModels.mockResolvedValue([]);

      await expect(selectModelForShot('user-1', {})).rejects.toThrow(
        'No eligible models for shot requirements'
      );
    });

    test('passes user priority list to getEligibleModels', async () => {
      const priorityList = ['kie-veo3-quality', 'kie-veo3-fast'];
      modelRegistry.getUserModelPriority.mockResolvedValue({
        userId: 'user-1',
        priorityList,
      });
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel2]);

      await selectModelForShot('user-1', {});

      expect(modelRegistry.getEligibleModels).toHaveBeenCalledWith({}, priorityList);
    });

    test('initializes model registry table on first call', async () => {
      modelRegistry.getUserModelPriority.mockResolvedValue(null);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1]);

      await selectModelForShot('user-1', {});

      expect(modelRegistry.initializeModelRegistryTable).toHaveBeenCalled();
    });
  });

  describe('checkEligibility (via selectModelForShot)', () => {
    test('rejects when resolution too high', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel1); // maxResolution: 1080p
      modelRegistry.getEligibleModels.mockResolvedValue([]);

      await expect(
        selectModelForShot('user-1', {
          modelOverride: 'kie-veo3-fast',
          resolution: '4K',
        })
      ).rejects.toThrow(/not eligible/);
    });

    test('rejects when aspect ratio not supported', async () => {
      modelRegistry.getModelById.mockResolvedValue({
        ...mockModel3, // only supports 16:9
        supportedAspectRatios: ['16:9'],
      });
      modelRegistry.getEligibleModels.mockResolvedValue([]);

      await expect(
        selectModelForShot('user-1', {
          modelOverride: 'runway-gen3',
          aspectRatio: '9:16',
        })
      ).rejects.toThrow(/not eligible/);
    });

    test('rejects when duration exceeds max', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel1); // maxDuration: 120
      modelRegistry.getEligibleModels.mockResolvedValue([]);

      await expect(
        selectModelForShot('user-1', {
          modelOverride: 'kie-veo3-fast',
          durationSeconds: 200,
        })
      ).rejects.toThrow(/not eligible/);
    });

    test('rejects when region not supported', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel3); // only us-east
      modelRegistry.getEligibleModels.mockResolvedValue([]);

      await expect(
        selectModelForShot('user-1', {
          modelOverride: 'runway-gen3',
          region: 'ap-south',
        })
      ).rejects.toThrow(/not eligible/);
    });

    test('rejects when required capability missing', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel1); // no reference_conditioning
      modelRegistry.getEligibleModels.mockResolvedValue([]);

      await expect(
        selectModelForShot('user-1', {
          modelOverride: 'kie-veo3-fast',
          requiredCapabilities: ['reference_conditioning'],
        })
      ).rejects.toThrow(/not eligible/);
    });

    test('passes when all requirements met', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel2); // 4K, all ratios, all caps
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel2, mockModel1]);

      const result = await selectModelForShot('user-1', {
        modelOverride: 'kie-veo3-quality',
        resolution: '4K',
        aspectRatio: '1:1',
        region: 'ap-south',
        requiredCapabilities: ['reference_conditioning'],
      });

      expect(result.modelId).toBe('kie-veo3-quality');
      expect(result.isOverride).toBe(true);
    });
  });

  describe('getNextFallback', () => {
    test('returns next eligible model not yet tried', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ model_id: 'kie-veo3-fast' }],
      });
      modelRegistry.getUserModelPriority.mockResolvedValue(null);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1, mockModel2, mockModel3]);

      const result = await getNextFallback(
        'shot-1',
        'kie-veo3-fast',
        {},
        'user-1'
      );

      expect(result).toBe(mockModel2);
    });

    test('returns null when all models exhausted', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { model_id: 'kie-veo3-fast' },
          { model_id: 'kie-veo3-quality' },
          { model_id: 'runway-gen3' },
        ],
      });
      modelRegistry.getUserModelPriority.mockResolvedValue(null);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1, mockModel2, mockModel3]);

      const result = await getNextFallback(
        'shot-1',
        'kie-veo3-fast',
        {},
        'user-1'
      );

      expect(result).toBeNull();
    });

    test('includes failedModelId in tried set', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      modelRegistry.getUserModelPriority.mockResolvedValue(null);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1, mockModel2]);

      const result = await getNextFallback(
        'shot-1',
        'kie-veo3-fast',
        {},
        'user-1'
      );

      expect(result).toBe(mockModel2);
    });

    test('returns null when no eligible models', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      modelRegistry.getUserModelPriority.mockResolvedValue(null);
      modelRegistry.getEligibleModels.mockResolvedValue([]);

      const result = await getNextFallback(
        'shot-1',
        'kie-veo3-fast',
        {},
        'user-1'
      );

      expect(result).toBeNull();
    });

    test('uses user priority list', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      modelRegistry.getUserModelPriority.mockResolvedValue({
        userId: 'user-1',
        priorityList: ['kie-veo3-quality', 'kie-veo3-fast'],
      });
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel2, mockModel1]);

      const result = await getNextFallback(
        'shot-1',
        'kie-veo3-fast',
        {},
        'user-1'
      );

      expect(result).toBe(mockModel2);
      expect(modelRegistry.getEligibleModels).toHaveBeenCalledWith(
        {},
        ['kie-veo3-quality', 'kie-veo3-fast']
      );
    });
  });

  describe('recordDispatchAttempt', () => {
    test('inserts dispatch record with status', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordDispatchAttempt('shot-1', 'kie-veo3-fast', 'req-123', 'dispatched');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO dispatch_records'),
        ['shot-1', 'kie-veo3-fast', 'req-123', 'dispatched']
      );
    });

    test('sets dispatched_at only when status is dispatched', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordDispatchAttempt('shot-1', 'kie-veo3-fast', 'req-123', 'pending');

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("CASE WHEN $4 = 'dispatched' THEN NOW() ELSE NULL END");
    });

    test('handles null provider request ID', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordDispatchAttempt('shot-1', 'kie-veo3-fast', null, 'completed');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['shot-1', 'kie-veo3-fast', null, 'completed']
      );
    });

    test('handles all status types', async () => {
      const statuses = ['pending', 'dispatched', 'completed', 'failed', 'timeout', 'fallback'] as const;

      for (const status of statuses) {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await recordDispatchAttempt('shot-1', 'kie-veo3-fast', null, status);
      }

      expect(mockQuery).toHaveBeenCalledTimes(6);
    });
  });

  describe('getModelEligibility', () => {
    test('returns empty array when shot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getModelEligibility('nonexistent-shot');
      expect(result).toEqual([]);
    });

    test('returns eligibility for all models', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            resolution: '1080p',
            aspectRatio: '16:9',
            duration_seconds: 30,
            required_capabilities: ['text_to_video'],
            story_brief: 'test story',
          },
        ],
      });
      modelRegistry.getModelRegistry.mockResolvedValue([mockModel1, mockModel2, mockModel3]);

      const result = await getModelEligibility('shot-1');

      expect(result).toHaveLength(3);
      result.forEach(r => {
        expect(r).toHaveProperty('modelId');
        expect(r).toHaveProperty('eligible');
        expect(typeof r.eligible).toBe('boolean');
      });
    });

    test('marks models as ineligible based on requirements', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            resolution: '4K',
            aspectRatio: '16:9',
            duration_seconds: 30,
            required_capabilities: [],
            story_brief: 'test',
          },
        ],
      });
      modelRegistry.getModelRegistry.mockResolvedValue([mockModel1, mockModel2]);

      const result = await getModelEligibility('shot-1');

      // mockModel1 maxResolution is 1080p, should be ineligible for 4K
      const fastModel = result.find(r => r.modelId === 'kie-veo3-fast');
      expect(fastModel?.eligible).toBe(false);
      expect(fastModel?.reason).toContain('resolution');

      // mockModel2 maxResolution is 4K, should be eligible
      const qualityModel = result.find(r => r.modelId === 'kie-veo3-quality');
      expect(qualityModel?.eligible).toBe(true);
    });

    test('includes reason for ineligible models', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            resolution: '1080p',
            aspectRatio: '16:9',
            duration_seconds: 30,
            required_capabilities: ['native_audio'],
            story_brief: 'test',
          },
        ],
      });
      modelRegistry.getModelRegistry.mockResolvedValue([mockModel1]);

      const result = await getModelEligibility('shot-1');

      expect(result[0].eligible).toBe(false);
      expect(result[0].reason).toContain('capability');
    });
  });

  describe('getDispatchHistory', () => {
    test('returns mapped dispatch history', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            model_id: 'kie-veo3-fast',
            status: 'completed',
            dispatched_at: new Date('2025-01-01T00:00:00Z'),
            completed_at: new Date('2025-01-01T00:01:00Z'),
          },
          {
            model_id: 'kie-veo3-quality',
            status: 'failed',
            dispatched_at: new Date('2025-01-01T00:02:00Z'),
            completed_at: null,
          },
        ],
      });

      const result = await getDispatchHistory('shot-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        modelId: 'kie-veo3-fast',
        status: 'completed',
        dispatchedAt: new Date('2025-01-01T00:00:00Z'),
        completedAt: new Date('2025-01-01T00:01:00Z'),
      });
      expect(result[1]).toEqual({
        modelId: 'kie-veo3-quality',
        status: 'failed',
        dispatchedAt: new Date('2025-01-01T00:02:00Z'),
        completedAt: null,
      });
    });

    test('returns empty array when no history', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getDispatchHistory('shot-1');
      expect(result).toEqual([]);
    });

    test('orders by created_at', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await getDispatchHistory('shot-1');

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY created_at');
    });
  });

  describe('eligibility edge cases', () => {
    test('passes when resolution requirement is null/undefined', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel1);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1]);

      const result = await selectModelForShot('user-1', {
        modelOverride: 'kie-veo3-fast',
      });

      expect(result.modelId).toBe('kie-veo3-fast');
    });

    test('passes when aspect ratio requirement is null', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel1);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1]);

      const result = await selectModelForShot('user-1', {
        modelOverride: 'kie-veo3-fast',
      });

      expect(result.modelId).toBe('kie-veo3-fast');
    });

    test('passes when duration requirement is null', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel1);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1]);

      const result = await selectModelForShot('user-1', {
        modelOverride: 'kie-veo3-fast',
      });

      expect(result.modelId).toBe('kie-veo3-fast');
    });

    test('passes when region requirement is null', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel1);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1]);

      const result = await selectModelForShot('user-1', {
        modelOverride: 'kie-veo3-fast',
      });

      expect(result.modelId).toBe('kie-veo3-fast');
    });

    test('passes when requiredCapabilities is null', async () => {
      modelRegistry.getModelById.mockResolvedValue(mockModel1);
      modelRegistry.getEligibleModels.mockResolvedValue([mockModel1]);

      const result = await selectModelForShot('user-1', {
        modelOverride: 'kie-veo3-fast',
      });

      expect(result.modelId).toBe('kie-veo3-fast');
    });
  });
});
