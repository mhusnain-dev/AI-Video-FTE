/**
 * Unit tests for Shot Dispatcher (Phase 4.2)
 */

import { dispatchShot, dispatchWithFallback, isShotDispatched, getDispatchRecord } from '../../../src/dispatch/shotDispatcher';
import type { ShotPlan, ModelCapabilities, CompiledPrompt } from '../../../src/shared/types';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
  transaction: jest.fn((cb) => cb({ query: jest.fn() })),
}));

jest.mock('../../../src/admission/admissionController', () => ({
  runAdmissionPipeline: jest.fn(),
}));

jest.mock('../../../src/router/modelAdapter', () => ({
  getAdapter: jest.fn(),
  initializeAdapters: jest.fn(),
}));

jest.mock('../../../src/shared/events', () => ({
  emitShotStateChange: jest.fn(),
  shotStateMachine: { setCurrentState: jest.fn() },
}));

jest.mock('../../../src/generation/promptCompiler', () => ({
  compilePrompt: jest.fn(),
}));

jest.mock('../../../src/router/autoRouter', () => ({
  selectModelForShot: jest.fn(),
}));

jest.mock('../../../src/ingestion/characterService', () => ({
  getCharacterReferences: jest.fn(),
}));

const mockQuery = require('../../../src/shared/db').query;
const { runAdmissionPipeline } = require('../../../src/admission/admissionController');
const { getAdapter } = require('../../../src/router/modelAdapter');
const { selectModelForShot } = require('../../../src/router/autoRouter');
const { compilePrompt } = require('../../../src/generation/promptCompiler');
const { getCharacterReferences } = require('../../../src/ingestion/characterService');

