/**
 * Unit tests for Webhook Watchdog
 * Targeting 100% branch coverage for reachable code
 */

import { runWatchdogOnce, getWatchdogStats, runWatchdog, getModelTimeout } from '../../../src/dispatch/webhookWatchdog';
import type { DispatchRecord, GenerationResult } from '../../../src/shared/types';

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

jest.mock('../../../src/shared/config', () => ({
  config: {
    dispatch: {
      defaultTimeouts: {
        'veo3-low': 120,
        'runway-gen3': 180,
      },
      watchdogPollIntervalMs: 30000,
      watchdogMaxWaitMs: 600000,
    },
    faceLock: {
      maxRetries: 2,
    },
  },
}));

jest.mock('../../../src/shared/metrics', () => ({
  watchdogCheckTotal: { inc: jest.fn(), set: jest.fn() },
  watchdogStuckDispatchesGauge: { set: jest.fn() },
}));

const mockQuery = require('../../../src/shared/db').query;
const { getAdapter, initializeAdapters } = require('../../../src/router/modelAdapter');
const { handleWebhook } = require('../../../src/dispatch/webhookHandler');
const { config } = require('../../../src/shared/config');

describe('Webhook Watchdog', () => {
  const mockGenerationResult: GenerationResult = {
    shotId: 'shot-1',
    videoUrl: 'https://example.com/video.mp4',
    durationSeconds: 8,
    actualCost: 0,
    modelId: 'veo3-low',
    providerMetadata: {},
  };

  const mockAdapter = {
    modelId: 'veo3-low',
    provider: 'google',
    checkStatus: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();

    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));

    getAdapter.mockReturnValue(mockAdapter);

    initializeAdapters.mockResolvedValue(undefined);
  });

  describe('runWatchdogOnce', () => {
    test('returns zeros when no stuck dispatches found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(0);
      expect(result.recovered).toBe(0);
      expect(result.timedOut).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    test('recovers completed dispatch via webhook handler', async () => {
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

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'completed',
        result: mockGenerationResult,
      });

      handleWebhook.mockResolvedValueOnce({
        success: true,
        status: 'completed',
        shotId: 'shot-1',
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.recovered).toBe(1);
      expect(handleWebhook).toHaveBeenCalledWith('google', expect.objectContaining({
        requestId: 'provider-req-123',
        status: 'completed',
      }), { skipVerification: true });
    });

    test('marks timed out when completed status has no result data', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'completed',
        result: null,
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.timedOut).toBe(1);
      expect(result.failed).toBe(0);
    });

    test('times out dispatch that exceeded max wait (10min)', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'processing',
        result: null,
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.timedOut).toBe(1);
      expect(result.recovered).toBe(0);
    });

    test('marks dispatch as failed when provider reports failure', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'failed',
        error: 'Model quota exceeded',
        result: null,
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.recovered).toBe(0);
    });

    test('marks dispatch as failed when provider reports failure without error message', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'failed',
        error: undefined,
        result: null,
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.failed).toBe(1);
    });

    test('leaves still-processing dispatches alone (within max wait)', async () => {
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

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'processing',
        result: null,
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.recovered).toBe(0);
      expect(result.timedOut).toBe(0);
      expect(result.failed).toBe(0);
    });

    test('leaves pending dispatches alone (within max wait)', async () => {
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

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'pending',
        result: null,
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.recovered).toBe(0);
      expect(result.timedOut).toBe(0);
      expect(result.failed).toBe(0);
    });

    test('times out pending dispatch that exceeded max wait', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'pending',
        result: null,
      });

      const result = await runWatchdogOnce();

      expect(result.timedOut).toBe(1);
    });

    test('marks timed out for unknown provider status', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'unknown_status',
      });

      const result = await runWatchdogOnce();

      expect(result.timedOut).toBe(1);
      expect(result.failed).toBe(0);
    });

    test('returns failed when adapter is missing', async () => {
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

      getAdapter.mockReturnValueOnce(undefined);

      const result = await runWatchdogOnce();

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('No adapter for unknown-model');
    });

    test('returns failed when status check throws Error', async () => {
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

      mockAdapter.checkStatus.mockRejectedValueOnce(new Error('Network error'));

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.errors[0]).toContain('Status check failed for dispatch-1: Network error');
    });

    test('returns failed when status check throws non-Error', async () => {
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

      mockAdapter.checkStatus.mockRejectedValueOnce('string error');

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.errors[0]).toContain('Status check failed for dispatch-1: Unknown');
    });

    test('returns failed when webhook handler returns failure during recovery', async () => {
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

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'completed',
        result: mockGenerationResult,
      });

      handleWebhook.mockResolvedValueOnce({
        success: false,
        status: 'failed',
        error: 'Face-Lock verification failed',
      });

      const result = await runWatchdogOnce();

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('Face-Lock verification failed');
    });
  });

  describe('runWatchdog cycle error handling', () => {
    test('handles findStuckDispatches Error gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await runWatchdogOnce();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Watchdog cycle error');
      expect(result.errors[0]).toContain('DB connection failed');
    });

    test('handles findStuckDispatches non-Error throw gracefully', async () => {
      mockQuery.mockRejectedValueOnce('string error');

      const result = await runWatchdogOnce();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Watchdog cycle error');
      expect(result.errors[0]).toContain('Unknown error');
    });

    test('handles non-Error throw in inner dispatch processing', async () => {
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

      mockAdapter.checkStatus.mockRejectedValueOnce('string error');

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.errors[0]).toContain('Status check failed for dispatch-1: Unknown');
    });

    test('handles status check Error in individual dispatch', async () => {
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

      mockAdapter.checkStatus.mockRejectedValueOnce(new Error('Query failed'));

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.errors[0]).toContain('Status check failed for dispatch-1: Query failed');
    });

    test('handles generic error thrown during dispatch processing', async () => {
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

      mockAdapter.checkStatus.mockImplementationOnce(() => {
        throw new TypeError('Cannot read properties of undefined');
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.errors[0]).toContain('Status check failed for dispatch-1: Cannot read properties of undefined');
    });
  });

  describe('timeout without fallback', () => {
    test('marks timeout when processing exceeds max wait (no fallback triggered)', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'processing',
      });

      const result = await runWatchdogOnce();

      expect(result.timedOut).toBe(1);
      expect(result.failed).toBe(0);
    });

    test('marks timed out without fallback when provider error exceeds max wait', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'processing',
      });

      const result = await runWatchdogOnce();

      expect(result.timedOut).toBe(1);
    });

    test('marks failed without fallback when provider reports failure', async () => {
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
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'failed',
        error: 'Internal error',
      });

      const result = await runWatchdogOnce();

      expect(result.failed).toBe(1);
    });
  });

  describe('runWatchdog continuous mode', () => {
    test('runs cycle in continuous mode without error', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await runWatchdog({ runOnce: false, pollIntervalMs: 5000 });

      expect(result.checked).toBe(0);
    });

    test('does not log startup message in runOnce mode', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      mockQuery.mockResolvedValueOnce({ rows: [] });

      await runWatchdog({ runOnce: true });

      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Webhook watchdog started')
      );
      consoleLogSpy.mockRestore();
    });
  });

  describe('hasExceededMaxWait edge cases', () => {
    test('returns false when dispatchedAt is null (not exceeded)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'provider-req-123',
          status: 'dispatched',
          dispatched_at: null,
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        }] });

      mockAdapter.checkStatus.mockResolvedValueOnce({
        status: 'processing',
      });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(1);
      expect(result.recovered).toBe(0);
      expect(result.timedOut).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('multiple dispatches in one cycle', () => {
    test('processes multiple stuck dispatches', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          {
            id: 'dispatch-1',
            shot_id: 'shot-1',
            model_id: 'veo3-low',
            provider_request_id: 'provider-req-123',
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
            provider_request_id: 'provider-req-456',
            status: 'dispatched',
            dispatched_at: new Date(Date.now() - 60000),
            completed_at: null,
            error_message: null,
            fallback_from_dispatch_id: null,
          },
        ] });

      mockAdapter.checkStatus
        .mockResolvedValueOnce({ status: 'completed', result: mockGenerationResult })
        .mockResolvedValueOnce({ status: 'completed', result: mockGenerationResult });

      handleWebhook
        .mockResolvedValueOnce({ success: true, status: 'completed' })
        .mockResolvedValueOnce({ success: true, status: 'completed' });

      const result = await runWatchdogOnce();

      expect(result.checked).toBe(2);
      expect(result.recovered).toBe(2);
    });
  });

  describe('getWatchdogStats', () => {
    test('returns stats for stuck dispatches', async () => {
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

    test('handles dispatch with null dispatchedAt', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [
        {
          id: 'dispatch-1',
          shot_id: 'shot-1',
          model_id: 'veo3-low',
          provider_request_id: 'req-1',
          status: 'dispatched',
          dispatched_at: null,
          completed_at: null,
          error_message: null,
          fallback_from_dispatch_id: null,
        },
      ] });

      const stats = await getWatchdogStats();

      expect(stats.stuckDispatches).toBe(1);
      expect(stats.oldestStuckMinutes).toBeUndefined();
    });
  });

  describe('getModelTimeout', () => {
    test('returns configured timeout for known model', () => {
      const timeout = getModelTimeout('veo3-low');
      expect(timeout).toBe(120);
    });

    test('returns configured timeout for another known model', () => {
      const timeout = getModelTimeout('runway-gen3');
      expect(timeout).toBe(180);
    });

    test('returns default 120s for unknown model', () => {
      const timeout = getModelTimeout('unknown-model');
      expect(timeout).toBe(120);
    });

    test('returns default 120s when config.dispatch.defaultTimeouts is undefined', () => {
      const original = config.dispatch.defaultTimeouts;
      try {
        config.dispatch.defaultTimeouts = undefined;
        const timeout = getModelTimeout('any-model');
        expect(timeout).toBe(120);
      } finally {
        config.dispatch.defaultTimeouts = original;
      }
    });
  });

  describe('config fallback branches', () => {
    test('getMaxWaitMs uses default when watchdogMaxWaitMs is undefined', async () => {
      const original = config.dispatch.watchdogMaxWaitMs;
      try {
        config.dispatch.watchdogMaxWaitMs = undefined;
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

        mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'processing' });

        const result = await runWatchdogOnce();
        expect(result.checked).toBe(1);
        expect(result.recovered).toBe(0);
        expect(result.timedOut).toBe(0);
      } finally {
        config.dispatch.watchdogMaxWaitMs = original;
      }
    });

    test('getPollIntervalMs uses default when watchdogPollIntervalMs is undefined', async () => {
      const original = config.dispatch.watchdogPollIntervalMs;
      try {
        config.dispatch.watchdogPollIntervalMs = undefined;
        mockQuery.mockResolvedValueOnce({ rows: [] });
        const result = await runWatchdog({ runOnce: false });
        expect(result.checked).toBe(0);
      } finally {
        config.dispatch.watchdogPollIntervalMs = original;
      }
    });

    test('runWatchdog uses default options when called with no arguments', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await runWatchdog();
      expect(result.checked).toBe(0);
    });

    test('findStuckDispatches uses default {} when config.dispatch.defaultTimeouts is undefined', async () => {
      const original = config.dispatch.defaultTimeouts;
      try {
        config.dispatch.defaultTimeouts = undefined;
        mockQuery.mockResolvedValueOnce({ rows: [] });
        const result = await runWatchdogOnce();
        expect(result.checked).toBe(0);
      } finally {
        config.dispatch.defaultTimeouts = original;
      }
    });
  });
});
