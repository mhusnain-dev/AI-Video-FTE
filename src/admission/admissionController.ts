/**
 * Admission Controller
 * Main orchestrator for the fixed-order admission pipeline:
 * Moderation → Sacred Guard → Cost Guard → Rate Limit (CON-001)
 * Implements FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, CON-001, CON-002
 */

import { query, transaction } from '../shared/db.js';
import { checkModeration, recordModerationAudit } from './moderationGate.js';
import { checkSacredGuard } from './sacredGuard.js';
import { checkCostGuard, recordCostGuardAudit } from './costGuard.js';
import { checkRateLimit, recordRateLimitAudit } from './rateLimitGate.js';
import { shotStateMachine } from '../shared/events.js';
import type { AdmissionContext, AdmissionResult, AdmissionDecision } from '../shared/types.js';
// Metrics
import {
  admissionPipelineDurationSeconds,
  admissionGateDecisionTotal,
  sacredGuardBlockTotal,
  costGuardPauseTotal,
  rateLimitExceededTotal,
} from '../shared/metrics.js';

export interface AdmissionPipelineResult {
  passed: boolean;
  blockedAtGate?: 'moderation' | 'sacred_guard' | 'cost_guard' | 'rate_limit';
  results: {
    moderation: Awaited<ReturnType<typeof checkModeration>>;
    sacredGuard: Awaited<ReturnType<typeof checkSacredGuard>>;
    costGuard: Awaited<ReturnType<typeof checkCostGuard>>;
    rateLimit: Awaited<ReturnType<typeof checkRateLimit>>;
  };
  pausedReason?: string;
}

/**
 * Run the complete admission pipeline for a shot
 * Order is IMMUTABLE: Moderation → Sacred Guard → Cost Guard → Rate Limit (CON-001)
 */
