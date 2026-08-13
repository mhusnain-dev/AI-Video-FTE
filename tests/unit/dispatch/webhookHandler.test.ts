/**
 * Unit tests for Webhook Ingestion Handler (Phase 4.3)
 */

import { handleWebhook, getWebhookStats } from '../../../src/dispatch/webhookHandler';
import type { WebhookPayload, DispatchRecord, GenerationResult } from '../../../src/shared/types';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/router/modelAdapter', () => ({
  getAdapter: jest.fn(),
}));

jest.mock('../../../src/shared/events', () => ({
  emitShotStateChange: jest.fn(),
  shotStateMachine: { setCurrentState: jest.fn() },
}));

jest.mock('../../../src/dispatch/shotDispatcher', () => ({
  mapRowToDispatchRecord: jest.fn(),
}));

const mockQuery = require('../../../src/shared/db').query;
const { getAdapter } = require('../../../src/router/modelAdapter');
const { mapRowToDispatchRecord } = require('../../../src/dispatch/shotDispatcher');

describe('Webhook Handler', () => {
  const mockProvider = 'google';
  const mockRequestId = 'provider-req-123';

  const mockPayload: WebhookPayload = {
    provider: mockProvider,
    requestId: mockRequestId,
    status: 'completed',
    result: {
      shotId: '',
      videoUrl: 'https://example.com/video.mp4',
      durationSeconds: 8,
      actualCost: 0.00,
      modelId: 'veo3-low',
      providerMetadata: { uri: 'https://example.com/video.mp4', mimeType: 'video/mp4' },
    },
    timestamp: new Date(),
    signature: 'valid-signature',
  };

  const mockDispatchRecord: DispatchRecord = {
    id: 'dispatch-1',
    shotId: 'shot-1',
    modelId: 'veo3-low',
    providerRequestId: mockRequestId,
    status: 'dispatched',
    dispatchedAt: new Date(),
    completedAt: undefined,
    error: undefined,
    fallbackFromDispatchId: undefined,
  };

  const mockAdapter = {
    modelId: 'veo3-low',
    provider: 'google',
    verifyWebhook: jest.fn(),
    parseWebhook: jest.fn(),
  };

  const mockDispatchRow = {
    id: 'dispatch-1',
    shot_id: 'shot-1',
    model_id: 'veo3-low',
    provider_request_id: mockRequestId,
    status: 'dispatched',
    dispatched_at: new Date(),
    completed_at: null,
    error_message: null,
    fallback_from_dispatch_id: null,
    webhook_received_at: null,
    webhook_payload: null,
    created_at: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    getAdapter.mockReturnValue(mockAdapter);
    mockAdapter.verifyWebhook.mockReturnValue(true);
    mockAdapter.parseWebhook.mockReturnValue(mockPayload.result);
    mapRowToDispatchRecord.mockReturnValue(mockDispatchRecord);
  });

  describe('handleWebhook', () => {
    test('successfully processes completed webhook', async () => {
      // First call: findDispatchRecordByProviderRequestId returns the dispatch record
      mockQuery.mockResolvedValueOnce({ rows: [mockDispatchRow] });
      // Second call: updateDispatchRecordWebhook
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Third call: shot details for cost
      mockQuery.mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] });
      // Fourth call: story for user_id
      mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] });
      // Fifth call: recordActualCost (cost=0 so this might not be called, but mock it)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // storeFaceLockVerificationData (multiple calls for characters)
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.shotId).toBe('shot-1');
      expect(result.dispatchRecord?.status).toBe('completed');
      expect(mockAdapter.verifyWebhook).toHaveBeenCalledWith(mockPayload);
      expect(mockAdapter.parseWebhook).toHaveBeenCalledWith(mockPayload);
    });

    test('handles failed webhook', async () => {
      const failedPayload: WebhookPayload = {
        ...mockPayload,
        status: 'failed',
        error: 'Model timeout',
        result: undefined,
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] }) // findDispatchRecord
        .mockResolvedValueOnce({ rows: [] }) // updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1', characters: [] }] }) // shot for characters
        .mockResolvedValueOnce({ rows: [] }); // storeFaceLockVerificationData

      const result = await handleWebhook(mockProvider, failedPayload);

      expect(result.success).toBe(true);
      expect(result.status).toBe('failed');
    });

    test('returns unrecognized for unknown provider', async () => {
      getAdapter.mockReturnValue(undefined);

      const result = await handleWebhook('unknown', mockPayload);

      expect(result.success).toBe(false);
      expect(result.status).toBe('unrecognized');
      expect(result.error).toContain('Unknown provider');
    });

    test('returns unrecognized for invalid HMAC signature', async () => {
      mockAdapter.verifyWebhook.mockReturnValue(false);

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(false);
      expect(result.status).toBe('unrecognized');
      expect(result.error).toBe('Invalid webhook signature');
    });

    test('returns unrecognized when parseWebhook returns null', async () => {
      mockAdapter.parseWebhook.mockReturnValue(null);

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(false);
      expect(result.status).toBe('unrecognized');
      expect(result.error).toBe('Failed to parse webhook payload');
    });

    test('handles duplicate webhook (idempotency - EC-008)', async () => {
      const completedRow = { ...mockDispatchRow, status: 'completed', completed_at: new Date(), webhook_received_at: new Date() };
      const completedRecord = { ...mockDispatchRecord, status: 'completed' };

      mockQuery.mockResolvedValueOnce({ rows: [completedRow] }); // findDispatchRecord returns completed record
      mapRowToDispatchRecord.mockReturnValue(completedRecord);
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(true);
      expect(result.status).toBe('duplicate');
      expect(result.error).toContain('Duplicate webhook ignored');
    });

    test('handles unrecognized webhook (no dispatch record - EC-007)', async () => {
      mapRowToDispatchRecord.mockReturnValue(null);
      mockQuery.mockResolvedValueOnce({ rows: [] }); // findDispatchRecordByProviderRequestId returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] }); // logUnrecognizedWebhook

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(true); // Return 200 to prevent retries
      expect(result.status).toBe('unrecognized');
    });

    test('skips HMAC verification when option provided', async () => {
      mockAdapter.verifyWebhook.mockReturnValue(false);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })
        .mockResolvedValueOnce({ rows: [] }) // updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] }) // shot details
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] }) // story
        .mockResolvedValueOnce({ rows: [] }); // recordActualCost

      await handleWebhook(mockProvider, mockPayload, { skipVerification: true });

      expect(mockAdapter.verifyWebhook).not.toHaveBeenCalled();
    });

    test('records actual cost when completed', async () => {
      const payloadWithCost: WebhookPayload = {
        ...mockPayload,
        result: {
          ...mockPayload.result!,
          actualCost: 1.50,
        },
      };

      // Update mock to return the payload with cost
      mockAdapter.parseWebhook.mockReturnValue(payloadWithCost.result);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] }) // findDispatchRecord
        .mockResolvedValueOnce({ rows: [] }) // updateDispatchRecord
        .mockResolvedValueOnce({ rows: [] }) // updateShotStatus (UPDATE shots)
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] }) // shot details for cost
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] }) // story for user_id
        .mockResolvedValueOnce({ rows: [] }) // recordActualCost INSERT
        .mockResolvedValueOnce({ rows: [] }) // emitShotStateChange (INSERT story_events)
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }); // storeFaceLockVerificationData

      await handleWebhook(mockProvider, payloadWithCost);

      // Verify cost was recorded with correct amount
      const costCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0] && call[0].includes('INSERT INTO cost_records')
      );
      expect(costCall).toBeDefined();
      if (costCall) {
        // Params: [storyId, shotId, modelId, userId, actualCost, metadataJSON]
        expect(costCall[1]).toEqual(
          expect.arrayContaining(['story-1', 'shot-1', 'veo3-low', 'user-1', 1.5, expect.stringContaining('"shotId":"shot-1"')])
        );
      }
    });
  });

  describe('getWebhookStats', () => {
    test('returns webhook statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ completed: '5', failed: '2', total: '7' }],
        })
        .mockResolvedValueOnce({
          rows: [{ count: '3' }],
        });

      const stats = await getWebhookStats();

      expect(stats.completed).toBe(5);
      expect(stats.failed).toBe(2);
      expect(stats.total).toBe(7);
      expect(stats.unrecognized).toBe(3);
    });
  });
});