/**
 * Unit tests for Webhook Ingestion Handler (Phase 4.3)
 * Targeting 100% branch coverage for reachable code
 *
 * Note: storeFaceLockVerificationData (lines 276-298) is defined but never
 * called from handleWebhook — it is dead code. To achieve 100% branch coverage
 * on that function, it would need to be exported or called from handleWebhook.
 */

import { handleWebhook, getWebhookStats, storeFaceLockVerificationData } from '../../../src/dispatch/webhookHandler';
import type { WebhookPayload, DispatchRecord, GenerationResult } from '../../../src/shared/types';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/router/modelAdapter', () => ({
  getAdapter: jest.fn(),
  getAllAdapters: jest.fn(),
}));

jest.mock('../../../src/shared/events', () => ({
  emitShotStateChange: jest.fn(),
  shotStateMachine: { setCurrentState: jest.fn() },
  storyStateMachine: { transition: jest.fn() },
}));

jest.mock('../../../src/dispatch/shotDispatcher', () => ({
  mapRowToDispatchRecord: jest.fn(),
}));

jest.mock('../../../src/dispatch/timeoutManager', () => ({
  cancelDispatchTimeout: jest.fn(),
}));

jest.mock('../../../src/verification/faceLockVerification', () => ({
  verifyShotCharacters: jest.fn(),
  storeVerificationResult: jest.fn(),
  shouldRegenerateShot: jest.fn(),
  triggerFaceLockRegeneration: jest.fn(),
}));

jest.mock('../../../src/ingestion/characterService', () => ({
  getCharacterReferences: jest.fn(),
}));

jest.mock('../../../src/shared/metrics', () => ({
  webhookReceivedTotal: { inc: jest.fn() },
  webhookProcessingLatencySeconds: { observe: jest.fn() },
  webhookUnrecognizedTotal: { inc: jest.fn() },
  dispatchesInFlightGauge: { dec: jest.fn() },
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    faceLock: {
      maxRetries: 2,
    },
  },
}));

