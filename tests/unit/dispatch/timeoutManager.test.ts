/**
 * Unit tests for Timeout Manager (Phase 4.5)
 */

import {
  getEffectiveTimeout,
  startDispatchTimeout,
  cancelDispatchTimeout,
  hasActiveTimeout,
  cancelAllTimeouts,
  getActiveTimeoutCount
} from '../../../src/dispatch/timeoutManager';
import type { DispatchRecord, ShotPlan, ModelCapabilities } from '../../../src/shared/types';
import type { CompiledPrompt } from '../../../src/shared/types';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/router/modelAdapter', () => ({
  getAdapter: jest.fn(),
}));

jest.mock('../../../src/dispatch/shotDispatcher', () => ({
  dispatchWithFallback: jest.fn(),
}));

jest.mock('../../../src/shared/events', () => ({
  emitShotStateChange: jest.fn(),
}));

const mockConfig: any = {
  dispatch: {
    defaultTimeouts: {
      'veo3-low': 120,
    },
  },
};

jest.mock('../../../src/shared/config', () => ({
  get config() { return mockConfig; },
}));

const mockQuery = require('../../../src/shared/db').query;
const { getAdapter } = require('../../../src/router/modelAdapter');
const { dispatchWithFallback } = require('../../../src/dispatch/shotDispatcher');
const { emitShotStateChange } = require('../../../src/shared/events');

