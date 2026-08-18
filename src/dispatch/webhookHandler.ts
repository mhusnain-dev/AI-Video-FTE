/**
 * Webhook Ingestion Handler
 * Receives completion notifications from model providers, correlates to shots,
 * verifies HMAC signatures, handles idempotency, and triggers state transitions
 * Implements FR-018, EC-007, EC-008
 */

import { getAdapter } from '../router/modelAdapter.js';
import { query } from '../shared/db.js';
import { config } from '../shared/config.js';
import { shotStateMachine, emitShotStateChange, storyStateMachine } from '../shared/events.js';
import { mapRowToDispatchRecord } from './shotDispatcher.js';
import { cancelDispatchTimeout } from './timeoutManager.js';
import {
  verifyShotCharacters,
  storeVerificationResult,
  shouldRegenerateShot,
  triggerFaceLockRegeneration
} from '../verification/faceLockVerification.js';
import { getCharacterReferences } from '../ingestion/characterService.js';
import type { WebhookPayload, GenerationResult, DispatchRecord, ShotStatus, CharacterRegistryEntry } from '../shared/types.js';
// Metrics
import {
  webhookReceivedTotal,
  webhookProcessingLatencySeconds,
  webhookUnrecognizedTotal,
  dispatchesInFlightGauge,
} from '../shared/metrics.js';

export interface WebhookHandlerOptions {
  /** Skip HMAC verification (for testing only) */
  skipVerification?: boolean;
}

export interface WebhookHandlerResult {
  success: boolean;
  shotId?: string;
  status: 'completed' | 'failed' | 'duplicate' | 'unrecognized';
  error?: string;
  dispatchRecord?: DispatchRecord;
}

/**
 * Process a webhook payload from a model provider
 */
export async function handleWebhook(
  provider: string,
  payload: WebhookPayload,
  options: WebhookHandlerOptions = {}
): Promise<WebhookHandlerResult> {
  const webhookStart = Date.now();
  const { skipVerification = false } = options;

  // 1. Get adapter for provider
  const adapter = getAdapter(provider);
  if (!adapter) {
    webhookUnrecognizedTotal.inc({ provider });
    return { success: false, status: 'unrecognized', error: `Unknown provider: ${provider}` };
  }

  // 2. Verify HMAC signature (unless skipped for testing)
  if (!skipVerification && !adapter.verifyWebhook(payload)) {
    webhookUnrecognizedTotal.inc({ provider });
    return { success: false, status: 'unrecognized', error: 'Invalid webhook signature' };
  }

  // 3. Parse webhook payload into normalized GenerationResult
  const generationResult = adapter.parseWebhook(payload);
  if (!generationResult) {
    webhookUnrecognizedTotal.inc({ provider });
    return { success: false, status: 'unrecognized', error: 'Failed to parse webhook payload' };
  }

  // 4. Find dispatch record by providerRequestId
  const dispatchRecord = await findDispatchRecordByProviderRequestId(payload.requestId);
  if (!dispatchRecord) {
    // EC-007: Unrecognized completion notification - log and discard
    await logUnrecognizedWebhook(provider, payload);
    webhookUnrecognizedTotal.inc({ provider });
    return { success: true, status: 'unrecognized' }; // Return 200 to avoid retries
  }

  // 5. Idempotency check: if already completed/failed, return success (EC-008)
  if (dispatchRecord.status === 'completed' || dispatchRecord.status === 'failed') {
    webhookReceivedTotal.inc({ provider, status: 'duplicate', duplicate: 'true' });
    return {
      success: true,
      status: 'duplicate',
      shotId: dispatchRecord.shotId,
      dispatchRecord,
      error: 'Duplicate webhook ignored - already processed',
    };
  }

  // 6. Update dispatch record with webhook data
  await updateDispatchRecordWebhook(dispatchRecord.id, {
    status: payload.status === 'completed' ? 'completed' : 'failed',
    webhookReceivedAt: payload.timestamp,
    webhookPayload: payload,
    completedAt: new Date(),
    errorMessage: payload.error,
  });

  // 7. Update shot status based on webhook status
  const shotStatus = payload.status === 'completed' ? 'completed' : 'failed';
  await updateShotStatus(dispatchRecord.shotId, shotStatus, payload.error);

  // 8. Record actual cost if completed
  if (payload.status === 'completed' && generationResult.actualCost > 0) {
    await recordActualCost(dispatchRecord.shotId, dispatchRecord.modelId, generationResult.actualCost);
  }

  // 9. Emit state change event
  const fromState = (dispatchRecord.status === 'dispatched' ? 'dispatched' : 'generating') as ShotStatus;
  await emitShotStateChange(
    dispatchRecord.shotId,
    fromState,
    shotStatus,
    payload.status === 'completed' ? 'generation_complete' : 'generation_failed',
    {
      providerRequestId: payload.requestId,
      modelId: dispatchRecord.modelId,
      actualCost: generationResult.actualCost,
      videoUrl: generationResult.videoUrl,
      durationSeconds: generationResult.durationSeconds,
    }
  );

  // 10. Cancel timeout timer (FR-020) - webhook received, no fallback needed
  cancelDispatchTimeout(dispatchRecord.id);
  dispatchesInFlightGauge.dec({ model_id: dispatchRecord.modelId });

  // Record webhook metrics
  webhookReceivedTotal.inc({ provider, status: shotStatus, duplicate: 'false' });
  webhookProcessingLatencySeconds.observe({ provider }, (Date.now() - webhookStart) / 1000);

  // 11. Auto-detect: if all shots for this story are completed, transition to pending_merge
  if (shotStatus === 'completed') {
    await checkAllShotsAndTriggerPendingMerge(dispatchRecord.shotId);
  }

  // 12. Face-Lock Post-Generation Verification (FR-024)
  // If completed, verify character identity against registered references
  if (payload.status === 'completed' && generationResult.videoUrl) {
    await performFaceLockVerification(
      dispatchRecord.shotId,
      dispatchRecord.modelId,
      generationResult.videoUrl,
      generationResult.durationSeconds
    );
  }

  return {
    success: true,
    status: shotStatus,
    shotId: dispatchRecord.shotId,
    dispatchRecord: {
      ...dispatchRecord,
      status: shotStatus,
      webhookReceivedAt: payload.timestamp,
      completedAt: new Date(),
    },
  };
}

