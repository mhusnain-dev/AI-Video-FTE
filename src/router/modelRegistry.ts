/**
 * Model Registry Service
 * Implements FR-005, FR-007, CL-006, CL-012, EC-012
 * Manages model capabilities, eligibility filtering, and configuration
 */

import { query } from '../shared/db.js';
import { config } from '../shared/config.js';
import type {
  ModelCapabilities,
  ModelCapability,
  ModelPriorityConfig,
  SystemDefaultModelPriority,
  Resolution,
  AspectRatio,
} from '../shared/types.js';
// Metrics
import {
  modelEligibilityFilteredTotal,
  modelRegistryRefreshTotal,
} from '../shared/metrics.js';

// In-memory cache
let modelRegistryCache: ModelCapabilities[] = [];
let cacheExpiry = 0;
const CACHE_TTL_MS = 300000; // 5 minutes (config.modelRegistry.refreshIntervalMs)

/**
 * Refresh model registry from database and config
 */
export async function refreshModelRegistry(): Promise<ModelCapabilities[]> {
  // Start with config defaults
  const models = [...config.modelRegistry.models];

  // Override with any database-stored models (for dynamic provider additions)
  try {
    const result = await query(
      `SELECT * FROM model_registry WHERE is_active = TRUE`
    );

    for (const row of result.rows) {
      const existingIndex = models.findIndex(m => m.id === row.id);
      const dbModel: ModelCapabilities = {
        id: row.id,
        name: row.name,
        provider: row.provider,
        maxResolution: row.max_resolution,
        maxDurationSeconds: row.max_duration_seconds,
        supportedAspectRatios: row.supported_aspect_ratios,
        supportedRegions: row.supported_regions,
        costPerSecondUsd: parseFloat(row.cost_per_second_usd),
        costCurrency: row.cost_currency,
        capabilities: row.capabilities,
        defaultTimeoutSeconds: row.default_timeout_seconds,
      };

      if (existingIndex >= 0) {
        models[existingIndex] = dbModel;
      } else {
        models.push(dbModel);
      }
    }
    modelRegistryRefreshTotal.inc({ success: 'true' });
  } catch (error) {
    // Table might not exist yet, use config only
    console.warn('model_registry table not found, using config only');
    modelRegistryRefreshTotal.inc({ success: 'false' });
  }

  modelRegistryCache = models;
  cacheExpiry = Date.now() + CACHE_TTL_MS;

  return models;
}

/**
 * Get all registered models (with caching)
 */
export async function getModelRegistry(): Promise<ModelCapabilities[]> {
  if (Date.now() >= cacheExpiry || modelRegistryCache.length === 0) {
    return refreshModelRegistry();
  }
  return modelRegistryCache;
}

/**
 * Get model by ID
 */
export async function getModelById(modelId: string): Promise<ModelCapabilities | null> {
  const models = await getModelRegistry();
  return models.find(m => m.id === modelId) || null;
}

/**
 * Check if model is eligible for a shot (FR-007, EC-012)
 */
export interface EligibilityCheck {
  eligible: boolean;
  reason?: string;
}

export async function checkModelEligibility(
  modelId: string,
  requirements: {
    resolution?: Resolution;
    aspectRatio?: AspectRatio;
    durationSeconds?: number;
    region?: string;
    requiredCapabilities?: ModelCapability[];
  }
): Promise<EligibilityCheck> {
  const model = await getModelById(modelId);
  if (!model) {
    modelEligibilityFilteredTotal.inc({ model_id: modelId, reason: 'not_found' });
    return { eligible: false, reason: `Model ${modelId} not found` };
  }

  // Check resolution
  if (requirements.resolution) {
    const resolutionOrder: Resolution[] = ['720p', '1080p', '4K'];
    const modelMaxIndex = resolutionOrder.indexOf(model.maxResolution);
    const requiredIndex = resolutionOrder.indexOf(requirements.resolution);
    if (requiredIndex > modelMaxIndex) {
      modelEligibilityFilteredTotal.inc({ model_id: modelId, reason: 'resolution_mismatch' });
      return { eligible: false, reason: `Model max resolution ${model.maxResolution} < required ${requirements.resolution}` };
    }
  }

  // Check aspect ratio
  if (requirements.aspectRatio && !model.supportedAspectRatios.includes(requirements.aspectRatio)) {
    modelEligibilityFilteredTotal.inc({ model_id: modelId, reason: 'aspect_ratio_mismatch' });
    return { eligible: false, reason: `Model does not support aspect ratio ${requirements.aspectRatio}` };
  }

  // Check duration
  if (requirements.durationSeconds && requirements.durationSeconds > model.maxDurationSeconds) {
    modelEligibilityFilteredTotal.inc({ model_id: modelId, reason: 'duration_exceeded' });
    return { eligible: false, reason: `Shot duration ${requirements.durationSeconds}s exceeds model max ${model.maxDurationSeconds}s` };
  }

  // Check region
  if (requirements.region && !model.supportedRegions.includes(requirements.region)) {
    modelEligibilityFilteredTotal.inc({ model_id: modelId, reason: 'region_unavailable' });
    return { eligible: false, reason: `Model not available in region ${requirements.region}` };
  }

  // Check required capabilities
  if (requirements.requiredCapabilities) {
    for (const cap of requirements.requiredCapabilities) {
      if (!model.capabilities.includes(cap)) {
        modelEligibilityFilteredTotal.inc({ model_id: modelId, reason: `missing_capability_${cap}` });
        return { eligible: false, reason: `Model lacks required capability: ${cap}` };
      }
    }
  }

  return { eligible: true };
}

