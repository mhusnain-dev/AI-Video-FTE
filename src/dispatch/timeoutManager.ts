/**
 * Timeout Manager for Shot Generation
 * Handles per-model timeouts. No fallback — prevents credit waste.
 */

import { config } from '../shared/config.js';
import { query } from '../shared/db.js';
import { getAdapter } from '../router/modelAdapter.js';
import { emitShotStateChange } from '../shared/events.js';
import type { ShotPlan, CompiledPrompt, DispatchRecord, ModelCapabilities, CharacterRegistryEntry } from '../shared/types.js';
import { shotTimeoutTotal } from '../shared/metrics.js';

/** Active timeout timers keyed by dispatch ID */
const timeoutTimers = new Map<string, NodeJS.Timeout>();

export interface TimeoutOptions {
  /** Timeout override in seconds (user per-story override) */
  overrideTimeoutSeconds?: number;
  /** Whether to trigger fallback on timeout */
  triggerFallback?: boolean;
  /** Character references for Face-Lock conditioning in fallback */
  characters?: CharacterRegistryEntry[];
}

/**
 * Get effective timeout for a model (config default or user override)
 */
export function getEffectiveTimeout(modelId: string, overrideSeconds?: number): number {
  if (overrideSeconds !== undefined) {
    return overrideSeconds;
  }
  const timeouts = config.dispatch?.defaultTimeouts || {};
  return timeouts[modelId] || 120; // Default 120s
}

/**
 * Start timeout timer for a dispatched shot
 * If timeout fires, cancels the request and triggers fallback
 */
export async function startDispatchTimeout(
  dispatchRecord: DispatchRecord,
  shot: ShotPlan,
  promptOutput: CompiledPrompt,
  primaryModel: ModelCapabilities,
  fallbackModels: ModelCapabilities[],
  options: TimeoutOptions = {}
): Promise<void> {
  const { overrideTimeoutSeconds, triggerFallback = true, characters = [] } = options;

  // Don't start duplicate timer for same dispatch
  if (timeoutTimers.has(dispatchRecord.id)) {
    return;
  }

  const timeoutSeconds = getEffectiveTimeout(primaryModel.id, overrideTimeoutSeconds);
  const timeoutMs = timeoutSeconds * 1000;

  const timer = setTimeout(async () => {
    timeoutTimers.delete(dispatchRecord.id);

    // Check if dispatch is still in progress (not completed/failed by webhook)
    const currentDispatch = await query(
      `SELECT status, completed_at FROM dispatch_records WHERE id = $1`,
      [dispatchRecord.id]
    );

    if (currentDispatch.rows.length === 0) {
      return; // Dispatch record deleted
    }

    const status = currentDispatch.rows[0].status;
    const completedAt = currentDispatch.rows[0].completed_at;

    // If already completed/failed by webhook, don't trigger timeout fallback
    if (status === 'completed' || status === 'failed' || completedAt) {
      return;
    }

    // Only trigger fallback if dispatch is still in dispatched/generating state
    if (status !== 'dispatched' && status !== 'generating') {
      return;
    }

    console.log(`Dispatch ${dispatchRecord.id} timed out after ${timeoutSeconds}s (no fallback — credit protection)`);

    // Record timeout metric
    shotTimeoutTotal.inc({ model_id: primaryModel.id, timeout_seconds: timeoutSeconds.toString() });

    if (triggerFallback) {
      // Mark original dispatch as timed out
      await query(
        `UPDATE dispatch_records SET status = 'timeout', completed_at = NOW(), error_message = $2 WHERE id = $1`,
        [dispatchRecord.id, `Generation timeout after ${timeoutSeconds}s`]
      );

      // Update shot status
      await query(
        `UPDATE shots SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [shot.id, `Model ${primaryModel.id} timed out after ${timeoutSeconds}s — no fallback triggered`]
      );

      // Emit state change
      await emitShotStateChange(shot.id, status, 'failed', 'generation_timeout', {
        modelId: primaryModel.id,
        timeoutSeconds,
        providerRequestId: dispatchRecord.providerRequestId,
      });

      // Cancel original request if possible
      const adapter = getAdapter(primaryModel.id);
      if (adapter && dispatchRecord.providerRequestId) {
        try {
          await adapter.cancel(dispatchRecord.providerRequestId);
        } catch {
          // Best effort — KIE doesn't support cancel
        }
      }

      // NO fallback — avoids wasting credits on retry chains
    }
  }, timeoutMs);

  // Don't prevent process exit
  timer.unref?.();

  timeoutTimers.set(dispatchRecord.id, timer);
}

/**
 * Cancel timeout timer for a dispatch (e.g., when webhook completes successfully)
 */
export function cancelDispatchTimeout(dispatchId: string): void {
  const timer = timeoutTimers.get(dispatchId);
  if (timer) {
    clearTimeout(timer);
    timeoutTimers.delete(dispatchId);
  }
}

/**
 * Check if a dispatch has an active timeout timer
 */
export function hasActiveTimeout(dispatchId: string): boolean {
  return timeoutTimers.has(dispatchId);
}

/**
 * Cancel all active timeout timers (for shutdown)
 */
export function cancelAllTimeouts(): void {
  for (const timer of timeoutTimers.values()) {
    clearTimeout(timer);
  }
  timeoutTimers.clear();
}

/**
 * Get count of active timeout timers
 */
export function getActiveTimeoutCount(): number {
  return timeoutTimers.size;
}