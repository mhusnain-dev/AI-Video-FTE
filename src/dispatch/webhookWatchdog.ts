/**
 * Webhook Watchdog Service
 * Polls providers for stuck dispatches and recovers completions.
 * No fallback on timeout — prevents credit waste.
 */

import { config } from '../shared/config.js';
import { query } from '../shared/db.js';
import { getAdapter, initializeAdapters } from '../router/modelAdapter.js';
import { handleWebhook } from './webhookHandler.js';
import { cancelDispatchTimeout } from './timeoutManager.js';
import type { DispatchRecord } from '../shared/types.js';
import { watchdogCheckTotal, watchdogStuckDispatchesGauge } from '../shared/metrics.js';

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
export function getModelTimeout(modelId: string): number {
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
 * Also finds in-progress dispatches (older than 60s) for proactive status polling
 */
async function findStuckDispatches(): Promise<DispatchRecord[]> {
  const result = await query(
    `SELECT dr.*
     FROM dispatch_records dr
     WHERE dr.status IN ('dispatched', 'generating')
       AND dr.webhook_received_at IS NULL
       AND dr.dispatched_at IS NOT NULL
       AND dr.provider_request_id IS NOT NULL
       AND dr.dispatched_at < NOW() - INTERVAL '60 seconds'`,
    []
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

      watchdogCheckTotal.inc({ result: 'checked' });

      if (stuckDispatches.length > 0) {
        console.log(`[Watchdog] Found ${stuckDispatches.length} stuck dispatch(es) to check`);
      }

      // Initialize adapters once before the loop
      if (stuckDispatches.length > 0) {
        await initializeAdapters();
      }

      for (const dispatch of stuckDispatches) {
        try {
          const adapter = getAdapter(dispatch.modelId);
          if (!adapter) {
            console.error(`[Watchdog] No adapter for model ${dispatch.modelId}, dispatch ${dispatch.id}`);
            result.failed++;
            result.errors.push(`No adapter for ${dispatch.modelId}`);
            continue;
          }

          console.log(`[Watchdog] Checking dispatch ${dispatch.id.slice(0,8)}, model=${dispatch.modelId}, providerRequestId=${dispatch.providerRequestId?.slice(0,8)}`);

          let statusResult;
          try {
            statusResult = await adapter.checkStatus(dispatch.providerRequestId!);
          } catch (error) {
            console.error(`[Watchdog] Status check error for ${dispatch.id.slice(0,8)}: ${error instanceof Error ? error.message : 'Unknown'}`);
            result.errors.push(`Status check failed for ${dispatch.id}: ${error instanceof Error ? error.message : 'Unknown'}`);
            watchdogCheckTotal.inc({ result: 'error' });
            continue;
          }

          console.log(`[Watchdog] Status: ${statusResult.status} for dispatch ${dispatch.id.slice(0,8)}`);

          if (statusResult.status === 'processing' || statusResult.status === 'pending') {
            if (hasExceededMaxWait(dispatch)) {
              console.log(`[Watchdog] Dispatch ${dispatch.id.slice(0,8)} exceeded max wait, marking timeout`);
              await query(
                `UPDATE dispatch_records SET status = 'timeout', completed_at = NOW(), error_message = $2 WHERE id = $1`,
                [dispatch.id, 'Exceeded maximum wait time for webhook']
              );
              await query(
                `UPDATE shots SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
                [dispatch.shotId, 'Generation timed out — provider did not complete in time']
              );
            } else {
              watchdogCheckTotal.inc({ result: 'still_processing' });
              continue;
            }
          }

          if (statusResult.status === 'completed' && statusResult.result) {
            console.log(`[Watchdog] Recovery: dispatch ${dispatch.id.slice(0,8)} completed, processing via webhook handler`);
            const webhookPayload = {
              provider: adapter.provider,
              requestId: dispatch.providerRequestId!,
              status: 'completed' as const,
              result: statusResult.result,
              timestamp: new Date(),
              signature: '',
            };
            const handlerResult = await handleWebhook(adapter.provider, webhookPayload, { skipVerification: true });
            if (handlerResult.success) {
              console.log(`[Watchdog] Recovered dispatch ${dispatch.id.slice(0,8)}: shot ${dispatch.shotId.slice(0,8)} completed`);
              result.recovered++;
              watchdogCheckTotal.inc({ result: 'recovered' });
            } else {
              console.error(`[Watchdog] Recovery FAILED for ${dispatch.id.slice(0,8)}: ${handlerResult.error}`);
              result.failed++;
              result.errors.push(`Recovery failed for ${dispatch.id}: ${handlerResult.error}`);
              watchdogCheckTotal.inc({ result: 'failed' });
            }
            continue;
          }

          if (statusResult.status === 'failed') {
            console.log(`[Watchdog] Dispatch ${dispatch.id.slice(0,8)} failed: ${statusResult.error}`);
            await query(
              `UPDATE dispatch_records SET status = 'failed', completed_at = NOW(), error_message = $2 WHERE id = $1`,
              [dispatch.id, statusResult.error || 'Provider reported failure']
            );
            await query(
              `UPDATE shots SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
              [dispatch.shotId, statusResult.error || 'Provider reported failure']
            );
            result.failed++;
            result.errors.push(`Shot ${dispatch.shotId} failed: ${statusResult.error}`);
            watchdogCheckTotal.inc({ result: 'failed' });
            continue;
          }

          // Timeout case — mark shot as failed, do NOT trigger fallback (credit waste)
          console.log(`[Watchdog] Dispatch ${dispatch.id.slice(0,8)} timed out, marking shot as failed (no fallback)`);
          await query(
            `UPDATE dispatch_records SET status = 'timeout', completed_at = NOW(), error_message = $2 WHERE id = $1`,
            [dispatch.id, 'Generation timed out — no result received']
          );
          await query(
            `UPDATE shots SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
            [dispatch.shotId, 'Generation timed out — no result received from provider']
          );
          result.timedOut++;
          watchdogCheckTotal.inc({ result: 'timed_out' });
        } catch (error) {
          console.error(`[Watchdog] Error processing dispatch ${dispatch.id.slice(0,8)}:`, error);
          result.failed++;
          result.errors.push(`Dispatch ${dispatch.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          watchdogCheckTotal.inc({ result: 'error' });
        }
      }
    } catch (error) {
      console.error(`[Watchdog] Cycle error:`, error);
      result.errors.push(`Watchdog cycle error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      watchdogCheckTotal.inc({ result: 'error' });
    }
  };

  if (runOnce) {
    await runCycle();
    return result;
  }

  // Continuous mode - run on interval
  // Note: main.ts startWatchdogLoop() handles interval scheduling and initial log

  // This would be managed by an external scheduler/process manager
  // For now, run once and return (continuous mode handled by infrastructure)
  await runCycle();
  return result;
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