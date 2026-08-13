/**
 * Cost Guard Service
 * Gate 3 of Admission Pipeline (FR-013, CL-010, CL-011, EC-009)
 * Compares estimated cost against user budget, project ceiling, committed spend limit
 */

import { query } from '../shared/db.js';
import { config } from '../shared/config.js';
import type { AdmissionContext, CostGuardConfig, CostGuardOverrunOptions } from '../shared/types.js';

export interface CostGuardResult {
  blocked: boolean;
  paused: boolean;
  estimatedCost: number;
  userBudgetRemaining: number;
  projectCeilingRemaining: number;
  committedSpendRemaining: number;
  options?: CostGuardOverrunOptions;
  reason?: string;
}

/**
 * Get per-model cost estimate (CL-010)
 */
export function getModelCostEstimate(modelId: string, durationSeconds: number): number {
  const estimates = config.admission.costGuard.perModelEstimates;
  const costPerSecond = estimates[modelId] ?? 0.05; // Conservative default
  return costPerSecond * durationSeconds;
}

/**
 * Main Cost Guard check
 */
export async function checkCostGuard(context: AdmissionContext): Promise<CostGuardResult> {
  const costConfig = config.admission.costGuard;

  // Get shot duration from context (would come from shot plan)
  const shotDurationSeconds = (context as any).shotDurationSeconds || 10;
  const estimatedCost = getModelCostEstimate(context.modelId, shotDurationSeconds);

  // Get user's current spend
  const userSpendResult = await query(
    `SELECT COALESCE(SUM(amount_usd), 0) as total_spend
     FROM cost_records
     WHERE user_id = $1 AND cost_type = 'actual'`,
    [context.userId]
  );
  const userTotalSpend = parseFloat(userSpendResult.rows[0].total_spend);

  // Get project spend
  const projectSpendResult = await query(
    `SELECT COALESCE(SUM(amount_usd), 0) as total_spend
     FROM cost_records
     WHERE story_id = $1 AND cost_type = 'actual'`,
    [context.storyId]
  );
  const projectTotalSpend = parseFloat(projectSpendResult.rows[0].total_spend);

  // Get committed spend (dispatched but not completed)
  const committedSpendResult = await query(
    `SELECT COALESCE(SUM(estimated_cost), 0) as committed
     FROM shots
     WHERE story_id = $1 AND status IN ('dispatched', 'generating')`,
    [context.storyId]
  );
  const committedSpend = parseFloat(committedSpendResult.rows[0].committed);

  // Calculate remaining budgets
  const userBudgetRemaining = costConfig.userBudgetUsd - userTotalSpend;
  const projectCeilingRemaining = costConfig.projectCeilingUsd - projectTotalSpend;
  const committedSpendRemaining = costConfig.committedSpendLimitUsd - committedSpend;

  // Check overruns
  const overruns: string[] = [];

  if (estimatedCost > userBudgetRemaining) {
    overruns.push(`User budget exceeded: $${estimatedCost.toFixed(2)} > $${userBudgetRemaining.toFixed(2)} remaining`);
  }

  if (estimatedCost > projectCeilingRemaining) {
    overruns.push(`Project ceiling exceeded: $${estimatedCost.toFixed(2)} > $${projectCeilingRemaining.toFixed(2)} remaining`);
  }

  if (estimatedCost > committedSpendRemaining) {
    overruns.push(`Committed spend limit exceeded: $${estimatedCost.toFixed(2)} > $${committedSpendRemaining.toFixed(2)} remaining`);
  }

  if (overruns.length > 0) {
    return {
      blocked: false, // Doesn't block, pauses with options
      paused: true,
      estimatedCost,
      userBudgetRemaining,
      projectCeilingRemaining,
      committedSpendRemaining,
      options: {
        reduceScope: true,
        increaseBudget: true,
        cancel: true,
      },
      reason: overruns.join('; '),
    };
  }

  return {
    blocked: false,
    paused: false,
    estimatedCost,
    userBudgetRemaining,
    projectCeilingRemaining,
    committedSpendRemaining,
  };
}

/**
 * Record cost estimate to cost_records
 */
export async function recordCostEstimate(
  storyId: string,
  shotId: string,
  modelId: string,
  userId: string,
  estimatedCost: number,
  metadata: Record<string, any> = {}
): Promise<void> {
  await query(
    `INSERT INTO cost_records (story_id, shot_id, model_id, user_id, cost_type, amount_usd, currency, metadata)
     VALUES ($1, $2, $3, $4, 'estimated', $5, 'USD', $6)`,
    [storyId, shotId, modelId, userId, estimatedCost, JSON.stringify(metadata)]
  );
}

