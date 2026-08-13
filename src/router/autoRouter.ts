/**
 * AUTO Router Service
 * Implements FR-005, FR-006, FR-007, FR-008, CL-006
 * Selects best model per shot based on user priority, eligibility, and availability
 */

import { getEligibleModels, getUserModelPriority, getModelById, initializeModelRegistryTable } from './modelRegistry.js';
import { query } from '../shared/db.js';
import type { ModelCapabilities, Resolution, AspectRatio, ModelCapability } from '../shared/types.js';
import { config } from '../shared/config.js';
// Metrics
import {
  modelSelectionTotal,
  modelEligibilityFilteredTotal,
} from '../shared/metrics.js';

export interface ShotRequirements {
  resolution?: Resolution;
  aspectRatio?: AspectRatio;
  durationSeconds?: number;
  region?: string;
  requiredCapabilities?: ModelCapability[];
  modelOverride?: string; // Manual pin (FR-008)
}

export interface RoutingDecision {
  modelId: string;
  model: ModelCapabilities;
  fallbackModels: ModelCapabilities[]; // Ordered fallbacks
  reason: string;
  isOverride: boolean;
}

/**
 * Select best model for a shot (FR-006)
 * Priority: 1. Manual override → 2. User priority list → 3. System default
 * Filters by eligibility (resolution, aspect ratio, duration, region, capabilities)
 */
export async function selectModelForShot(
  userId: string,
  requirements: ShotRequirements
): Promise<RoutingDecision> {
  // Initialize registry on first call
  await initializeModelRegistryTable();

  const userPriority = await getUserModelPriority(userId);
  const userPriorityList = userPriority?.priorityList;

  // 1. Check manual override (FR-008)
  if (requirements.modelOverride) {
    const overrideModel = await getModelById(requirements.modelOverride);
    if (!overrideModel) {
      throw new Error(`Override model not found: ${requirements.modelOverride}`);
    }

    const eligibility = await checkEligibility(overrideModel, requirements);
    if (!eligibility.eligible) {
      modelEligibilityFilteredTotal.inc({ model_id: requirements.modelOverride, reason: eligibility.reason || 'unknown' });
      throw new Error(`Override model ${requirements.modelOverride} not eligible: ${eligibility.reason}`);
    }

    // Get fallbacks from user/system priority excluding the override
    const allEligible = await getEligibleModels(requirements, userPriorityList);
    const fallbacks = allEligible.filter(m => m.id !== requirements.modelOverride);

    modelSelectionTotal.inc({ model_id: overrideModel.id, reason: 'Manual model override', is_override: 'true' });

    return {
      modelId: overrideModel.id,
      model: overrideModel,
      fallbackModels: fallbacks,
      reason: 'Manual model override',
      isOverride: true,
    };
  }

  // 2. Get eligible models ordered by priority (user > system default)
  const eligibleModels = await getEligibleModels(requirements, userPriorityList);

  if (eligibleModels.length === 0) {
    throw new Error('No eligible models for shot requirements');
  }

  const selected = eligibleModels[0];
  const fallbacks = eligibleModels.slice(1);

  modelSelectionTotal.inc({ model_id: selected.id, reason: userPriorityList ? 'User priority list' : 'System default priority', is_override: 'false' });

  return {
    modelId: selected.id,
    model: selected,
    fallbackModels: fallbacks,
    reason: userPriorityList ? 'User priority list' : 'System default priority',
    isOverride: false,
  };
}

/**
 * Check model eligibility for requirements
 */
async function checkEligibility(
  model: ModelCapabilities,
  requirements: ShotRequirements
): Promise<{ eligible: boolean; reason?: string }> {
  const resolutionOrder: Resolution[] = ['720p', '1080p', '4K'];

  if (requirements.resolution) {
    const modelMaxIndex = resolutionOrder.indexOf(model.maxResolution);
    const requiredIndex = resolutionOrder.indexOf(requirements.resolution);
    if (requiredIndex > modelMaxIndex) {
      return { eligible: false, reason: `Model max resolution ${model.maxResolution} < required ${requirements.resolution}` };
    }
  }

  if (requirements.aspectRatio && !model.supportedAspectRatios.includes(requirements.aspectRatio)) {
    return { eligible: false, reason: `Model does not support aspect ratio ${requirements.aspectRatio}` };
  }

  if (requirements.durationSeconds && requirements.durationSeconds > model.maxDurationSeconds) {
    return { eligible: false, reason: `Shot duration ${requirements.durationSeconds}s exceeds model max ${model.maxDurationSeconds}s` };
  }

  if (requirements.region && !model.supportedRegions.includes(requirements.region)) {
    return { eligible: false, reason: `Model not available in region ${requirements.region}` };
  }

  if (requirements.requiredCapabilities) {
    for (const cap of requirements.requiredCapabilities) {
      if (!model.capabilities.includes(cap)) {
        return { eligible: false, reason: `Model lacks required capability: ${cap}` };
      }
    }
  }

  return { eligible: true };
}

/**
 * Get next fallback model for a shot (FR-020)
 * Used when primary model times out or fails
 */
export async function getNextFallback(
  shotId: string,
  failedModelId: string,
  requirements: ShotRequirements,
  userId: string
): Promise<ModelCapabilities | null> {
  // Get all previously tried models for this shot
  const triedResult = await query(
    `SELECT DISTINCT model_id FROM dispatch_records WHERE shot_id = $1`,
    [shotId]
  );

  const triedModels = new Set(triedResult.rows.map(r => r.model_id));
  triedModels.add(failedModelId); // Add the one that just failed

  // Get eligible models excluding tried ones
  const userPriority = await getUserModelPriority(userId);
  const eligibleModels = await getEligibleModels(requirements, userPriority?.priorityList);

  for (const model of eligibleModels) {
    if (!triedModels.has(model.id)) {
      return model;
    }
  }

  return null; // All models exhausted
}

/**
 * Record dispatch attempt for fallback tracking
 */
export async function recordDispatchAttempt(
  shotId: string,
  modelId: string,
  providerRequestId: string | null,
  status: 'pending' | 'dispatched' | 'completed' | 'failed' | 'timeout' | 'fallback'
): Promise<void> {
  await query(
    `INSERT INTO dispatch_records (shot_id, model_id, provider_request_id, status, dispatched_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'dispatched' THEN NOW() ELSE NULL END)`,
    [shotId, modelId, providerRequestId, status]
  );
}

/**
 * Get dispatch history for a shot
 */
export async function getDispatchHistory(shotId: string): Promise<Array<{
  modelId: string;
  status: string;
  dispatchedAt: Date;
  completedAt: Date | null;
}>> {
  const result = await query(
    `SELECT model_id, status, dispatched_at, completed_at FROM dispatch_records
     WHERE shot_id = $1 ORDER BY created_at`,
    [shotId]
  );

  return result.rows.map(row => ({
    modelId: row.model_id,
    status: row.status,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at,
  }));
}