export async function runAdmissionPipeline(
  context: AdmissionContext
): Promise<AdmissionPipelineResult> {
  const pipelineStart = Date.now();
  const results = {
    moderation: { blocked: false } as Awaited<ReturnType<typeof checkModeration>>,
    sacredGuard: { blocked: false } as Awaited<ReturnType<typeof checkSacredGuard>>,
    costGuard: { blocked: false, paused: false } as Awaited<ReturnType<typeof checkCostGuard>>,
    rateLimit: { allowed: true } as Awaited<ReturnType<typeof checkRateLimit>>,
  };

  // ============================================
  // GATE 1: Moderation (FR-010)
  // ============================================
  const moderationStart = Date.now();
  results.moderation = await checkModeration(context);
  admissionPipelineDurationSeconds.observe({ gate: 'moderation', result: results.moderation.blocked ? 'fail' : 'pass' }, (Date.now() - moderationStart) / 1000);
  admissionGateDecisionTotal.inc({ gate: 'moderation', decision: results.moderation.blocked ? 'fail' : 'pass', reason_category: results.moderation.category || 'none' });
  await recordModerationAudit(context, results.moderation);

  if (results.moderation.blocked) {
    // Update shot status
    await query(
      `UPDATE shots SET status = 'admission_failed', error_message = $1 WHERE id = $2`,
      [results.moderation.reason, context.shotId]
    );
    shotStateMachine.setCurrentState(context.shotId, 'admission_failed');

    return {
      passed: false,
      blockedAtGate: 'moderation',
      results,
    };
  }

  // ============================================
  // GATE 2: Sacred Guard (FR-011, FR-012, CON-002)
  // ============================================
  const sacredGuardStart = Date.now();
  results.sacredGuard = await checkSacredGuard({
    prompt: context.prompt,
    referenceImages: context.referenceImages,
    modelId: context.modelId,
    userId: context.userId,
    storyId: context.storyId,
    enforcementPoint: 'pre_dispatch', // Gate 2 is pre-dispatch (after moderation)
  });
  admissionPipelineDurationSeconds.observe({ gate: 'sacred_guard', result: results.sacredGuard.blocked ? 'fail' : 'pass' }, (Date.now() - sacredGuardStart) / 1000);
  admissionGateDecisionTotal.inc({ gate: 'sacred_guard', decision: results.sacredGuard.blocked ? 'fail' : 'pass', reason_category: results.sacredGuard.matchType || 'none' });
  if (results.sacredGuard.blocked) {
    sacredGuardBlockTotal.inc({ enforcement_point: 'pre_dispatch', match_type: results.sacredGuard.matchType || 'unknown', model_id: context.modelId });
  }

  // Record Sacred Guard audit
  await query(
    `INSERT INTO admission_audit (story_id, shot_id, gate, decision, reason, category, rule_triggered, full_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      context.storyId,
      context.shotId,
      'sacred_guard',
      results.sacredGuard.blocked ? 'fail' : 'pass',
      results.sacredGuard.reason,
      'sacred_guard_match',
      results.sacredGuard.blocked ? `sacred_guard_${results.sacredGuard.matchType}` : null,
      JSON.stringify({
        enforcementPoint: 'pre_dispatch',
        matchType: results.sacredGuard.matchType,
        matchedEntity: results.sacredGuard.matchedEntity,
        confidence: results.sacredGuard.confidence,
      }),
    ]
  );

  if (results.sacredGuard.blocked) {
    await query(
      `UPDATE shots SET status = 'admission_failed', error_message = $1 WHERE id = $2`,
      [results.sacredGuard.reason, context.shotId]
    );
    shotStateMachine.setCurrentState(context.shotId, 'admission_failed');

    return {
      passed: false,
      blockedAtGate: 'sacred_guard',
      results,
    };
  }

  // ============================================
  // GATE 3: Cost Guard (FR-013, CL-010, CL-011)
  // ============================================
  const costGuardStart = Date.now();
  results.costGuard = await checkCostGuard(context);
  admissionPipelineDurationSeconds.observe({ gate: 'cost_guard', result: results.costGuard.paused ? 'warn' : 'pass' }, (Date.now() - costGuardStart) / 1000);
  admissionGateDecisionTotal.inc({ gate: 'cost_guard', decision: results.costGuard.paused ? 'warn' : 'pass', reason_category: results.costGuard.reason ? 'overrun' : 'none' });
  if (results.costGuard.paused) {
    costGuardPauseTotal.inc({ reason: results.costGuard.reason || 'overrun' });
  }
  await recordCostGuardAudit(context, results.costGuard);
  if (results.costGuard.paused) {
    // Cost overrun - pause story with options
    await query(
      `UPDATE stories SET status = 'paused_cost' WHERE id = $1`,
      [context.storyId]
    );
    await query(
      `UPDATE shots SET status = 'admission_failed', error_message = $1 WHERE id = $2`,
      [results.costGuard.reason, context.shotId]
    );
    shotStateMachine.setCurrentState(context.shotId, 'admission_failed');

    return {
      passed: false,
      blockedAtGate: 'cost_guard',
      results,
      pausedReason: results.costGuard.reason,
    };
  }

  // ============================================
  // GATE 4: Rate Limit (FR-014, CL-012)
  // ============================================
  const rateLimitStart = Date.now();
  results.rateLimit = await checkRateLimit(context);
  admissionPipelineDurationSeconds.observe({ gate: 'rate_limit', result: results.rateLimit.allowed ? 'pass' : 'fail' }, (Date.now() - rateLimitStart) / 1000);
  admissionGateDecisionTotal.inc({ gate: 'rate_limit', decision: results.rateLimit.allowed ? 'pass' : 'fail', reason_category: results.rateLimit.scope || 'none' });
  if (!results.rateLimit.allowed) {
    rateLimitExceededTotal.inc({ scope: results.rateLimit.scope || 'model', model_id: context.modelId });
  }
  await recordRateLimitAudit(context, results.rateLimit);

  if (!results.rateLimit.allowed) {
    // Rate limited - queue the shot
    await query(
      `UPDATE stories SET status = 'paused_rate_limit' WHERE id = $1`,
      [context.storyId]
    );
    await query(
      `UPDATE shots SET status = 'admission_failed', error_message = $1 WHERE id = $2`,
      [results.rateLimit.reason, context.shotId]
    );
    shotStateMachine.setCurrentState(context.shotId, 'admission_failed');

    return {
      passed: false,
      blockedAtGate: 'rate_limit',
      results,
    };
  }

  // ============================================
  // ALL GATES PASSED
  // ============================================
  await query(
    `UPDATE shots SET status = 'admission_passed' WHERE id = $1`,
    [context.shotId]
  );
  shotStateMachine.setCurrentState(context.shotId, 'admission_passed');

  return {
    passed: true,
    results,
  };
}

/**
 * Check admission for story creation (enforcement point a: creation)
 * Runs moderation + sacred guard on initial prompt + references
 */
export async function checkStoryCreationAdmission(
  storyId: string,
  userId: string,
  prompt: string,
  referenceImages: string[],
  modelId: string
): Promise<AdmissionPipelineResult> {
  return runAdmissionPipeline({
    storyId,
    shotId: '', // No shot yet
    prompt,
    referenceImages,
    modelId,
    userId,
    estimatedCost: 0,
  });
}

/**
 * Check admission for character registry (enforcement point b: registry)
 * Already implemented in characterService.ts using checkSacredGuard
 */

/**
 * Check admission pre-dispatch (enforcement point d: pre-dispatch)
 * This is the main runAdmissionPipeline call
 */

/**
 * Check admission post-generation (enforcement point e: post-generation audit)
 * Runs Sacred Guard visual audit on generated frames
 */
export async function checkPostGenerationAdmission(
  storyId: string,
  shotId: string,
  userId: string,
  generatedFramesBase64: string[],
  modelId: string
): Promise<AdmissionPipelineResult> {
  // Only Sacred Guard runs at post-generation (CON-002)
  const sacredResult = await checkSacredGuard({
    prompt: '',
    referenceImages: generatedFramesBase64,
    modelId,
    userId,
    storyId,
    enforcementPoint: 'post_generation_audit',
  });

  await query(
    `INSERT INTO admission_audit (story_id, shot_id, gate, decision, reason, category, rule_triggered, full_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      storyId,
      shotId,
      'sacred_guard',
      sacredResult.blocked ? 'fail' : 'pass',
      sacredResult.reason,
      'sacred_guard_post_gen',
      sacredResult.blocked ? `sacred_guard_${sacredResult.matchType}` : null,
      JSON.stringify({
        enforcementPoint: 'post_generation_audit',
        frameCount: generatedFramesBase64.length,
        matchType: sacredResult.matchType,
        matchedEntity: sacredResult.matchedEntity,
        confidence: sacredResult.confidence,
      }),
    ]
  );

  if (sacredResult.blocked) {
    await query(
      `UPDATE shots SET status = 'admission_failed', error_message = $1 WHERE id = $2`,
      [sacredResult.reason, shotId]
    );
    await query(
      `UPDATE stories SET status = 'paused_sacred_guard' WHERE id = $1`,
      [storyId]
    );
    shotStateMachine.setCurrentState(shotId, 'admission_failed');

    return {
      passed: false,
      blockedAtGate: 'sacred_guard',
      results: {
        moderation: { blocked: false },
        sacredGuard: sacredResult,
        costGuard: { blocked: false, paused: false, estimatedCost: 0, userBudgetRemaining: 0, projectCeilingRemaining: 0, committedSpendRemaining: 0 },
        rateLimit: { allowed: true },
      },
    };
  }

  return {
    passed: true,
    results: {
      moderation: { blocked: false },
      sacredGuard: sacredResult,
      costGuard: { blocked: false, paused: false, estimatedCost: 0, userBudgetRemaining: 0, projectCeilingRemaining: 0, committedSpendRemaining: 0 },
      rateLimit: { allowed: true },
    },
  };
}