/**
 * Record actual cost after generation
 */
export async function recordActualCost(
  storyId: string,
  shotId: string | null,
  modelId: string,
  userId: string,
  actualCost: number,
  metadata: Record<string, any> = {}
): Promise<void> {
  await query(
    `INSERT INTO cost_records (story_id, shot_id, model_id, user_id, cost_type, amount_usd, currency, metadata)
     VALUES ($1, $2, $3, $4, 'actual', $5, 'USD', $6)`,
    [storyId, shotId, modelId, userId, actualCost, JSON.stringify(metadata)]
  );

  // Check for drift alerts (CL-011)
  await checkCostDrift(storyId, shotId, modelId, userId, actualCost, metadata);
}

/**
 * Check cost drift (FR-021, CL-011, AC-028)
 * Single-shot >50% or rolling average >20%
 */
async function checkCostDrift(
  storyId: string,
  shotId: string | null,
  modelId: string,
  userId: string,
  actualCost: number,
  metadata: Record<string, any>
): Promise<void> {
  const costConfig = config.admission.costGuard;

  // Get estimated cost for this shot
  const estimateResult = await query(
    `SELECT amount_usd FROM cost_records
     WHERE story_id = $1 AND shot_id = $2 AND cost_type = 'estimated'
     ORDER BY timestamp DESC LIMIT 1`,
    [storyId, shotId]
  );

  if (estimateResult.rows.length === 0) return;

  const estimatedCost = parseFloat(estimateResult.rows[0].amount_usd);
  if (estimatedCost === 0) return;

  const singleShotDrift = (actualCost - estimatedCost) / estimatedCost;

  // Single-shot drift alert
  if (singleShotDrift > costConfig.singleShotDriftThreshold) {
    await recordDriftAlert(storyId, shotId, modelId, userId, 'single_shot', singleShotDrift, actualCost, estimatedCost);
  }

  // Rolling average drift
  const recentResult = await query(
    `SELECT amount_usd, cost_type FROM cost_records
     WHERE story_id = $1 AND cost_type IN ('estimated', 'actual')
     ORDER BY timestamp DESC LIMIT 20`,
    [storyId]
  );

  if (recentResult.rows.length >= 4) {
    let estimatedSum = 0;
    let actualSum = 0;
    let count = 0;

    for (const row of recentResult.rows) {
      const amount = parseFloat(row.amount_usd);
      if (row.cost_type === 'estimated') {
        estimatedSum += amount;
      } else {
        actualSum += amount;
      }
      count++;
    }

    if (estimatedSum > 0 && count >= 4) {
      const rollingDrift = (actualSum - estimatedSum) / estimatedSum;

      if (rollingDrift > costConfig.rollingAverageDriftThreshold) {
        await recordDriftAlert(storyId, shotId, modelId, userId, 'rolling_average', rollingDrift, actualSum, estimatedSum);
      }
    }
  }
}

async function recordDriftAlert(
  storyId: string,
  shotId: string | null,
  modelId: string,
  userId: string,
  type: 'single_shot' | 'rolling_average',
  driftPercentage: number,
  actualAmount: number,
  estimatedAmount: number
): Promise<void> {
  await query(
    `INSERT INTO cost_records (story_id, shot_id, model_id, user_id, cost_type, amount_usd, currency, metadata)
     VALUES ($1, $2, $3, $4, 'drift_alert', $5, 'USD', $6)`,
    [
      storyId,
      shotId,
      modelId,
      userId,
      0, // Alert amount is 0, details in metadata
      JSON.stringify({
        type,
        driftPercentage,
        actualAmount,
        estimatedAmount,
        alertThreshold: type === 'single_shot'
          ? config.admission.costGuard.singleShotDriftThreshold
          : config.admission.costGuard.rollingAverageDriftThreshold,
      }),
    ]
  );
}

/**
 * Record Cost Guard audit
 */
export async function recordCostGuardAudit(
  context: AdmissionContext,
  result: CostGuardResult
): Promise<void> {
  await query(
    `INSERT INTO admission_audit (story_id, shot_id, gate, decision, reason, category, rule_triggered, full_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      context.storyId,
      context.shotId,
      'cost_guard',
      result.paused ? 'warn' : 'pass',
      result.reason,
      'cost_overrun',
      result.paused ? 'cost_guard_overrun' : null,
      JSON.stringify({
        estimatedCost: result.estimatedCost,
        userBudgetRemaining: result.userBudgetRemaining,
        projectCeilingRemaining: result.projectCeilingRemaining,
        committedSpendRemaining: result.committedSpendRemaining,
        options: result.options,
      }),
    ]
  );
}