/**
 * Find dispatch record by provider request ID
 */
async function findDispatchRecordByProviderRequestId(providerRequestId: string): Promise<DispatchRecord | null> {
  const result = await query(
    `SELECT * FROM dispatch_records
     WHERE provider_request_id = $1`,
    [providerRequestId]
  );
  return result.rows.length > 0 ? mapRowToDispatchRecord(result.rows[0]) : null;
}

/**
 * Update dispatch record with webhook receipt data
 */
async function updateDispatchRecordWebhook(
  id: string,
  updates: {
    status: string;
    webhookReceivedAt: Date;
    webhookPayload: WebhookPayload;
    completedAt: Date;
    errorMessage?: string;
  }
): Promise<void> {
  await query(
    `UPDATE dispatch_records
     SET status = $2,
         webhook_received_at = $3,
         webhook_payload = $4,
         completed_at = $5,
         error_message = $6
     WHERE id = $1`,
    [id, updates.status, updates.webhookReceivedAt, JSON.stringify(updates.webhookPayload), updates.completedAt, updates.errorMessage || null]
  );
}

/**
 * Update shot status in database
 */
async function updateShotStatus(shotId: string, status: ShotStatus, errorMessage?: string): Promise<void> {
  const fields = ['status = $2', 'updated_at = NOW()'];
  const params = [shotId, status];

  if (errorMessage !== undefined) {
    fields.push('error_message = $3');
    params.push(errorMessage);
  }

  await query(
    `UPDATE shots SET ${fields.join(', ')} WHERE id = $1`,
    params
  );
}

/**
 * Record actual cost for cost tracking (FR-021)
 */