/**
 * Get eligible models for requirements, ordered by priority (FR-006, FR-007)
 */
export async function getEligibleModels(
  requirements: {
    resolution?: Resolution;
    aspectRatio?: AspectRatio;
    durationSeconds?: number;
    region?: string;
    requiredCapabilities?: ModelCapability[];
  },
  userPriorityList?: string[] // User's configured priority (CL-006)
): Promise<ModelCapabilities[]> {
  const models = await getModelRegistry();
  const eligible: ModelCapabilities[] = [];

  for (const model of models) {
    const check = await checkModelEligibility(model.id, requirements);
    if (check.eligible) {
      eligible.push(model);
    }
  }

  // Sort by priority
  const priorityList = userPriorityList || config.router.systemDefaultPriority;
  console.log(`[Router] Priority list: ${JSON.stringify(priorityList)}`);
  console.log(`[Router] Eligible models: ${eligible.map(m => m.id).join(', ')}`);
  const priorityMap = new Map(priorityList.map((id, index) => [id, index]));

  eligible.sort((a, b) => {
    const aPriority = priorityMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bPriority = priorityMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aPriority - bPriority;
  });

  return eligible;
}

/**
 * Get user's model priority configuration (CL-006)
 */
export async function getUserModelPriority(userId: string): Promise<ModelPriorityConfig | null> {
  const result = await query(
    `SELECT * FROM user_model_priorities WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    userId: row.user_id,
    priorityList: row.priority_list,
    updatedAt: row.updated_at,
  };
}

/**
 * Set user's model priority configuration (CL-006)
 */
export async function setUserModelPriority(userId: string, priorityList: string[]): Promise<ModelPriorityConfig> {
  // Validate all model IDs exist
  const models = await getModelRegistry();
  const validIds = new Set(models.map(m => m.id));

  for (const id of priorityList) {
    if (!validIds.has(id)) {
      throw new Error(`Invalid model ID in priority list: ${id}`);
    }
  }

  await query(
    `INSERT INTO user_model_priorities (user_id, priority_list, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET priority_list = $2, updated_at = NOW()`,
    [userId, priorityList]
  );

  return { userId, priorityList, updatedAt: new Date() };
}

/**
 * Get system default model priority (CL-006)
 */
export async function getSystemDefaultPriority(): Promise<SystemDefaultModelPriority> {
  return {
    priorityList: config.router.systemDefaultPriority,
    updatedAt: new Date(),
  };
}

/**
 * Set system default model priority (admin only)
 */
export async function setSystemDefaultPriority(priorityList: string[]): Promise<SystemDefaultModelPriority> {
  // Validate all model IDs exist
  const models = await getModelRegistry();
  const validIds = new Set(models.map(m => m.id));

  for (const id of priorityList) {
    if (!validIds.has(id)) {
      throw new Error(`Invalid model ID in priority list: ${id}`);
    }
  }

  // Update config (in production, this would persist to database)
  config.router.systemDefaultPriority = priorityList;

  return { priorityList, updatedAt: new Date() };
}

/**
 * Add or update model in registry (admin)
 */
export async function upsertModel(model: ModelCapabilities): Promise<void> {
  await query(
    `INSERT INTO model_registry (id, name, provider, max_resolution, max_duration_seconds, supported_aspect_ratios, supported_regions, cost_per_second_usd, cost_currency, capabilities, default_timeout_seconds, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = $2, provider = $3, max_resolution = $4, max_duration_seconds = $5,
       supported_aspect_ratios = $6, supported_regions = $7, cost_per_second_usd = $8,
       cost_currency = $9, capabilities = $10, default_timeout_seconds = $11,
       updated_at = NOW()`,
    [
      model.id,
      model.name,
      model.provider,
      model.maxResolution,
      model.maxDurationSeconds,
      model.supportedAspectRatios,
      model.supportedRegions,
      model.costPerSecondUsd,
      model.costCurrency,
      model.capabilities,
      model.defaultTimeoutSeconds,
    ]
  );

  // Invalidate cache
  cacheExpiry = 0;
}

/**
 * Deactivate model (admin)
 */
export async function deactivateModel(modelId: string): Promise<void> {
  await query(
    `UPDATE model_registry SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
    [modelId]
  );
  cacheExpiry = 0;
}

/**
 * Model Registry Database Initialization
 * Call on startup to create table if not exists
 */
export async function initializeModelRegistryTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS model_registry (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      provider VARCHAR(100) NOT NULL,
      max_resolution VARCHAR(10) NOT NULL,
      max_duration_seconds INTEGER NOT NULL,
      supported_aspect_ratios VARCHAR(10)[] NOT NULL,
      supported_regions VARCHAR(10)[] NOT NULL,
      cost_per_second_usd DECIMAL(10, 4) NOT NULL,
      cost_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      capabilities VARCHAR(50)[] NOT NULL,
      default_timeout_seconds INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_model_priorities (
      user_id UUID PRIMARY KEY,
      priority_list VARCHAR(100)[] NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed default models from config if table is empty
  const count = await query(`SELECT COUNT(*) FROM model_registry`);
  if (parseInt(count.rows[0].count) === 0) {
    for (const model of config.modelRegistry.models) {
      await upsertModel(model);
    }
  }
}