describe('Timeout Manager', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    jest.useFakeTimers();
    cancelAllTimeouts();

    // Default mocks
    getAdapter.mockReturnValue({
      modelId: 'veo3-low',
      provider: 'google',
      cancel: jest.fn().mockResolvedValue(true),
    });
    dispatchWithFallback.mockResolvedValue({ success: true });
    emitShotStateChange.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    cancelAllTimeouts();
    jest.useRealTimers();
  });

  describe('getEffectiveTimeout', () => {
    test('returns user override when provided', () => {
      const timeout = getEffectiveTimeout('veo3-low', 180);
      expect(timeout).toBe(180);
    });

    test('returns config default when no override', () => {
      const timeout = getEffectiveTimeout('veo3-low');
      expect(timeout).toBe(120); // config default
    });

    test('returns default 120s for unknown model', () => {
      const timeout = getEffectiveTimeout('unknown-model');
      expect(timeout).toBe(120);
    });

    test('returns 120s when defaultTimeouts is undefined', () => {
      const orig = mockConfig.dispatch;
      mockConfig.dispatch = { defaultTimeouts: undefined };
      try {
        expect(getEffectiveTimeout('unknown-model')).toBe(120);
      } finally {
        mockConfig.dispatch = orig;
      }
    });

    test('returns 120s when dispatch config is undefined', () => {
      const orig = mockConfig.dispatch;
      mockConfig.dispatch = undefined;
      try {
        expect(getEffectiveTimeout('unknown-model')).toBe(120);
      } finally {
        mockConfig.dispatch = orig;
      }
    });
  });

  describe('startDispatchTimeout', () => {
    test('starts timer for new dispatch', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      // Mock that dispatch is still in progress when timeout fires
      mockQuery.mockResolvedValueOnce({ rows: [{
        status: 'dispatched',
        completed_at: null,
      }] });

      await startDispatchTimeout(dispatchRecord, mockShot, mockPromptOutput, mockPrimaryModel, [mockFallbackModel]);

      expect(hasActiveTimeout('dispatch-1')).toBe(true);
      expect(getActiveTimeoutCount()).toBe(1);
    });

    test('does not start duplicate timer for same dispatch', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      await startDispatchTimeout(dispatchRecord, mockShot, mockPromptOutput, mockPrimaryModel, [mockFallbackModel]);
      await startDispatchTimeout(dispatchRecord, mockShot, mockPromptOutput, mockPrimaryModel, [mockFallbackModel]);

      expect(getActiveTimeoutCount()).toBe(1);
    });

    test('does not start timer if already timed out (status changed)', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      // First call: start + fire timer
      mockQuery
        .mockResolvedValueOnce({ rows: [{ status: 'timeout', completed_at: new Date() }] });

      await startDispatchTimeout(dispatchRecord, mockShot, mockPromptOutput, mockPrimaryModel, [mockFallbackModel], { overrideTimeoutSeconds: 1 });
      await jest.advanceTimersByTimeAsync(1500);

      // Timer should be cleaned up
      expect(getActiveTimeoutCount()).toBe(0);
    });
  });

  describe('cancelDispatchTimeout', () => {
    test('cancels active timer', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      await startDispatchTimeout(dispatchRecord, mockShot, mockPromptOutput, mockPrimaryModel, [mockFallbackModel]);
      expect(hasActiveTimeout('dispatch-1')).toBe(true);

      cancelDispatchTimeout('dispatch-1');

      expect(hasActiveTimeout('dispatch-1')).toBe(false);
      expect(getActiveTimeoutCount()).toBe(0);
    });

    test('handles cancelling non-existent timer gracefully', () => {
      expect(() => cancelDispatchTimeout('non-existent')).not.toThrow();
    });
  });

  describe('timeout firing behavior', () => {
    test('marks shot as failed on timeout without fallback (credit protection)', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      // Mock that dispatch is still in progress when timeout fires
      mockQuery
        .mockResolvedValueOnce({ rows: [{ status: 'dispatched', completed_at: null }] }) // check dispatch status
        .mockResolvedValueOnce({ rows: [] }) // UPDATE dispatch_records
        .mockResolvedValueOnce({ rows: [] }); // UPDATE shots

      // Use a very short timeout for testing
      await startDispatchTimeout(
        dispatchRecord,
        mockShot,
        mockPromptOutput,
        mockPrimaryModel,
        [mockFallbackModel],
        { overrideTimeoutSeconds: 1 }
      );

      // Wait for timeout to fire
      await jest.advanceTimersByTimeAsync(1500);

      // Verify provider cancel was attempted
      const adapter = getAdapter('veo3-low');
      expect(adapter.cancel).toHaveBeenCalledWith('provider-req-123');

      // Verify dispatch record was updated to timeout
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE dispatch_records SET status = 'timeout'"),
        ['dispatch-1', 'Generation timeout after 1s']
      );

      // Verify shot status updated to failed
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'failed'"),
        ['shot-1', expect.stringContaining('timed out after 1s')]
      );

      // Verify NO fallback was triggered (credit protection)
      expect(dispatchWithFallback).not.toHaveBeenCalled();

      // Verify state change event emitted
      expect(emitShotStateChange).toHaveBeenCalledWith(
        'shot-1',
        'dispatched',
        'failed',
        'generation_timeout',
        expect.objectContaining({
          modelId: 'veo3-low',
          timeoutSeconds: 1,
          providerRequestId: 'provider-req-123',
        })
      );
    });

    test('handles adapter.cancel failure gracefully', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      const cancelError = new Error('Cancel failed');
      getAdapter.mockReturnValue({
        modelId: 'veo3-low',
        provider: 'google',
        cancel: jest.fn().mockRejectedValue(cancelError),
      });

      mockQuery
        .mockResolvedValueOnce({ rows: [{ status: 'dispatched', completed_at: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await startDispatchTimeout(
        dispatchRecord,
        mockShot,
        mockPromptOutput,
        mockPrimaryModel,
        [mockFallbackModel],
        { overrideTimeoutSeconds: 1 }
      );

      await jest.advanceTimersByTimeAsync(1500);

      // Verify cancel was attempted but failure was handled gracefully
      const adapter = getAdapter('veo3-low');
      expect(adapter.cancel).toHaveBeenCalledWith('provider-req-123');
      // No fallback should be triggered (credit protection)
      expect(dispatchWithFallback).not.toHaveBeenCalled();
    });

    test('does NOT trigger fallback if dispatch already completed by webhook', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      // Mock that dispatch is already completed
      mockQuery.mockResolvedValueOnce({ rows: [{
        status: 'completed',
        completed_at: new Date()
      }] });

      await startDispatchTimeout(
        dispatchRecord,
        mockShot,
        mockPromptOutput,
        mockPrimaryModel,
        [mockFallbackModel],
        { overrideTimeoutSeconds: 1 }
      );

      // Wait for timeout to fire
      await jest.advanceTimersByTimeAsync(1500);

      // Verify NO provider cancel
      const adapter = getAdapter('veo3-low');
      expect(adapter.cancel).not.toHaveBeenCalled();

      // Verify NO fallback
      expect(dispatchWithFallback).not.toHaveBeenCalled();
    });

    test('does NOT trigger fallback if dispatch already failed', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      // Mock that dispatch is already failed
      mockQuery.mockResolvedValueOnce({ rows: [{
        status: 'failed',
        completed_at: new Date()
      }] });

      await startDispatchTimeout(
        dispatchRecord,
        mockShot,
        mockPromptOutput,
        mockPrimaryModel,
        [mockFallbackModel],
        { overrideTimeoutSeconds: 1 }
      );

      // Wait for timeout to fire
      await jest.advanceTimersByTimeAsync(1500);

      const adapter = getAdapter('veo3-low');
      expect(adapter.cancel).not.toHaveBeenCalled();
      expect(dispatchWithFallback).not.toHaveBeenCalled();
    });

    test('does NOT trigger fallback when triggerFallback is false', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'dispatched', completed_at: null }] });

      await startDispatchTimeout(
        dispatchRecord,
        mockShot,
        mockPromptOutput,
        mockPrimaryModel,
        [mockFallbackModel],
        { overrideTimeoutSeconds: 1, triggerFallback: false }
      );

      await jest.advanceTimersByTimeAsync(1500);

      // Timeout metric should still be recorded
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining("UPDATE dispatch_records SET status = 'timeout'"),
        expect.anything()
      );
      expect(dispatchWithFallback).not.toHaveBeenCalled();
    });

    test('does NOT trigger fallback if dispatch record was deleted', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      // Mock that dispatch record no longer exists
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await startDispatchTimeout(
        dispatchRecord,
        mockShot,
        mockPromptOutput,
        mockPrimaryModel,
        [mockFallbackModel],
        { overrideTimeoutSeconds: 1 }
      );

      await jest.advanceTimersByTimeAsync(1500);

      const adapter = getAdapter('veo3-low');
      expect(adapter.cancel).not.toHaveBeenCalled();
      expect(dispatchWithFallback).not.toHaveBeenCalled();
    });

    test('does NOT trigger fallback if dispatch status is not dispatched/generating', async () => {
      const dispatchRecord: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      // Mock that dispatch is in fallback state
      mockQuery.mockResolvedValueOnce({ rows: [{
        status: 'fallback',
        completed_at: null
      }] });

      await startDispatchTimeout(
        dispatchRecord,
        mockShot,
        mockPromptOutput,
        mockPrimaryModel,
        [mockFallbackModel],
        { overrideTimeoutSeconds: 1 }
      );

      await jest.advanceTimersByTimeAsync(1500);

      const adapter = getAdapter('veo3-low');
      expect(adapter.cancel).not.toHaveBeenCalled();
      expect(dispatchWithFallback).not.toHaveBeenCalled();
    });
  });

  describe('cancelAllTimeouts', () => {
    test('cancels all active timers', async () => {
      const dispatch1: DispatchRecord = {
        id: 'dispatch-1',
        shotId: 'shot-1',
        modelId: 'veo3-low',
        providerRequestId: 'provider-req-123',
        status: 'dispatched',
        dispatchedAt: new Date(),
        completedAt: undefined,
        error: undefined,
        fallbackFromDispatchId: undefined,
      };

      const dispatch2: DispatchRecord = {
        ...dispatch1,
        id: 'dispatch-2',
        providerRequestId: 'provider-req-456',
      };

      await startDispatchTimeout(dispatch1, mockShot, mockPromptOutput, mockPrimaryModel, [mockFallbackModel]);
      await startDispatchTimeout(dispatch2, mockShot, mockPromptOutput, mockPrimaryModel, [mockFallbackModel]);

      expect(getActiveTimeoutCount()).toBe(2);

      cancelAllTimeouts();

      expect(getActiveTimeoutCount()).toBe(0);
      expect(hasActiveTimeout('dispatch-1')).toBe(false);
      expect(hasActiveTimeout('dispatch-2')).toBe(false);
    });
  });
});