const mockQuery = require('../../../src/shared/db').query;
const { getAdapter, getAllAdapters } = require('../../../src/router/modelAdapter');
const { mapRowToDispatchRecord } = require('../../../src/dispatch/shotDispatcher');
const { emitShotStateChange, storyStateMachine } = require('../../../src/shared/events');
const { cancelDispatchTimeout } = require('../../../src/dispatch/timeoutManager');
const { verifyShotCharacters, storeVerificationResult, shouldRegenerateShot, triggerFaceLockRegeneration } = require('../../../src/verification/faceLockVerification');
const { getCharacterReferences } = require('../../../src/ingestion/characterService');
const { config } = require('../../../src/shared/config');

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
    getAllAdapters.mockReturnValue([mockAdapter]);
    mockAdapter.verifyWebhook.mockReturnValue(true);
    mockAdapter.parseWebhook.mockReturnValue(mockPayload.result);
    mapRowToDispatchRecord.mockReturnValue(mockDispatchRecord);
    verifyShotCharacters.mockResolvedValue([]);
    storeVerificationResult.mockResolvedValue(undefined);
    shouldRegenerateShot.mockReturnValue({ shouldRegenerate: false });
    triggerFaceLockRegeneration.mockResolvedValue(undefined);
    getCharacterReferences.mockResolvedValue([]);
    storyStateMachine.transition.mockResolvedValue(undefined);
  });

  describe('handleWebhook', () => {
    test('successfully processes completed webhook', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: SELECT story_id
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '1', failed: '0' }] }) // 5. checkAllShots: COUNT
        .mockResolvedValueOnce({ rows: [{ status: 'generating' }] }) // 6. checkAllShots: story status
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 7. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.shotId).toBe('shot-1');
      expect(result.dispatchRecord?.status).toBe('completed');
      expect(mockAdapter.verifyWebhook).toHaveBeenCalledWith(mockPayload);
      expect(mockAdapter.parseWebhook).toHaveBeenCalledWith(mockPayload);
      expect(cancelDispatchTimeout).toHaveBeenCalledWith('dispatch-1');
      expect(emitShotStateChange).toHaveBeenCalledWith(
        'shot-1', 'dispatched', 'completed', 'generation_complete', expect.any(Object)
      );
    });

    test('handles failed webhook', async () => {
      const failedPayload: WebhookPayload = {
        ...mockPayload,
        status: 'failed',
        error: 'Model timeout',
        result: undefined,
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus (with error_message)
        .mockResolvedValueOnce({ rows: [] })                          // 4. checkAllShots: shot not found → early return
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 5. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      const result = await handleWebhook(mockProvider, failedPayload);

      expect(result.success).toBe(true);
      expect(result.status).toBe('failed');
      expect(emitShotStateChange).toHaveBeenCalledWith(
        'shot-1', 'dispatched', 'failed', 'generation_failed', expect.any(Object)
      );
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

    test('handles duplicate webhook with completed status (idempotency - EC-008)', async () => {
      const completedRow = { ...mockDispatchRow, status: 'completed', completed_at: new Date(), webhook_received_at: new Date() };
      const completedRecord = { ...mockDispatchRecord, status: 'completed' };

      mockQuery.mockResolvedValueOnce({ rows: [completedRow] });
      mapRowToDispatchRecord.mockReturnValue(completedRecord);
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(true);
      expect(result.status).toBe('duplicate');
      expect(result.error).toContain('Duplicate webhook ignored');
    });

    test('handles duplicate webhook with failed status (idempotency)', async () => {
      const failedRow = { ...mockDispatchRow, status: 'failed', completed_at: new Date(), webhook_received_at: new Date() };
      const failedRecord = { ...mockDispatchRecord, status: 'failed' };

      mockQuery.mockResolvedValueOnce({ rows: [failedRow] });
      mapRowToDispatchRecord.mockReturnValue(failedRecord);
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(true);
      expect(result.status).toBe('duplicate');
    });

    test('handles unrecognized webhook (no dispatch record - EC-007)', async () => {
      mapRowToDispatchRecord.mockReturnValue(null);
      mockQuery.mockResolvedValueOnce({ rows: [] });  // findDispatchRecordByProviderRequestId
      mockQuery.mockResolvedValueOnce({ rows: [] });  // logUnrecognizedWebhook INSERT
      mockQuery.mockResolvedValueOnce({ rows: [] });  // emitUnrecognizedWebhookEvent INSERT

      const result = await handleWebhook(mockProvider, mockPayload);

      expect(result.success).toBe(true);
      expect(result.status).toBe('unrecognized');
    });

    test('skips HMAC verification when option provided', async () => {
      mockAdapter.verifyWebhook.mockReturnValue(false);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [] })                          // 4. checkAllShots: shot not found → early return
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 5. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, mockPayload, { skipVerification: true });

      expect(mockAdapter.verifyWebhook).not.toHaveBeenCalled();
    });

    test('records actual cost when completed with cost > 0', async () => {
      const payloadWithCost: WebhookPayload = {
        ...mockPayload,
        result: {
          ...mockPayload.result!,
          actualCost: 1.50,
        },
      };

      mockAdapter.parseWebhook.mockReturnValue(payloadWithCost.result);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. recordActualCost: SELECT story_id
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] })    // 5. recordActualCost: SELECT user_id
        .mockResolvedValueOnce({ rows: [] })                          // 6. recordActualCost: INSERT cost_records
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 7. checkAllShots: SELECT story_id
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '1', failed: '0' }] }) // 8. checkAllShots: COUNT
        .mockResolvedValueOnce({ rows: [{ status: 'generating' }] }) // 9. checkAllShots: story status
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 10. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, payloadWithCost);

      const costCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0] && call[0].includes('INSERT INTO cost_records')
      );
      expect(costCall).toBeDefined();
      if (costCall) {
        expect(costCall[1]).toEqual(
          expect.arrayContaining(['story-1', 'shot-1', 'veo3-low', 'user-1', 1.5, expect.stringContaining('"shotId":"shot-1"')])
        );
      }
    });

    test('does not record cost when actualCost is 0', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [] })                          // 4. checkAllShots: shot not found
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 5. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, mockPayload);

      const costCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0] && call[0].includes('INSERT INTO cost_records')
      );
      expect(costCall).toBeUndefined();
    });

    test('emits state change with generating fromState when record status is not dispatched', async () => {
      const generatingRecord = { ...mockDispatchRecord, status: 'generating' };
      mapRowToDispatchRecord.mockReturnValue(generatingRecord);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [] })                          // 4. checkAllShots: shot not found
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 5. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, mockPayload);

      expect(emitShotStateChange).toHaveBeenCalledWith(
        'shot-1', 'generating', 'completed', 'generation_complete', expect.any(Object)
      );
    });
  });

  describe('updateShotStatus edge cases', () => {
    test('includes error_message in query when provided (failed payload)', async () => {
      const failedPayload: WebhookPayload = {
        ...mockPayload,
        status: 'failed',
        error: 'Model timeout error',
        result: undefined,
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus (with error_message)
        .mockResolvedValueOnce({ rows: [] })                          // 4. checkAllShots: shot not found
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 5. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, failedPayload);

      const shotUpdateCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0] && call[0].includes('UPDATE shots SET') && call[1] && call[1].length > 2
      );
      expect(shotUpdateCall).toBeDefined();
      if (shotUpdateCall) {
        expect(shotUpdateCall[1]).toContain('Model timeout error');
      }
    });

    test('does not include error_message when not provided (completed)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus (no error_message)
        .mockResolvedValueOnce({ rows: [] })                          // 4. checkAllShots: shot not found
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 5. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      const shotUpdateCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0] && call[0].includes('UPDATE shots SET')
      );
      expect(shotUpdateCall).toBeDefined();
      if (shotUpdateCall) {
        expect(shotUpdateCall[1].length).toBe(2);
      }
    });
  });

  describe('recordActualCost edge cases', () => {
    test('returns early when shot not found', async () => {
      const payloadWithCost: WebhookPayload = {
        ...mockPayload,
        result: { ...mockPayload.result!, actualCost: 1.50 },
      };

      mockAdapter.parseWebhook.mockReturnValue(payloadWithCost.result);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [] })                          // 4. recordActualCost: shot not found → early return
        .mockResolvedValueOnce({ rows: [] })                          // 5. checkAllShots: shot not found
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 6. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await handleWebhook(mockProvider, payloadWithCost);

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Shot shot-1 not found'));
      consoleWarnSpy.mockRestore();
    });

    test('returns early when story not found for cost recording', async () => {
      const payloadWithCost: WebhookPayload = {
        ...mockPayload,
        result: { ...mockPayload.result!, actualCost: 1.50 },
      };

      mockAdapter.parseWebhook.mockReturnValue(payloadWithCost.result);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. recordActualCost: shot found
        .mockResolvedValueOnce({ rows: [] })                          // 5. recordActualCost: story not found → early return
        .mockResolvedValueOnce({ rows: [] })                          // 6. checkAllShots: shot not found
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 7. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await handleWebhook(mockProvider, payloadWithCost);

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Story story-1 not found'));
      consoleWarnSpy.mockRestore();
    });
  });

  describe('checkAllShotsAndTriggerPendingMerge edge cases', () => {
    test('uses fallback counts when counts query returns empty rows', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot found
        .mockResolvedValueOnce({ rows: [] })                          // 5. checkAllShots: counts empty → fallback used
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 6. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      // With fallback counts {total: '0', completed: '0', failed: '0'}, allDone is false
      expect(storyStateMachine.transition).not.toHaveBeenCalled();
    });

    test('returns early when shot not found for checkAllShots', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [] })                          // 4. checkAllShots: shot not found → early return
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 5. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      expect(storyStateMachine.transition).not.toHaveBeenCalled();
    });

    test('returns early when all shots not done yet', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot found
        .mockResolvedValueOnce({ rows: [{ total: '3', completed: '1', failed: '0' }] }) // 5. checkAllShots: not all done
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 6. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      expect(storyStateMachine.transition).not.toHaveBeenCalled();
    });

    test('returns early when story not found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot found
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '2', failed: '0' }] }) // 5. checkAllShots: all done
        .mockResolvedValueOnce({ rows: [] })                          // 6. checkAllShots: story not found → early return
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 7. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      expect(storyStateMachine.transition).not.toHaveBeenCalled();
    });

    test('returns early when story status is not generating/in_progress', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot found
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '2', failed: '0' }] }) // 5. checkAllShots: all done
        .mockResolvedValueOnce({ rows: [{ status: 'completed' }] })   // 6. checkAllShots: wrong status
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 7. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      expect(storyStateMachine.transition).not.toHaveBeenCalled();
    });

    test('returns early when all shots failed (completedNum === 0)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot found
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '0', failed: '2' }] }) // 5. checkAllShots: all failed
        .mockResolvedValueOnce({ rows: [{ status: 'generating' }] }) // 6. checkAllShots: story status
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 7. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('All shots failed'));
      expect(storyStateMachine.transition).not.toHaveBeenCalled();
      consoleLogSpy.mockRestore();
    });

    test('triggers pending_merge when all shots completed and story is generating', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot found
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '2', failed: '0' }] }) // 5. checkAllShots: all done
        .mockResolvedValueOnce({ rows: [{ status: 'generating' }] }) // 6. checkAllShots: story status
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 7. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      expect(storyStateMachine.transition).toHaveBeenCalledWith(
        'story-1',
        'all_shots_completed',
        { completedShots: 2, totalShots: 2, failedShots: 0 },
        'system'
      );
    });

    test('triggers pending_merge when story status is in_progress', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot found
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '2', failed: '0' }] }) // 5. checkAllShots: all done
        .mockResolvedValueOnce({ rows: [{ status: 'in_progress' }] }) // 6. checkAllShots: story status
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 7. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      expect(storyStateMachine.transition).toHaveBeenCalledWith(
        'story-1',
        'all_shots_completed',
        expect.objectContaining({ completedShots: 2, totalShots: 2, failedShots: 0 }),
        'system'
      );
    });

    test('handles error in checkAllShotsAndTriggerPendingMerge gracefully', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockRejectedValueOnce(new Error('DB connection lost'))       // 4. checkAllShots: throws → catch block
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 5. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
      });

      // Main handler should still succeed
      expect(result.success).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Webhook] Failed to check all shots'),
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('performFaceLockVerification edge cases', () => {
    test('skips verification when no characters to verify', async () => {
      getCharacterReferences.mockResolvedValue([]);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '1', failed: '0' }] }) // 5. counts
        .mockResolvedValueOnce({ rows: [{ status: 'generating' }] }) // 6. story status
        .mockResolvedValueOnce({ rows: [] })                          // 7. getCharacterReferencesForShot: no characters → early return
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
        result: {
          ...mockPayload.result!,
          videoUrl: 'https://example.com/video.mp4',
        },
      });

      expect(verifyShotCharacters).not.toHaveBeenCalled();
    });

    test('skips verification when shot has no characters field', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '1', failed: '0' }] }) // 5. counts
        .mockResolvedValueOnce({ rows: [{ status: 'generating' }] }) // 6. story status
        .mockResolvedValueOnce({ rows: [{ characters: null, story_id: 'story-1' }] }) // 7. getCharacterReferencesForShot: null characters
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
        result: {
          ...mockPayload.result!,
          videoUrl: 'https://example.com/video.mp4',
        },
      });

      expect(verifyShotCharacters).not.toHaveBeenCalled();
    });

    test('skips verification when shot not found for face-lock', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '1', failed: '0' }] }) // 5. counts
        .mockResolvedValueOnce({ rows: [{ status: 'generating' }] }) // 6. story status
        .mockResolvedValueOnce({ rows: [] })                          // 7. getCharacterReferencesForShot: not found → early return
        .mockResolvedValue({ rows: [] });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
        result: {
          ...mockPayload.result!,
          videoUrl: 'https://example.com/video.mp4',
        },
      });

      expect(verifyShotCharacters).not.toHaveBeenCalled();
    });

    test('performs verification and stores results when characters exist', async () => {
      const mockCharacters = [{ name: 'John', storyId: 'story-1' }];
      getCharacterReferences.mockResolvedValue(mockCharacters);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '1', failed: '0' }] }) // 5. checkAllShots: counts → not all done, returns early
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 6. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      const verificationResults = [{
        characterName: 'John',
        passed: true,
        similarityScore: 0.9,
      }];

      verifyShotCharacters.mockResolvedValue(verificationResults);
      shouldRegenerateShot.mockReturnValue({ shouldRegenerate: false });

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
        result: {
          ...mockPayload.result!,
          videoUrl: 'https://example.com/video.mp4',
        },
      });

      expect(verifyShotCharacters).toHaveBeenCalledWith(
        'shot-1',
        'https://example.com/video.mp4',
        8,
        expect.arrayContaining([expect.objectContaining({ name: 'John' })]),
        'veo3-low',
        0
      );
      expect(storeVerificationResult).toHaveBeenCalledWith(verificationResults[0]);
      expect(shouldRegenerateShot).toHaveBeenCalledWith(verificationResults, 2);
      expect(triggerFaceLockRegeneration).not.toHaveBeenCalled();
    });

    test('triggers regeneration when verification fails', async () => {
      const mockCharacters = [{ name: 'John', storyId: 'story-1' }];
      getCharacterReferences.mockResolvedValue(mockCharacters);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '1', failed: '0' }] }) // 5. checkAllShots: counts → not all done, returns early
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 6. getCharacterReferencesForShot
        .mockResolvedValueOnce({ rows: [] })                          // 7. UPDATE shots SET status = 'face_lock_failed'
        .mockResolvedValue({ rows: [] });

      const verificationResults = [{
        characterName: 'John',
        passed: false,
        similarityScore: 0.5,
      }];

      verifyShotCharacters.mockResolvedValue(verificationResults);
      shouldRegenerateShot.mockReturnValue({
        shouldRegenerate: true,
        reason: 'Face similarity below threshold',
        nextRetryCount: 1,
      });

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await handleWebhook(mockProvider, {
        ...mockPayload,
        status: 'completed',
        result: {
          ...mockPayload.result!,
          videoUrl: 'https://example.com/video.mp4',
        },
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Face-Lock verification failed')
      );
      expect(triggerFaceLockRegeneration).toHaveBeenCalledWith(
        'shot-1',
        expect.arrayContaining([expect.objectContaining({ name: 'John' })]),
        'veo3-low',
        1
      );
      expect(emitShotStateChange).toHaveBeenCalledWith(
        'shot-1',
        'completed',
        'face_lock_failed',
        'face_lock_verification_failed',
        expect.objectContaining({ reason: 'Face similarity below threshold', retryAttempt: 1 })
      );
      consoleLogSpy.mockRestore();
    });

    test('uses default maxRetries when config.faceLock.maxRetries is falsy', async () => {
      const originalMaxRetries = config.faceLock.maxRetries;
      config.faceLock.maxRetries = undefined;

      const mockCharacters = [{ name: 'John', storyId: 'story-1' }];
      getCharacterReferences.mockResolvedValue(mockCharacters);

      mockQuery
        .mockResolvedValueOnce({ rows: [mockDispatchRow] })           // 1. findDispatchRecord
        .mockResolvedValueOnce({ rows: [] })                          // 2. updateDispatchRecordWebhook
        .mockResolvedValueOnce({ rows: [] })                          // 3. updateShotStatus
        .mockResolvedValueOnce({ rows: [{ story_id: 'story-1' }] })  // 4. checkAllShots: shot
        .mockResolvedValueOnce({ rows: [{ total: '2', completed: '1', failed: '0' }] }) // 5. checkAllShots: counts → not all done
        .mockResolvedValueOnce({ rows: [{ characters: ['John'], story_id: 'story-1' }] }) // 6. getCharacterReferencesForShot
        .mockResolvedValue({ rows: [] });

      verifyShotCharacters.mockResolvedValue([]);
      shouldRegenerateShot.mockReturnValue({ shouldRegenerate: false });

      try {
        await handleWebhook(mockProvider, {
          ...mockPayload,
          status: 'completed',
          result: {
            ...mockPayload.result!,
            videoUrl: 'https://example.com/video.mp4',
          },
        });

        // Should use default maxRetries of 2
        expect(shouldRegenerateShot).toHaveBeenCalledWith([], 2);
      } finally {
        config.faceLock.maxRetries = originalMaxRetries;
      }
    });
  });

  describe('emitUnrecognizedWebhookEvent', () => {
    test('inserts into story_events for unrecognized webhook', async () => {
      mapRowToDispatchRecord.mockReturnValue(null);
      mockQuery.mockResolvedValueOnce({ rows: [] });  // findDispatchRecordByProviderRequestId
      mockQuery.mockResolvedValueOnce({ rows: [] });  // logUnrecognizedWebhook INSERT
      mockQuery.mockResolvedValueOnce({ rows: [] });  // emitUnrecognizedWebhookEvent INSERT

      await handleWebhook(mockProvider, mockPayload);

      const eventCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0] && call[0].includes('INSERT INTO story_events') && call[0].includes('unrecognized_webhook')
      );
      expect(eventCall).toBeDefined();
      if (eventCall) {
        expect(eventCall[1]).toEqual([
          JSON.stringify({ provider: mockProvider, requestId: mockRequestId }),
          JSON.stringify({ provider: mockProvider, timestamp: mockPayload.timestamp }),
        ]);
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

    test('returns zeros when no data', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ completed: null, failed: null, total: null }],
        })
        .mockResolvedValueOnce({
          rows: [{ count: null }],
        });

      const stats = await getWebhookStats();

      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.total).toBe(0);
      expect(stats.unrecognized).toBe(0);
    });
  });

  describe('storeFaceLockVerificationData', () => {
    test('returns early when shot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await storeFaceLockVerificationData('shot-1', {
        shotId: 'shot-1',
        videoUrl: 'https://example.com/video.mp4',
        durationSeconds: 8,
        actualCost: 0,
        modelId: 'veo3-low',
        providerMetadata: {},
      });

      // Only one query should be made (SELECT), no INSERT
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('returns early when shot has no characters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ characters: null, story_id: 'story-1' }] });

      await storeFaceLockVerificationData('shot-1', {
        shotId: 'shot-1',
        videoUrl: 'https://example.com/video.mp4',
        durationSeconds: 8,
        actualCost: 0,
        modelId: 'veo3-low',
        providerMetadata: {},
      });

      // Only one query should be made (SELECT), no INSERT
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('returns early when shot has empty characters array', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ characters: [], story_id: 'story-1' }] });

      await storeFaceLockVerificationData('shot-1', {
        shotId: 'shot-1',
        videoUrl: 'https://example.com/video.mp4',
        durationSeconds: 8,
        actualCost: 0,
        modelId: 'veo3-low',
        providerMetadata: {},
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('inserts verification records for each character', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ characters: ['John', 'Jane'], story_id: 'story-1' }] }) // SELECT
        .mockResolvedValueOnce({ rows: [] })  // INSERT for John
        .mockResolvedValueOnce({ rows: [] }); // INSERT for Jane

      await storeFaceLockVerificationData('shot-1', {
        shotId: 'shot-1',
        videoUrl: 'https://example.com/video.mp4',
        durationSeconds: 8,
        actualCost: 0,
        modelId: 'veo3-low',
        providerMetadata: {},
      });

      expect(mockQuery).toHaveBeenCalledTimes(3); // 1 SELECT + 2 INSERTs
      const insertCalls = mockQuery.mock.calls.filter((call: any[]) =>
        call[0] && call[0].includes('INSERT INTO face_lock_verifications')
      );
      expect(insertCalls).toHaveLength(2);
      expect(insertCalls[0][1]).toContain('John');
      expect(insertCalls[1][1]).toContain('Jane');
    });
  });
});
