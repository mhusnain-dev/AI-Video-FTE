/**
 * Unit tests for Webhook Watchdog (Phase 4.4)
 */

import { runWatchdogOnce, getWatchdogStats } from '../../../src/dispatch/webhookWatchdog';
import type { DispatchRecord, ShotPlan, ModelCapabilities, GenerationResult } from '../../../src/shared/types';
import type { CompiledPrompt, FaceLockConditioning } from '../../../src/shared/types';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/router/modelAdapter', () => ({
  getAdapter: jest.fn(),
  initializeAdapters: jest.fn(),
}));

jest.mock('../../../src/dispatch/webhookHandler', () => ({
  handleWebhook: jest.fn(),
}));

jest.mock('../../../src/dispatch/shotDispatcher', () => ({
  dispatchWithFallback: jest.fn(),
}));

jest.mock('../../../src/shared/events', () => ({
  shotStateMachine: { setCurrentState: jest.fn() },
  emitShotStateChange: jest.fn(),
}));

jest.mock('../../../src/router/autoRouter', () => ({
  selectModelForShot: jest.fn(),
}));

jest.mock('../../../src/generation/promptCompiler', () => ({
  compilePrompt: jest.fn(),
}));

const mockQuery = require('../../../src/shared/db').query;
const { getAdapter } = require('../../../src/router/modelAdapter');
const { handleWebhook } = require('../../../src/dispatch/webhookHandler');
const { dispatchWithFallback } = require('../../../src/dispatch/shotDispatcher');
const { selectModelForShot } = require('../../../src/router/autoRouter');
const { compilePrompt } = require('../../../src/generation/promptCompiler');