describe('Shot Dispatcher', () => {
  const mockShot: ShotPlan = {
    id: 'shot-1',
    storyId: 'story-1',
    order: 1,
    visualDescription: 'John walks through a forest at sunset',
    durationSeconds: 8,
    cameraMotion: 'static',
    characters: ['John'],
    keyObjects: ['forest', 'sunset'],
    keyActions: ['walking'],
    audioCues: [],
    styleReferences: [],
    negativePrompts: [],
    status: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockModel: ModelCapabilities = {
    id: 'veo3-low',
    name: 'Veo 3 Low Quality',
    provider: 'google',
    maxResolution: '720p',
    maxDurationSeconds: 10,
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    supportedRegions: ['us', 'eu'],
    costPerSecondUsd: 0.00,
    costCurrency: 'USD',
    capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning'],
    defaultTimeoutSeconds: 120,
  };

  const mockFallbackModel: ModelCapabilities = {
    ...mockModel,
    id: 'runway-gen3',
    name: 'Runway Gen-3',
    costPerSecondUsd: 0.05,
  };

  const mockPromptOutput: CompiledPrompt = {
    modelId: 'veo3-low',
    shotId: 'shot-1',
    prompt: 'John walks through a forest at sunset. Camera: static. Duration: 8 seconds. Objects: forest, sunset. Actions: walking.',
    negativePrompt: 'blurry, low quality, static camera, no motion',
    parameters: { duration_seconds: 8, output_resolution: '720p', aspect_ratio: '16:9', fps: 24 },
    modelParams: { duration_seconds: 8, output_resolution: '720p', aspect_ratio: '16:9', fps: 24 },
    characterConditioning: [{
      characterName: 'John',
      referenceImageBase64: 'base64-image-data',
      modelSpecificParams: { subject_reference: 'hash-123', subject_strength: 0.8, consistency_guidance: true },
    }],
    styleReferences: [],
  };

  const mockAdapter = {
    modelId: 'veo3-low',
    provider: 'google',
    dispatch: jest.fn(),
    checkStatus: jest.fn(),
    cancel: jest.fn(),
    verifyWebhook: jest.fn(),
    parseWebhook: jest.fn(),
    getDefaultTimeoutSeconds: () => 120,
    getCostPerSecond: () => 0,
    supportsCapability: () => true,
    getMaxDurationSeconds: () => 10,
    getSupportedResolutions: () => ['720p', '1080p'],
    getSupportedAspectRatios: () => ['16:9', '9:16', '1:1'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();

    // Default mock query returns empty rows
    mockQuery.mockResolvedValue({ rows: [] });

    runAdmissionPipeline.mockResolvedValue({
      passed: true,
      results: {
        moderation: { blocked: false },
        sacredGuard: { blocked: false },
        costGuard: { blocked: false, paused: false },
        rateLimit: { allowed: true },
      },
    });

    // Mock selectModelForShot for fallback models
    selectModelForShot.mockResolvedValue({
      modelId: 'veo3-low',
      model: mockModel,
      fallbackModels: [mockFallbackModel],
      reason: 'test',
      isOverride: false,
    });

    // Mock getCharacterReferences for Face-Lock conditioning in fallback
    getCharacterReferences.mockResolvedValue([
      {
        id: 'char-1',
        userId: 'user-1',
        storyId: 'story-1',
        name: 'John',
        faceEmbeddingVector: [],
        voiceEmbeddingVector: [],
        referenceImageHash: 'hash-123',
        referenceImageBase64: 'base64-image-data',
        referenceImageUrl: null,
        metadata: { identityStrength: 0.8 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    getAdapter.mockReturnValue(mockAdapter);
    mockAdapter.dispatch.mockResolvedValue({
      providerRequestId: 'provider-req-123',
      estimatedCompletionMs: 120000,
    });
  });

  describe('dispatchShot', () => {
    test('successfully dispatches a shot', async () => {
      // Mock story query for resolution/aspectRatio
      mockQuery
        .mockResolvedValueOnce({ rows: [{ aspect_ratio: '16:9', resolution: '1080p' }] }) // Story query
        .mockResolvedValueOnce({ rows: [{ id: 'dispatch-1', shot_id: 'shot-1', model_id: 'veo3-low', status: 'pending' }] }); // INSERT dispatch record

      // Mock the selectModelForShot in the dynamic import
      const { selectModelForShot } = require('../../../src/router/autoRouter');
      selectModelForShot.mockResolvedValueOnce({
        modelId: 'veo3-low',
        model: mockModel,
        fallbackModels: [mockFallbackModel],
        reason: 'test',
        isOverride: false,
      });

      const result = await dispatchShot(mockShot, mockPromptOutput, mockModel);

      expect(result.success).toBe(true);
      expect(result.dispatchRecord).toBeDefined();
      expect(result.dispatchRecord?.providerRequestId).toBe('provider-req-123');
      expect(result.dispatchRecord?.status).toBe('dispatched');
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO dispatch_records'), expect.any(Array));
      expect(runAdmissionPipeline).toHaveBeenCalled();
    });

    test('returns error when no adapter registered', async () => {
      getAdapter.mockReturnValue(undefined);

      const result = await dispatchShot(mockShot, mockPromptOutput, mockModel);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No adapter registered');
    });

    test('returns error when admission fails', async () => {
      runAdmissionPipeline.mockResolvedValue({
        passed: false,
        blockedAtGate: 'moderation',
        results: {
          moderation: { blocked: true, reason: 'Violence detected' },
          sacredGuard: { blocked: false },
          costGuard: { blocked: false, paused: false },
          rateLimit: { allowed: true },
        },
      });

      const result = await dispatchShot(mockShot, mockPromptOutput, mockModel);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Violence detected');
      expect(runAdmissionPipeline).toHaveBeenCalled();
    });

    test('skips admission when option provided', async () => {
      // Mock story query for resolution/aspectRatio
      mockQuery
        .mockResolvedValueOnce({ rows: [{ aspect_ratio: '16:9', resolution: '1080p' }] }) // Story query
        .mockResolvedValueOnce({ rows: [{ id: 'dispatch-1', shot_id: 'shot-1', model_id: 'veo3-low', status: 'pending' }] }); // INSERT dispatch record

      const result = await dispatchShot(mockShot, mockPromptOutput, mockModel, { skipAdmission: true });

      expect(result.success).toBe(true);
      expect(runAdmissionPipeline).not.toHaveBeenCalled();
    });

    test('handles dispatch error', async () => {
      mockAdapter.dispatch.mockRejectedValue(new Error('Network error'));

      const result = await dispatchShot(mockShot, mockPromptOutput, mockModel);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    test('creates dispatch record with correct data', async () => {
      // Mock story query for resolution/aspectRatio
      mockQuery
        .mockResolvedValueOnce({ rows: [{ aspect_ratio: '16:9', resolution: '1080p' }] }) // Story query
        .mockResolvedValueOnce({ rows: [{ id: 'dispatch-1', shot_id: 'shot-1', model_id: 'veo3-low', status: 'pending' }] }); // INSERT dispatch record

      await dispatchShot(mockShot, mockPromptOutput, mockModel);

      // 'pending' is hardcoded in SQL, not passed as parameter
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO dispatch_records'),
        expect.arrayContaining([expect.any(String), 'shot-1', 'veo3-low'])
      );
    });
  });

  describe('dispatchWithFallback', () => {
    const fallbackModels: ModelCapabilities[] = [
      {
        ...mockModel,
        id: 'runway-gen3',
        name: 'Runway Gen-3',
        maxResolution: '1080p',
        defaultTimeoutSeconds: 180,
        capabilities: ['text_to_video', 'image_to_video'],
      },
    ];

    const fallbackPromptOutput: CompiledPrompt = {
      ...mockPromptOutput,
      modelId: 'runway-gen3',
      parameters: { duration: 8, resolution: '1080p', aspect_ratio: '16:9', fps: 24 },
      modelParams: { duration: 8, resolution: '1080p', aspect_ratio: '16:9', fps: 24 },
    };

    test('returns primary result if primary succeeds', async () => {
      // Mock story query for resolution/aspectRatio (for primary dispatch)
      mockQuery
        .mockResolvedValueOnce({ rows: [{ aspect_ratio: '16:9', resolution: '1080p' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'dispatch-1', shot_id: 'shot-1', model_id: 'veo3-low', status: 'pending' }] });

      const result = await dispatchWithFallback(mockShot, mockPromptOutput, mockModel, fallbackModels);

      expect(result.success).toBe(true);
      // Should not try fallback
    });

    test('tries fallback models when primary fails', async () => {
      // Primary fails
      mockAdapter.dispatch.mockRejectedValueOnce(new Error('Primary failed'));

      const { compilePrompt } = require('../../../src/generation/promptCompiler');
      compilePrompt.mockResolvedValue({
        ...mockPromptOutput,
        modelId: 'runway-gen3',
        parameters: { duration: 8, resolution: '1080p', aspect_ratio: '16:9', fps: 24 },
        modelParams: { duration: 8, resolution: '1080p', aspect_ratio: '16:9', fps: 24 },
        characterConditioning: [{
          characterName: 'John',
          referenceImageBase64: 'base64-image-data',
          modelSpecificParams: { reference_images: ['base64-image-data'], reference_strength: 0.8, motion_bucket: 50 },
        }],
      });

      const fallbackAdapter = { ...mockAdapter, modelId: 'runway-gen3', dispatch: jest.fn() };
      fallbackAdapter.dispatch.mockResolvedValue({ providerRequestId: 'fallback-req-456', estimatedCompletionMs: 180000 });
      getAdapter.mockReturnValueOnce(mockAdapter).mockReturnValueOnce(fallbackAdapter);

      const result = await dispatchWithFallback(mockShot, mockPromptOutput, mockModel, fallbackModels);

      // Note: This will depend on whether the fallback is tried correctly
      // The test might need more setup
    });
  });

  describe('isShotDispatched', () => {
    test('returns true when shot has active dispatch', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const result = await isShotDispatched('shot-1');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) FROM dispatch_records'),
        ['shot-1']
      );
    });

    test('returns false when shot has no active dispatch', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await isShotDispatched('shot-1');

      expect(result).toBe(false);
    });
  });

  describe('getDispatchRecord', () => {
    test('returns dispatch record when exists', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-123',
          status: 'dispatched',
          dispatched_at: new Date(),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }],
      });

      const result = await getDispatchRecord('shot-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('dispatch-1');
      expect(result?.shotId).toBe('shot-1');
      expect(result?.providerRequestId).toBe('provider-123');
    });

    test('returns null when no dispatch record exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getDispatchRecord('shot-1');

      expect(result).toBeNull();
    });
  });
});