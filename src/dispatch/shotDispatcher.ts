/**
 * Shot Dispatcher Service
 * Dispatches shots to model providers via adapters with no duplicate dispatches
 * Implements FR-017, FR-018, FR-019, FR-020
 */

import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../shared/db.js';
import { runAdmissionPipeline } from '../admission/admissionController.js';
import { getAdapter, initializeAdapters } from '../router/modelAdapter.js';
import { shotStateMachine, emitShotStateChange } from '../shared/events.js';
import { startDispatchTimeout, cancelDispatchTimeout } from './timeoutManager.js';
import type { ShotPlan, CompiledPrompt, DispatchRecord, ModelCapabilities, AdmissionContext, CharacterConditioning, CharacterRegistryEntry, FaceLockConditioning } from '../shared/types.js';
// Metrics
import {
  shotDispatchTotal,
  shotDispatchLatencySeconds,
  shotGenerationDurationSeconds,
  shotFallbackTotal,
  shotTimeoutTotal,
  dispatchesInFlightGauge,
} from '../shared/metrics.js';

export interface DispatchOptions {
  /** Override model timeout in seconds */
  timeoutSeconds?: number;
  /** Allow skipping admission (for retries/fallbacks) */
  skipAdmission?: boolean;
}

export interface DispatchResult {
  success: boolean;
  dispatchRecord?: DispatchRecord;
  error?: string;
  admissionResult?: Awaited<ReturnType<typeof runAdmissionPipeline>>;
}

/**
 * Convert prompt compiler output to shared CompiledPrompt format for dispatch
 * The promptOutput is already in the shared CompiledPrompt format (multi-character support)
 */
function convertPromptForDispatch(
  promptOutput: CompiledPrompt,
  shot: ShotPlan
): CompiledPrompt {
  // Already in the correct format - just ensure shotId is set
  return {
    ...promptOutput,
    shotId: shot.id,
  };
}

/**
 * Main shot dispatcher
 * Runs admission pipeline then dispatches to model provider
 */