async function recordActualCost(shotId: string, modelId: string, actualCost: number): Promise<void> {
  // Get shot details for story_id and user_id
  const shotResult = await query(
    `SELECT story_id FROM shots WHERE id = $1`,
    [shotId]
  );

  if (shotResult.rows.length === 0) {
    console.warn(`Shot ${shotId} not found for cost recording`);
    return;
  }

  const storyId = shotResult.rows[0].story_id;

  // Get user_id from story
  const storyResult = await query(
    `SELECT user_id FROM stories WHERE id = $1`,
    [storyId]
  );

  if (storyResult.rows.length === 0) {
    console.warn(`Story ${storyId} not found for cost recording`);
    return;
  }

  const userId = storyResult.rows[0].user_id;

  await query(
    `INSERT INTO cost_records (story_id, shot_id, model_id, user_id, cost_type, amount_usd, currency, metadata)
     VALUES ($1, $2, $3, $4, 'actual', $5, 'USD', $6)`,
    [storyId, shotId, modelId, userId, actualCost, JSON.stringify({ shotId, modelId })]
  );
}

/**
 * Log unrecognized webhook for observability (EC-007)
 */
async function logUnrecognizedWebhook(provider: string, payload: WebhookPayload): Promise<void> {
  // Log to database for audit trail
  await query(
    `INSERT INTO webhook_unrecognized_log (provider, request_id, payload, received_at)
     VALUES ($1, $2, $3, NOW())`,
    [provider, payload.requestId, JSON.stringify(payload)]
  );

  // Also emit event for monitoring
  await emitUnrecognizedWebhookEvent(provider, payload);
}

/**
 * Store Face-Lock verification data for post-generation audit (Phase 5)
 */
async function storeFaceLockVerificationData(shotId: string, generationResult: GenerationResult): Promise<void> {
  const shotResult = await query(
    `SELECT s.characters, s.story_id FROM shots s WHERE s.id = $1`,
    [shotId]
  );

  if (shotResult.rows.length === 0) return;

  const { characters, story_id: storyId } = shotResult.rows[0];

  if (!characters || characters.length === 0) return;

  // For each character in the shot, create a placeholder verification record
  // The actual verification will be done by Phase 5 Face-Lock service
  for (const characterName of characters) {
    await query(
      `INSERT INTO face_lock_verifications (story_id, shot_id, character_name, model_id, similarity_score, threshold_used, passed, retry_count)
       VALUES ($1, $2, $3, $4, 0, 0, false, 0)
       ON CONFLICT DO NOTHING`,
      [storyId, shotId, characterName, generationResult.modelId]
    );
  }
}

/**
 * Perform Face-Lock post-generation verification (FR-024)
 * Verifies each character in the shot against their registered reference
 * Triggers auto-regeneration if verification fails (per CL-003)
 * CONSTITUTIONAL REQUIREMENT: Verification is MANDATORY - no silent failures (AGENTS.md §8.4)
 */
