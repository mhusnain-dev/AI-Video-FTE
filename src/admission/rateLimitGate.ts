/**
 * Rate Limit Gate Service
 * Gate 4 of Admission Pipeline (FR-014, CL-012, EC-016)
 * Enforces per-model, per-user, global, and per-project limits
 */

import { query } from '../shared/db.js';
import { config } from '../shared/config.js';
import type { AdmissionContext, RateLimitConfig } from '../shared/types.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  currentUsage?: number;
  limit?: number;
  scope?: 'model' | 'user' | 'global' | 'project';
  reason?: string;
}

const WINDOW_SECONDS = 60; // 1-minute sliding window

/**
 * Main Rate Limit check
 */
export async function checkRateLimit(context: AdmissionContext): Promise<RateLimitResult> {
  const rateConfig = config.admission.rateLimit;
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_SECONDS * 1000);

  // 1. Check per-model limit
  const modelLimit = rateConfig.perModel[context.modelId] || 10;
  const modelUsage = await getUsageCount('model', context.modelId, windowStart);
  if (modelUsage >= modelLimit) {
    return {
      allowed: false,
      retryAfterSeconds: WINDOW_SECONDS,
      currentUsage: modelUsage,
      limit: modelLimit,
      scope: 'model',
      reason: `Per-model rate limit exceeded for ${context.modelId}: ${modelUsage}/${modelLimit} per minute`,
    };
  }

  // 2. Check per-user limit
  const userLimit = rateConfig.perUser;
  const userUsage = await getUsageCount('user', context.userId, windowStart);
  if (userUsage >= userLimit) {
    return {
      allowed: false,
      retryAfterSeconds: WINDOW_SECONDS,
      currentUsage: userUsage,
      limit: userLimit,
      scope: 'user',
      reason: `Per-user rate limit exceeded: ${userUsage}/${userLimit} per minute`,
    };
  }

  // 3. Check global limit
  const globalLimit = rateConfig.global;
  const globalUsage = await getUsageCount('global', 'global', windowStart);
  if (globalUsage >= globalLimit) {
    return {
      allowed: false,
      retryAfterSeconds: WINDOW_SECONDS,
      currentUsage: globalUsage,
      limit: globalLimit,
      scope: 'global',
      reason: `Global rate limit exceeded: ${globalUsage}/${globalLimit} per minute`,
    };
  }

  // 4. Check per-project override (if story has project_id)
  const projectId = await getProjectIdForStory(context.storyId);
  if (projectId && rateConfig.perProjectOverrides[projectId]) {
    const projectLimit = rateConfig.perProjectOverrides[projectId].global || globalLimit;
    const projectUsage = await getUsageCount('project', projectId, windowStart);
    if (projectUsage >= projectLimit) {
      return {
        allowed: false,
        retryAfterSeconds: WINDOW_SECONDS,
        currentUsage: projectUsage,
        limit: projectLimit,
        scope: 'project',
        reason: `Project rate limit exceeded: ${projectUsage}/${projectLimit} per minute`,
      };
    }
  }

  // All checks passed - record this request
  await recordUsage('model', context.modelId, now);
  await recordUsage('user', context.userId, now);
  await recordUsage('global', 'global', now);
  if (projectId) {
    await recordUsage('project', projectId, now);
  }

  return {
    allowed: true,
    currentUsage: modelUsage + 1,
    limit: modelLimit,
    scope: 'model',
  };
}

/**
 * Get usage count for a scope within the time window
 */
async function getUsageCount(scopeType: string, scopeKey: string, windowStart: Date): Promise<number> {
  const result = await query(
    `SELECT COALESCE(SUM(request_count), 0) as total
     FROM rate_limit_counters
     WHERE scope_type = $1 AND scope_key = $2 AND window_start >= $3`,
    [scopeType, scopeKey, windowStart]
  );
  return parseInt(result.rows[0].total);
}

/**
 * Record a usage increment
 */
async function recordUsage(scopeType: string, scopeKey: string, timestamp: Date): Promise<void> {
  // Round to minute boundary for window
  const windowStart = new Date(timestamp);
  windowStart.setSeconds(0, 0);

  await query(
    `INSERT INTO rate_limit_counters (scope_type, scope_key, window_start, request_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (scope_type, scope_key, window_start)
     DO UPDATE SET request_count = rate_limit_counters.request_count + 1`,
    [scopeType, scopeKey, windowStart]
  );
}

/**
 * Get project ID for a story (if stories belong to projects)
 */
async function getProjectIdForStory(storyId: string): Promise<string | null> {
  // In this implementation, stories don't have project_id by default
  // Could be extended if needed
  return null;
}

/**
 * Record Rate Limit audit
 */
export async function recordRateLimitAudit(
  context: AdmissionContext,
  result: RateLimitResult
): Promise<void> {
  await query(
    `INSERT INTO admission_audit (story_id, shot_id, gate, decision, reason, category, rule_triggered, full_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      context.storyId,
      context.shotId,
      'rate_limit',
      result.allowed ? 'pass' : 'fail',
      result.reason,
      'rate_limit_exceeded',
      result.allowed ? null : `rate_limit_${result.scope}`,
      JSON.stringify({
        modelId: context.modelId,
        userId: context.userId,
        scope: result.scope,
        currentUsage: result.currentUsage,
        limit: result.limit,
        retryAfterSeconds: result.retryAfterSeconds,
      }),
    ]
  );
}

/**
 * Get current rate limit status for a user/model
 */
export async function getRateLimitStatus(
  userId: string,
  modelId: string
): Promise<{
  model: { used: number; limit: number; remaining: number };
  user: { used: number; limit: number; remaining: number };
  global: { used: number; limit: number; remaining: number };
}> {
  const rateConfig = config.admission.rateLimit;
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000);

  const [modelUsage, userUsage, globalUsage] = await Promise.all([
    getUsageCount('model', modelId, windowStart),
    getUsageCount('user', userId, windowStart),
    getUsageCount('global', 'global', windowStart),
  ]);

  return {
    model: { used: modelUsage, limit: rateConfig.perModel[modelId] || 10, remaining: Math.max(0, (rateConfig.perModel[modelId] || 10) - modelUsage) },
    user: { used: userUsage, limit: rateConfig.perUser, remaining: Math.max(0, rateConfig.perUser - userUsage) },
    global: { used: globalUsage, limit: rateConfig.global, remaining: Math.max(0, rateConfig.global - globalUsage) },
  };
}