/**
 * Resolve a paused story (cost, rate limit, or sacred guard)
 */
export async function resolvePause(
  storyId: string,
  resolution: 'reduce_scope' | 'increase_budget' | 'cancel' | 'rate_limit_resolved' | 'sacred_guard_resolved',
  userId: string,
  metadata: Record<string, any> = {}
): Promise<void> {
  const storyResult = await query(`SELECT status FROM stories WHERE id = $1`, [storyId]);
  if (storyResult.rows.length === 0) {
    throw new Error('Story not found');
  }

  const currentStatus = storyResult.rows[0].status;

  let newStatus: string;
  switch (currentStatus) {
    case 'paused_cost':
      if (resolution === 'cancel') {
        newStatus = 'cancelled';
      } else {
        newStatus = 'in_progress'; // Resume generation
      }
      break;
    case 'paused_rate_limit':
      newStatus = 'in_progress';
      break;
    case 'paused_sacred_guard':
      if (resolution === 'sacred_guard_resolved') {
        newStatus = 'in_progress';
      } else if (resolution === 'cancel') {
        newStatus = 'cancelled';
      } else {
        throw new Error('Invalid resolution for sacred guard pause');
      }
      break;
    default:
      throw new Error(`Story not in paused state: ${currentStatus}`);
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE stories SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, storyId]
    );

    await client.query(
      `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['story', storyId, `pause_resolved_${resolution}`, currentStatus, newStatus, JSON.stringify(metadata), JSON.stringify({ userId })]
    );

    // If resuming, re-run admission for pending shots
    if (newStatus === 'in_progress') {
      const pendingShots = await client.query(
        `SELECT id FROM shots WHERE story_id = $1 AND status = 'admission_failed'`,
        [storyId]
      );

      for (const shot of pendingShots.rows) {
        await client.query(
          `UPDATE shots SET status = 'approved' WHERE id = $1`,
          [shot.id]
        );
      }
    }
  });
}