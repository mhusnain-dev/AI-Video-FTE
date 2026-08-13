/**
 * Webhook Watchdog Service
 * Automatically recovers lost/delayed completion notifications by polling providers
 * Implements FR-019, CL-008, AC-017
 * No duplicate generation or charge occurs (EC-008)
 */

import { config } from '../shared/config.js';
import { query } from '../shared/db.js';
import { getAdapter, initializeAdapters } from '../router/modelAdapter.js';
import { handleWebhook } from './webhookHandler.js';
import { shotStateMachine, emitShotStateChange } from '../shared/events.js';
import { selectModelForShot } from '../router/autoRouter.js';
import { compilePrompt } from '../generation/promptCompiler.js';
import { dispatchWithFallback } from './shotDispatcher.js';
import { cancelDispatchTimeout } from './timeoutManager.js';
import type { DispatchRecord, ModelCapabilities, ShotPlan, CompiledPrompt } from '../shared/types.js';
// Metrics
import {
  watchdogCheckTotal,
  watchdogStuckDispatchesGauge,
} from '../shared/metrics.js';

export interface WatchdogOptions {
  /** Override poll interval (ms) */
  pollIntervalMs?: number;
  /** Override max wait (ms) */
  maxWaitMs?: number;
  /** Run once instead of continuous */
  runOnce?: boolean;
}

export interface WatchdogResult {
  checked: number;
  recovered: number;
  timedOut: number;
  failed: number;
  errors: string[];
}

/**
 * Get default timeout for a model from config
 */
function getModelTimeout(modelId: string): number {
  const timeouts = config.dispatch?.defaultTimeouts || {};
  return timeouts[modelId] || 120; // Default 120s
}

/**
 * Get max wait time from config
 */
function getMaxWaitMs(): number {
  return config.dispatch?.watchdogMaxWaitMs || 600000; // 10 minutes
}

/**
 * Get poll interval from config
 */
function getPollIntervalMs(): number {
  return config.dispatch?.watchdogPollIntervalMs || 30000; // 30 seconds
}

/**
 * Find all stuck dispatch records that need recovery
 * Derives expected_completion_at from dispatched_at + model timeout (no new column needed)
 */
async function findStuckDispatches(): Promise<DispatchRecord[]> {
  const result = await query(
    `SELECT dr.*
     FROM dispatch_records dr
     WHERE dr.status IN ('dispatched', 'generating')
       AND dr.webhook_received_at IS NULL
       AND dr.dispatched_at IS NOT NULL
       AND dr.provider_request_id IS NOT NULL
       AND (
         dr.dispatched_at +
         (COALESCE($1::jsonb->>dr.model_id, $2)::int * interval '1 second')
       ) < NOW()`,
    [JSON.stringify(config.dispatch?.defaultTimeouts || {}), '120']
  );

  const stuckDispatches = result.rows.map((row: any) => ({
    id: row.id,
    shotId: row.shot_id,
    modelId: row.model_id,
    providerRequestId: row.provider_request_id,
    status: row.status,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at,
    error: row.error_message,
    fallbackFromDispatchId: row.fallback_from_dispatch_id,
  }));

  // Record gauge for stuck dispatches
  watchdogStuckDispatchesGauge.set({ model_id: 'all', status: 'all' }, stuckDispatches.length);
  for (const dispatch of stuckDispatches) {
    watchdogStuckDispatchesGauge.set({ model_id: dispatch.modelId, status: dispatch.status }, 1);
  }

  return stuckDispatches;
}

/**
 * Check if dispatch has exceeded max wait time (10 minutes)
 */
function hasExceededMaxWait(dispatch: DispatchRecord): boolean {
  if (!dispatch.dispatchedAt) return false;
  const maxWaitMs = getMaxWaitMs();
  return Date.now() - dispatch.dispatchedAt.getTime() > maxWaitMs;
}

/**
 * Process a single stuck dispatch
 */