describe('Webhook Watchdog', () => {
  const mockShot: ShotPlan = {
    id: 'shot-1',
    storyId: 'story-1',
    order: 1,
    visualDescription: 'Test shot',
    durationSeconds: 8,
    cameraMotion: 'static',
    characters: ['John'],
    keyObjects: [],
    keyActions: [],
    status: 'dispatched',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDispatchRecord: DispatchRecord = {
    id: 'dispatch-1',
    shotId: 'shot-1',
    modelId: 'veo3-low',
    providerRequestId: 'provider-req-123',
    status: 'dispatched',
    dispatchedAt: new Date(Date.now() - 60000), // 1 minute ago
    completedAt: undefined,
    error: undefined,
    fallbackFromDispatchId: undefined,
  };

  const mockPrimaryModel: ModelCapabilities = {
    id: 'veo3-low',
    name: 'Veo 3 Low Quality',
    provider: 'google',
    maxResolution: '1080p',
    maxDurationSeconds: 8,
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    supportedRegions: ['us'],
    costPerSecondUsd: 0,
    costCurrency: 'USD',
    capabilities: ['text_to_video', 'reference_conditioning'],
    defaultTimeoutSeconds: 120,
  };

  const mockFallbackModel: ModelCapabilities = {
    ...mockPrimaryModel,
    id: 'runway-gen3',
    name: 'Runway Gen-3',
    costPerSecondUsd: 0.05,
  };

  const mockPromptOutput: CompiledPrompt = {
    modelId: 'veo3-low',
    shotId: 'shot-1',
    prompt: 'Test prompt',
    negativePrompt: '',
    parameters: {},
    modelParams: {},
    characterConditioning: [{
      characterName: 'John',
      referenceImageBase64: 'base64-image',
      modelSpecificParams: {},
    }],
    styleReferences: [],
  };

  const mockGenerationResult: GenerationResult = {
    shotId: 'shot-1',
    videoUrl: 'https://example.com/video.mp4',
    durationSeconds: 8,
    actualCost: 0,
    modelId: 'veo3-low',
    providerMetadata: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();

    // Default mock for stuck dispatches query
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));

    // Default mocks for processStuckDispatch internals
    getAdapter.mockReturnValue({
      modelId: 'veo3-low',
      provider: 'google',
      checkStatus: jest.fn(),
    });

    // Mock selectModelForShot
    selectModelForShot.mockResolvedValue({
      modelId: 'veo3-low',
      model: mockPrimaryModel,
      fallbackModels: [mockFallbackModel],
      reason: 'test',
      isOverride: false,
    });

    // Mock compilePrompt
    compilePrompt.mockResolvedValue(mockPromptOutput);
  });

  describe('runWatchdogOnce', () => {
    test('returns zeros when no stuck dispatches found', async () => {
      // Mock findStuckDispatches returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(0);
      expect(result.recovered).toBe(0);
      expect(result.timedOut).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    test('recovers completed dispatch via webhook handler', async () => {
      // Mock findStuckDispatches returns one stuck dispatch
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 60000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      // Mock shot query
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...mockShot, story_id: 'story-1', user_id: 'user-1' }] });

      // Mock adapter checkStatus returns completed
      const mockAdapter = getAdapter('veo3-low');
      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'completed',
        result: mockGenerationResult,
      });

      // Mock webhook handler returns success
      handleWebhook.mockResolvedValueOnce({
        success: true,
        status: 'completed',
        shotId: 'shot-1',
      });

      // Mock characters query
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'John', story_id: 'story-1' }] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.recovered).toBe(1);
      expect(result.timedOut).toBe(0);
      expect(result.failed).toBe(0);
      expect(handleWebhook).toHaveBeenCalledWith('google', expect.objectContaining({
        requestId: 'provider-req-123',
        status: 'completed',
      }), { skipVerification: true });
    });

    test('times out dispatch that exceeded max wait (10min)', async () => {
      // Mock findStuckDispatches returns one stuck dispatch dispatched 15 min ago
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      // Mock shot query
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...mockShot, story_id: 'story-1', user_id: 'user-1' }] });

      // Mock adapter checkStatus returns still processing
      const mockAdapter = getAdapter('veo3-low');
      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'processing',
        result: null,
      });

      // Mock update query for timeout
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Mock fallback dispatch
      dispatchWithFallback.mockResolvedValueOnce({ success: true });

      // Mock characters query
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'John', story_id: 'story-1' }] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.timedOut).toBe(1);
      expect(result.recovered).toBe(0);
    });

    test('marks dispatch as failed when provider reports failure', async () => {
      // Mock findStuckDispatches
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 60000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      // Mock shot query
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...mockShot, story_id: 'story-1', user_id: 'user-1' }] });

      // Mock adapter checkStatus returns failed
      const mockAdapter = getAdapter('veo3-low');
      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'failed',
        error: 'Model quota exceeded',
        result: null,
      });

      // Mock update query for failure
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Mock fallback dispatch
      dispatchWithFallback.mockResolvedValueOnce({ success: true });

      // Mock characters query
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'John', story_id: 'story-1' }] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.recovered).toBe(0);
    });

    test('handles missing adapter gracefully', async () => {
      // Mock findStuckDispatches
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'unknown-model',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 60000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      // Mock shot query
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...mockShot, story_id: 'story-1', user_id: 'user-1' }] });

      // No adapter for unknown model
      getAdapter.mockReturnValueOnce(undefined);

      // Mock fallback dispatch
      dispatchWithFallback.mockResolvedValueOnce({ success: true });

      // Mock characters query
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'John', story_id: 'story-1' }] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('No adapter for model unknown-model');
    });

    test('handles webhook handler failure during recovery', async () => {
      // Mock findStuckDispatches
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 60000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      // Mock shot query
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...mockShot, story_id: 'story-1', user_id: 'user-1' }] });

      // Mock adapter checkStatus returns completed
      const mockAdapter = getAdapter('veo3-low');
      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'completed',
        result: mockGenerationResult,
      });

      // Mock webhook handler returns failure
      handleWebhook.mockResolvedValueOnce({
        success: false,
        status: 'failed',
        error: 'Face-Lock verification failed',
      });

      // Mock fallback dispatch
      dispatchWithFallback.mockResolvedValueOnce({ success: true });

      // Mock characters query
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'John', story_id: 'story-1' }] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Face-Lock verification failed');
    });

    test('leaves still-processing dispatches alone', async () => {
      // Mock findStuckDispatches - one stuck but still within timeout
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 60000), // 1 min ago
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      // Mock shot query
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...mockShot, story_id: 'story-1', user_id: 'user-1' }] });

      // Mock adapter checkStatus returns processing
      const mockAdapter = getAdapter('veo3-low');
      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'processing',
        result: null,
      });

      // Mock characters query
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'John', story_id: 'story-1' }] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.recovered).toBe(0);
      expect(result.timedOut).toBe(0);
      expect(result.failed).toBe(0);
    });

    test('triggers fallback on timeout', async () => {
      // Mock findStuckDispatches - exceeded max wait
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 15 * 60 * 1000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      // Mock shot query
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...mockShot, story_id: 'story-1', user_id: 'user-1' }] });

      // Mock adapter checkStatus returns processing
      const mockAdapter = getAdapter('veo3-low');
      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'processing',
        result: null,
      });

      // Mock update timeout
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Mock fallback dispatch success
      dispatchWithFallback.mockResolvedValueOnce({ success: true });

      // Mock characters query
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'John', story_id: 'story-1' }] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.timedOut).toBe(1);
      expect(dispatchWithFallback).toHaveBeenCalled();
    });

    test('triggers fallback on failure', async () => {
      // Mock findStuckDispatches
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 60000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      // Mock shot query
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ...mockShot, story_id: 'story-1', user_id: 'user-1' }] });

      // Mock adapter checkStatus returns failed
      const mockAdapter = getAdapter('veo3-low');
      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'failed',
        error: 'Internal error',
        result: null,
      });

      // Mock update failure
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Mock fallback dispatch success
      dispatchWithFallback.mockResolvedValueOnce({ success: true });

      // Mock characters query
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'John', story_id: 'story-1' }] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.failed).toBe(1);
      expect(dispatchWithFallback).toHaveBeenCalled();
    });
  });

  describe('getWatchdogStats', () => {
    test('returns stats for stuck dispatches', async () => {
      // Mock findStuckDispatches
      mockQuery.mockResolvedValueOnce({ rows: [
        {
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'req-1',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 60000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        },
        {
          id: 'dispatch-2',
          shot_id: 'shot-2',
          model_id: 'veo3-low',
          provider_request_id: 'req-2',
          status: 'generating',
          dispatched_at: new Date(Date.now() - 120000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        },
        {
          id: 'dispatch-3',
          shot_id: 'shot-3',
          model_id: 'runway-gen3',
          provider_request_id: 'req-3',
          status: 'dispatched',
          dispatched_at: new Date(Date.now() - 180000),
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        },
      ] });

      const stats = await getWatchdogStats();

      expect(stats.stuckDispatches).toBe(3);
      expect(stats.byStatus).toEqual({ dispatched: 2, generating: 1 });
      expect(stats.byModel).toEqual({ 'veo3-low': 2, 'runway-gen3': 1 });
      expect(stats.oldestStuckMinutes).toBeDefined();
      expect(stats.oldestStuckMinutes).toBeGreaterThanOrEqual(3);
    });

    test('returns zeros when no stuck dispatches', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const stats = await getWatchdogStats();

      expect(stats.stuckDispatches).toBe(0);
      expect(stats.byStatus).toEqual({});
      expect(stats.byModel).toEqual({});
      expect(stats.oldestStuckMinutes).toBeUndefined();
    });
  });
});