async function performFaceLockVerification(
  shotId: string,
  modelId: string,
  videoUrl: string,
  durationSeconds: number
): Promise<void> {
  // Get character references for this story
  const characters = await getCharacterReferencesForShot(shotId);
  if (characters.length === 0) {
    return; // No characters to verify
  }

  // Get max retries for this model/character
  const faceLockConfig = config.faceLock;
  const maxRetries = faceLockConfig.maxRetries || 2;

  // Verify each character in the shot
  const verificationResults = await verifyShotCharacters(
    shotId,
    videoUrl,
    durationSeconds,
    characters,
    modelId,
    0 // initial retry count
  );

  // Store verification results
  for (const result of verificationResults) {
    await storeVerificationResult(result);
  }

  // Check if any character failed verification
  const regenerationDecision = shouldRegenerateShot(verificationResults, maxRetries);

  if (regenerationDecision.shouldRegenerate) {
    // Trigger auto-regeneration
    console.log(`Face-Lock verification failed for shot ${shotId}: ${regenerationDecision.reason}`);

    // Update shot status to trigger regeneration
    await query(
      `UPDATE shots SET status = 'face_lock_failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [shotId, regenerationDecision.reason]
    );

    // Emit state change event
    await emitShotStateChange(
      shotId,
      'completed',
      'face_lock_failed',
      'face_lock_verification_failed',
      {
        reason: regenerationDecision.reason,
        retryAttempt: regenerationDecision.nextRetryCount,
        verificationResults,
      }
    );

    // Trigger Face-Lock regeneration with same model and incremented retry count
    await triggerFaceLockRegeneration(shotId, characters, modelId, regenerationDecision.nextRetryCount);
  }
}

/**
 * Get character registry entries for a shot
 */
async function getCharacterReferencesForShot(shotId: string): Promise<CharacterRegistryEntry[]> {
  const shotResult = await query(
    `SELECT s.characters, s.story_id FROM shots s WHERE s.id = $1`,
    [shotId]
  );

  if (shotResult.rows.length === 0) return [];

  const { characters, story_id: storyId } = shotResult.rows[0];
  if (!characters || characters.length === 0) return [];

  // Get full character registry entries
  const allCharacters = await getCharacterReferences(storyId);
  return allCharacters.filter(c => characters.includes(c.name));
}

/**
 * Emit unrecognized webhook event for monitoring
 */
async function emitUnrecognizedWebhookEvent(provider: string, payload: WebhookPayload): Promise<void> {
  await query(
    `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
     VALUES ('webhook', gen_random_uuid(), 'unrecognized_webhook', null, null, $1, $2)`,
    [JSON.stringify({ provider, requestId: payload.requestId }), JSON.stringify({ provider, timestamp: payload.timestamp })]
  );
}

/**
 * Get webhook handler statistics for monitoring
 */
export async function getWebhookStats(timeWindowMs: number = 3600000): Promise<{
  total: number;
  completed: number;
  failed: number;
  duplicates: number;
  unrecognized: number;
}> {
  const intervalStr = `${timeWindowMs} milliseconds`;
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed') as completed,
       COUNT(*) FILTER (WHERE status = 'failed') as failed,
       COUNT(*) FILTER (WHERE webhook_received_at IS NOT NULL AND status IN ('completed', 'failed')) as total
     FROM dispatch_records
     WHERE dispatched_at > NOW() - INTERVAL $1`,
    [intervalStr]
  );

  const unrecognizedResult = await query(
    `SELECT COUNT(*) as count FROM webhook_unrecognized_log WHERE received_at > NOW() - INTERVAL $1`,
    [intervalStr]
  );

  return {
    total: parseInt(result.rows[0].total) || 0,
    completed: parseInt(result.rows[0].completed) || 0,
    failed: parseInt(result.rows[0].failed) || 0,
    duplicates: 0, // Would need additional tracking
    unrecognized: parseInt(unrecognizedResult.rows[0].count) || 0,
  };
}

/**
 * Check if all shots for a story are completed, and if so, transition to pending_merge.
 * This triggers the human-approval merge flow.
 */
async function checkAllShotsAndTriggerPendingMerge(shotId: string): Promise<void> {
  try {
    // Get the story ID from the shot
    const shotResult = await query(
      `SELECT story_id FROM shots WHERE id = $1`,
      [shotId]
    );

    if (shotResult.rows.length === 0) return;
    const storyId = shotResult.rows[0].story_id;

    // Count total vs completed shots
    const countsResult = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM shots WHERE story_id = $1`,
      [storyId]
    );

    const { total, completed, failed } = countsResult.rows[0] || { total: '0', completed: '0', failed: '0' };
    const totalNum = parseInt(total);
    const completedNum = parseInt(completed);
    const failedNum = parseInt(failed);

    // All shots done if none are in-progress states
    const allDone = completedNum + failedNum >= totalNum && totalNum > 0;

    if (!allDone) return;

    // Get current story status
    const storyResult = await query(
      `SELECT status FROM stories WHERE id = $1`,
      [storyId]
    );

    if (storyResult.rows.length === 0) return;
    const storyStatus = storyResult.rows[0].status;

    // Only transition from generating/in_progress states
    if (!['generating', 'in_progress'].includes(storyStatus)) return;

    // Check if there are any successful completions (at least one shot succeeded)
    if (completedNum === 0) {
      console.log(`[Webhook] All shots failed for story ${storyId} — not triggering merge`);
      return;
    }

    console.log(`[Webhook] All ${completedNum}/${totalNum} shots completed for story ${storyId} — transitioning to pending_merge`);

    // Transition story to pending_merge (waits for human approval)
    await storyStateMachine.transition(storyId, 'all_shots_completed', {
      completedShots: completedNum,
      totalShots: totalNum,
      failedShots: failedNum,
    }, 'system');
  } catch (error) {
    console.error(`[Webhook] Failed to check all shots for story:`, error);
  }
}