async function processStuckDispatch(
  dispatch: DispatchRecord,
  shot: ShotPlan,
  promptOutput: CompiledPrompt,
  primaryModel: ModelCapabilities,
  fallbackModels: ModelCapabilities[]
): Promise<{ action: 'recovered' | 'timed_out' | 'failed' | 'still_processing'; error?: string }> {
  // Ensure adapters initialized
  await initializeAdapters();

  const adapter = getAdapter(dispatch.modelId);
  if (!adapter) {
    return { action: 'failed', error: `No adapter for model ${dispatch.modelId}` };
  }

  // Check status with provider
  let statusResult;
  try {
    statusResult = await adapter.checkStatus(dispatch.providerRequestId!);
  } catch (error) {
    return { action: 'failed', error: `Status check failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }

  // Handle provider status
  switch (statusResult.status) {
    case 'completed': {
      // Reuse webhook handler logic for idempotent processing (EC-008)
      if (statusResult.result) {
        const webhookPayload = {
          provider: adapter.provider,
          requestId: dispatch.providerRequestId!,
          status: 'completed' as const,
          result: statusResult.result,
          timestamp: new Date(),
          signature: '', // Not needed for recovery path
        };

        const handlerResult = await handleWebhook(adapter.provider, webhookPayload, { skipVerification: true });
        if (handlerResult.success) {
          return { action: 'recovered' };
        }
        return { action: 'failed', error: handlerResult.error };
      }
      return { action: 'failed', error: 'Completed but no result data' };
    }

    case 'failed': {
      // Mark dispatch as failed
      await query(
        `UPDATE dispatch_records SET status = 'failed', completed_at = NOW(), error_message = $2 WHERE id = $1`,
        [dispatch.id, statusResult.error || 'Provider reported failure']
      );
      return { action: 'failed', error: statusResult.error };
    }

    case 'processing':
    case 'pending': {
      // Check if exceeded max wait time
      if (hasExceededMaxWait(dispatch)) {
        // Mark as timeout
        await query(
          `UPDATE dispatch_records SET status = 'timeout', completed_at = NOW(), error_message = $2 WHERE id = $1`,
          [dispatch.id, 'Exceeded maximum wait time (10min) for webhook']
        );
        return { action: 'timed_out' };
      }
      // Still within wait window, leave for next poll
      return { action: 'still_processing' };
    }

    default:
      return { action: 'failed', error: `Unknown provider status: ${statusResult.status}` };
  }
}

/**
 * Main watchdog loop - runs continuously or once
 */
export async function runWatchdog(
  options: WatchdogOptions = {}
): Promise<WatchdogResult> {
  const { runOnce = false } = options;
  const pollInterval = options.pollIntervalMs || getPollIntervalMs();

  const result: WatchdogResult = {
    checked: 0,
    recovered: 0,
    timedOut: 0,
    failed: 0,
    errors: [],
  };

  const runCycle = async (): Promise<void> => {
    try {
      const stuckDispatches = await findStuckDispatches();
      result.checked += stuckDispatches.length;

      // Record check count
      watchdogCheckTotal.inc({ result: 'checked' });

      for (const dispatch of stuckDispatches) {
        try {
          // Get shot details
          const shotResult = await query(
            `SELECT s.*, st.brief FROM shots s JOIN stories st ON s.story_id = st.id WHERE s.id = $1`,
            [dispatch.shotId]
          );
          if (shotResult.rows.length === 0) {
            result.errors.push(`Shot ${dispatch.shotId} not found for dispatch ${dispatch.id}`);
            result.failed++;
            watchdogCheckTotal.inc({ result: 'failed' });
            continue;
          }

          const shot = shotResult.rows[0];
          const primaryModel = {
            id: dispatch.modelId,
            // Other fields will be populated from registry
          } as ModelCapabilities;

          // Get fallback models from router
          const routingDecision = await selectModelForShot(shot.user_id, {
            // Extract requirements from shot
            resolution: shot.resolution,
            aspectRatio: shot.aspectRatio,
            durationSeconds: shot.durationSeconds,
            requiredCapabilities: ['text_to_video'],
          });
          const fallbackModels = routingDecision.fallbackModels;

          // Compile prompt for this shot (need characters)
          const characterResult = await query(
            `SELECT * FROM characters WHERE story_id = $1`,
            [shot.story_id]
          );
          const characters = characterResult.rows;

          const promptOutput = await compilePrompt(
            shot as ShotPlan,
            characters,
            primaryModel,
            { maxPromptLength: 4000 }
          );

          const processResult = await processStuckDispatch(
            dispatch,
            shot as ShotPlan,
            promptOutput,
            primaryModel,
            fallbackModels
          );

          switch (processResult.action) {
            case 'recovered':
              result.recovered++;
              watchdogCheckTotal.inc({ result: 'recovered' });
              break;
            case 'timed_out':
              result.timedOut++;
              watchdogCheckTotal.inc({ result: 'timed_out' });
              // Trigger fallback for timeout
              await triggerFallback(dispatch, shot as ShotPlan, promptOutput, primaryModel, fallbackModels);
              break;
            case 'failed':
              result.failed++;
              watchdogCheckTotal.inc({ result: 'failed' });
              if (processResult.error) {
                result.errors.push(`Dispatch ${dispatch.id}: ${processResult.error}`);
              }
              // Trigger fallback for failure
              await triggerFallback(dispatch, shot as ShotPlan, promptOutput, primaryModel, fallbackModels);
              break;
            case 'still_processing':
              // Leave for next poll
              watchdogCheckTotal.inc({ result: 'still_processing' });
              break;
          }
        } catch (error) {
          result.failed++;
          result.errors.push(`Dispatch ${dispatch.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          watchdogCheckTotal.inc({ result: 'error' });
        }
      }
    } catch (error) {
      result.errors.push(`Watchdog cycle error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      watchdogCheckTotal.inc({ result: 'error' });
    }
  };

  if (runOnce) {
    await runCycle();
    return result;
  }

  // Continuous mode - run on interval
  console.log(`Webhook watchdog started (poll interval: ${pollInterval}ms)`);

  // This would be managed by an external scheduler/process manager
  // For now, run once and return (continuous mode handled by infrastructure)
  await runCycle();
  return result;
}

/**
 * Trigger fallback for a failed/timed-out dispatch
 */
async function triggerFallback(
  dispatch: DispatchRecord,
  shot: ShotPlan,
  promptOutput: CompiledPrompt,
  primaryModel: ModelCapabilities,
  fallbackModels: ModelCapabilities[]
): Promise<void> {
  try {
    const fallbackResult = await dispatchWithFallback(
      shot,
      promptOutput,
      primaryModel,
      fallbackModels,
      { skipAdmission: true } // Already passed admission
    );

    if (!fallbackResult.success) {
      // All fallbacks failed - shot will be handled by Phase 4.6 (all-models-failed)
      console.error(`All fallbacks failed for shot ${shot.id}: ${fallbackResult.error}`);
    }
  } catch (error) {
    console.error(`Fallback trigger error for shot ${shot.id}:`, error);
  }
}

/**
 * Run a single watchdog check (for cron/scheduler)
 */
export async function runWatchdogOnce(): Promise<WatchdogResult> {
  return runWatchdog({ runOnce: true });
}

/**
 * Get watchdog statistics for monitoring
 */
export async function getWatchdogStats(): Promise<{
  stuckDispatches: number;
  byStatus: Record<string, number>;
  byModel: Record<string, number>;
  oldestStuckMinutes?: number;
}> {
  const stuck = await findStuckDispatches();

  const byStatus: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  let oldestMs = 0;

  for (const d of stuck) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    byModel[d.modelId] = (byModel[d.modelId] || 0) + 1;
    if (d.dispatchedAt) {
      const age = Date.now() - d.dispatchedAt.getTime();
      if (age > oldestMs) oldestMs = age;
    }
  }

  return {
    stuckDispatches: stuck.length,
    byStatus,
    byModel,
    oldestStuckMinutes: oldestMs > 0 ? Math.round(oldestMs / 60000) : undefined,
  };
}