export async function dispatchShot(
  shot: ShotPlan,
  promptOutput: CompiledPrompt,
  model: ModelCapabilities,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const { skipAdmission = false } = options;
  const dispatchStart = Date.now();

  // Ensure adapters are initialized
  await initializeAdapters();

  // Get adapter for the model
  const adapter = getAdapter(model.id);
  if (!adapter) {
    const error = `No adapter registered for model: ${model.id}`;
    shotDispatchTotal.inc({ model_id: model.id, status: 'no_adapter' });
    return { success: false, error };
  }

  // Convert prompt compiler output to dispatch format
  const compiledPrompt = convertPromptForDispatch(promptOutput, shot);

  // Extract reference images from character conditioning
  const referenceImages = compiledPrompt.characterConditioning.map(c => c.referenceImageBase64);

  // Get userId from story
  const storyUserResult = await query(
    `SELECT user_id FROM stories WHERE id = $1`,
    [shot.storyId]
  );
  const userId = storyUserResult.rows[0]?.user_id || '550e8400-e29b-41d4-a716-446655440000';

  // Build admission context
  const admissionContext: AdmissionContext = {
    storyId: shot.storyId,
    shotId: shot.id,
    prompt: compiledPrompt.prompt,
    referenceImages,
    modelId: model.id,
    userId,
    estimatedCost: calculateEstimatedCost(model, shot),
  };

  // Run admission pipeline (unless skipped for retry/fallback)
  if (!skipAdmission) {
    const admissionResult = await runAdmissionPipeline(admissionContext);
    if (!admissionResult.passed) {
      const blockedGate = admissionResult.blockedAtGate!;
      // Convert snake_case gate name to camelCase for results object
      const gateKey = blockedGate.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      shotDispatchTotal.inc({ model_id: model.id, status: 'admission_failed' });
      return {
        success: false,
        error: admissionResult.results[gateKey as keyof typeof admissionResult.results]?.reason || 'Admission failed',
        admissionResult,
      };
    }
  }

  // Create dispatch record (pending status)
  const dispatchRecord = await createDispatchRecord(shot, model);

  try {
    // Update shot status to dispatched
    await updateShotStatus(shot.id, 'dispatched');

    // Dispatch to model provider
    const dispatchResponse = await adapter.dispatch(compiledPrompt);

    // Record dispatch metrics
    shotDispatchTotal.inc({ model_id: model.id, status: 'dispatched' });
    shotDispatchLatencySeconds.observe({ model_id: model.id }, (Date.now() - dispatchStart) / 1000);
    dispatchesInFlightGauge.inc({ model_id: model.id });

    // Update dispatch record with provider request ID
    await updateDispatchRecord(dispatchRecord.id, {
      providerRequestId: dispatchResponse.providerRequestId,
      status: 'dispatched',
      dispatchedAt: new Date(),
    });

    // Update status to generating
    await updateShotStatus(shot.id, 'generating');

    // Emit state change event
    await emitShotStateChange(shot.id, 'dispatched', 'generating', 'dispatch_to_model', {
      modelId: model.id,
      providerRequestId: dispatchResponse.providerRequestId,
    });

    // Start timeout timer for automatic fallback (FR-020)
    const dispatchOptions = options as DispatchOptions & { timeoutSeconds?: number };

    // Get story details for resolution/aspectRatio
    const storyResult = await query(
      `SELECT aspect_ratio, resolution FROM stories WHERE id = $1`,
      [shot.storyId]
    );
    const storyAspectRatio = storyResult.rows[0]?.aspect_ratio || '16:9';
    const storyResolution = storyResult.rows[0]?.resolution || '1080p';

    const { selectModelForShot } = await import('../router/autoRouter.js');
    const routingDecision = await selectModelForShot(userId, {
      resolution: storyResolution as any,
      aspectRatio: storyAspectRatio as any,
      durationSeconds: shot.durationSeconds,
      requiredCapabilities: ['text_to_video'],
    });
    const fallbackModels = routingDecision.fallbackModels;

    // Fetch characters for Face-Lock conditioning in fallback
    const { getCharacterReferences } = await import('../ingestion/characterService.js');
    const characters = await getCharacterReferences(shot.storyId);

    await startDispatchTimeout(
      {
        ...dispatchRecord,
        providerRequestId: dispatchResponse.providerRequestId,
        status: 'dispatched',
        dispatchedAt: new Date(),
      },
      shot,
      promptOutput,
      model,
      fallbackModels,
      { overrideTimeoutSeconds: dispatchOptions.timeoutSeconds, characters }
    );

    return {
      success: true,
      dispatchRecord: {
        ...dispatchRecord,
        providerRequestId: dispatchResponse.providerRequestId,
        status: 'dispatched',
        dispatchedAt: new Date(),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown dispatch error';

    // Update dispatch record as failed
    await updateDispatchRecord(dispatchRecord.id, {
      status: 'failed',
      errorMessage,
      completedAt: new Date(),
    });

    // Update shot status
    await updateShotStatus(shot.id, 'failed', errorMessage);

    return {
      success: false,
      error: errorMessage,
      dispatchRecord: {
        ...dispatchRecord,
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
      },
    };
  }
}

/**
 * Create a new dispatch record
 */
async function createDispatchRecord(shot: ShotPlan, model: ModelCapabilities): Promise<DispatchRecord> {
  const id = uuidv4();

  await query(
    `INSERT INTO dispatch_records (id, shot_id, model_id, status)
     VALUES ($1, $2, $3, 'pending')`,
    [id, shot.id, model.id]
  );

  return {
    id,
    shotId: shot.id,
    modelId: model.id,
    providerRequestId: undefined,
    status: 'pending',
    dispatchedAt: new Date(), // Placeholder, updated on actual dispatch
    completedAt: undefined,
    error: undefined,
    fallbackFromDispatchId: undefined,
  };
}

/**
 * Update dispatch record
 */
export async function updateDispatchRecord(
  id: string,
  updates: {
    providerRequestId?: string;
    status?: string;
    dispatchedAt?: Date;
    completedAt?: Date;
    errorMessage?: string;
    fallbackFromDispatchId?: string;
    webhookReceivedAt?: Date;
    webhookPayload?: any;
  }
): Promise<void> {
  const fields: string[] = [];
  const params: any[] = [id];
  let paramIndex = 2;

  if (updates.providerRequestId !== undefined) {
    fields.push(`provider_request_id = $${paramIndex++}`);
    params.push(updates.providerRequestId);
  }
  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    params.push(updates.status);
  }
  if (updates.dispatchedAt !== undefined) {
    fields.push(`dispatched_at = $${paramIndex++}`);
    params.push(updates.dispatchedAt);
  }
  if (updates.completedAt !== undefined) {
    fields.push(`completed_at = $${paramIndex++}`);
    params.push(updates.completedAt);
  }
  if (updates.errorMessage !== undefined) {
    fields.push(`error_message = $${paramIndex++}`);
    params.push(updates.errorMessage);
  }
  if (updates.fallbackFromDispatchId !== undefined) {
    fields.push(`fallback_from_dispatch_id = $${paramIndex++}`);
    params.push(updates.fallbackFromDispatchId);
  }
  if (updates.webhookReceivedAt !== undefined) {
    fields.push(`webhook_received_at = $${paramIndex++}`);
    params.push(updates.webhookReceivedAt);
  }
  if (updates.webhookPayload !== undefined) {
    fields.push(`webhook_payload = $${paramIndex++}`);
    params.push(JSON.stringify(updates.webhookPayload));
  }

  if (fields.length > 0) {
    await query(
      `UPDATE dispatch_records SET ${fields.join(', ')} WHERE id = $1`,
      params
    );
  }
}

/**
 * Update shot status
 */
async function updateShotStatus(
  shotId: string,
  status: string,
  errorMessage?: string
): Promise<void> {
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
 * Calculate estimated cost for a shot
 */
function calculateEstimatedCost(model: ModelCapabilities, shot: ShotPlan): number {
  const duration = shot.durationSeconds || model.maxDurationSeconds;
  return model.costPerSecondUsd * duration;
}

/**
 * Check if a shot has already been dispatched (prevent duplicates)
 */
export async function isShotDispatched(shotId: string): Promise<boolean> {
  const result = await query(
    `SELECT COUNT(*) FROM dispatch_records
     WHERE shot_id = $1 AND status IN ('dispatched', 'generating', 'completed')`,
    [shotId]
  );
  return parseInt(result.rows[0].count) > 0;
}

/**
 * Get dispatch record for a shot
 */
export async function getDispatchRecord(shotId: string): Promise<DispatchRecord | null> {
  const result = await query(
    `SELECT * FROM dispatch_records
     WHERE shot_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [shotId]
  );
  return result.rows.length > 0 ? mapRowToDispatchRecord(result.rows[0]) : null;
}

/**
 * Map database row to DispatchRecord
 */
export function mapRowToDispatchRecord(row: any): DispatchRecord {
  return {
    id: row.id,
    shotId: row.shot_id,
    modelId: row.model_id,
    providerRequestId: row.provider_request_id,
    status: row.status,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at,
    error: row.error_message,
    fallbackFromDispatchId: row.fallback_from_dispatch_id,
  };
}

/**
 * Retry dispatch with fallback model
 */
export async function dispatchWithFallback(
  shot: ShotPlan,
  promptOutput: CompiledPrompt,
  primaryModel: ModelCapabilities,
  fallbackModels: ModelCapabilities[],
  options: DispatchOptions & { characters?: CharacterRegistryEntry[] } = {}
): Promise<DispatchResult> {
  // Try primary model first
  const primaryResult = await dispatchShot(shot, promptOutput, primaryModel, options);

  if (primaryResult.success) {
    return primaryResult;
  }

  // Try fallback models in order
  for (const fallbackModel of fallbackModels) {
    // Check if fallback model supports shot requirements
    if (!supportsShotRequirements(fallbackModel, shot)) {
      continue;
    }

    // Compile prompt for fallback model
    // Pass characters to ensure Face-Lock conditioning is preserved for fallback models
    const { compilePrompt } = await import('../generation/promptCompiler.js');
    const fallbackPrompt = await compilePrompt(shot, options.characters || [], fallbackModel, {
      maxPromptLength: 4000,
    });

    // Dispatch with fallback
    const fallbackResult = await dispatchShot(shot, fallbackPrompt, fallbackModel, {
      ...options,
      skipAdmission: true, // Already passed admission
    });

    if (fallbackResult.success && fallbackResult.dispatchRecord) {
      // Link fallback to original dispatch
      await updateDispatchRecord(fallbackResult.dispatchRecord.id, {
        fallbackFromDispatchId: primaryResult.dispatchRecord?.id,
        status: 'fallback',
      });

      // Update original dispatch record
      if (primaryResult.dispatchRecord) {
        await updateDispatchRecord(primaryResult.dispatchRecord.id, {
          status: 'fallback',
        });
      }

      return fallbackResult;
    }
  }

  // All models failed
  return {
    success: false,
    error: 'All models failed for shot',
    dispatchRecord: primaryResult.dispatchRecord,
  };
}

/**
 * Check if model supports shot requirements
 */
function supportsShotRequirements(model: ModelCapabilities, shot: ShotPlan): boolean {
  // Check duration
  if (shot.durationSeconds && model.maxDurationSeconds) {
    if (shot.durationSeconds > model.maxDurationSeconds) return false;
  }
  return true;
}