/**
 * Router API Routes
 * REST endpoints for model selection, registry management, and user preferences
 */

import express, { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { getModelRegistry, getModelById, upsertModel, deactivateModel, initializeModelRegistryTable } from './modelRegistry.js';
import { selectModelForShot, getNextFallback, getDispatchHistory, recordDispatchAttempt } from './autoRouter.js';
import { getUserModelPriority, setUserModelPriority, getSystemDefaultPriority, setSystemDefaultPriority } from './modelRegistry.js';
import { getAdapter, getAllAdapters, initializeAdapters } from './modelAdapter.js';
import type { ShotRequirements } from './autoRouter.js';
import type { ModelCapabilities } from '../shared/types.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Initialize on first request
let initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await initializeModelRegistryTable();
    await initializeAdapters();
    initialized = true;
  }
}

// ============================================
// Model Registry Endpoints (Admin)
// ============================================

/**
 * GET /models - List all models
 */
router.get(
  '/models',
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const models = await getModelRegistry();
      res.json({ models });
    } catch (error) {
      console.error('Get models error:', error);
      res.status(500).json({ error: 'Failed to get models' });
    }
  }
);

/**
 * GET /models/:modelId - Get model details
 */
router.get(
  '/models/:modelId',
  [param('modelId').isString().notEmpty()],
  validate,
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const model = await getModelById(req.params.modelId as string);
      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }
      res.json(model);
    } catch (error) {
      console.error('Get model error:', error);
      res.status(500).json({ error: 'Failed to get model' });
    }
  }
);

/**
 * POST /models - Add/Update model (admin)
 */
router.post(
  '/models',
  [
    body('id').isString().notEmpty(),
    body('name').isString().notEmpty(),
    body('provider').isString().notEmpty(),
    body('maxResolution').isIn(['720p', '1080p', '4K']),
    body('maxDurationSeconds').isInt({ min: 1, max: 300 }),
    body('supportedAspectRatios').isArray(),
    body('supportedRegions').isArray(),
    body('costPerSecondUsd').isFloat({ min: 0 }),
    body('costCurrency').isString().optional(),
    body('capabilities').isArray(),
    body('defaultTimeoutSeconds').isInt({ min: 10, max: 600 }),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const model: ModelCapabilities = req.body;
      await upsertModel(model);
      res.status(201).json({ success: true, modelId: model.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  }
);

/**
 * DELETE /models/:modelId - Deactivate model (admin)
 */
router.delete(
  '/models/:modelId',
  [param('modelId').isString().notEmpty()],
  validate,
  async (req: Request, res: Response) => {
    try {
      await deactivateModel(req.params.modelId as string);
      res.json({ success: true });
    } catch (error) {
      console.error('Deactivate model error:', error);
      res.status(500).json({ error: 'Failed to deactivate model' });
    }
  }
);

// ============================================
// Model Selection / Routing Endpoints
// ============================================

/**
 * POST /route - Select best model for shot (FR-006, FR-007, FR-008)
 */
router.post(
  '/route',
  [
    body('userId').isUUID(),
    body('requirements.resolution').optional().isIn(['720p', '1080p', '4K']),
    body('requirements.aspectRatio').optional().isIn(['16:9', '9:16', '1:1', '4:5']),
    body('requirements.durationSeconds').optional().isInt({ min: 1, max: 300 }),
    body('requirements.region').optional().isString(),
    body('requirements.requiredCapabilities').optional().isArray(),
    body('requirements.modelOverride').optional().isString(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const { userId, requirements } = req.body as { userId: string; requirements: ShotRequirements };
      const decision = await selectModelForShot(userId, requirements);
      res.json(decision);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not eligible') || message.includes('not found') || message.includes('No eligible')) {
        return res.status(400).json({ error: message });
      }
      console.error('Route selection error:', error);
      res.status(500).json({ error: 'Failed to select model' });
    }
  }
);

/**
 * POST /fallback - Get next fallback model (FR-020)
 */
router.post(
  '/fallback',
  [
    body('shotId').isUUID(),
    body('failedModelId').isString().notEmpty(),
    body('requirements.resolution').optional().isIn(['720p', '1080p', '4K']),
    body('requirements.aspectRatio').optional().isIn(['16:9', '9:16', '1:1', '4:5']),
    body('requirements.durationSeconds').optional().isInt({ min: 1, max: 300 }),
    body('requirements.region').optional().isString(),
    body('requirements.requiredCapabilities').optional().isArray(),
    body('userId').isUUID(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const { shotId, failedModelId, requirements, userId } = req.body;
      const fallback = await getNextFallback(shotId, failedModelId, requirements, userId);
      if (!fallback) {
        return res.status(404).json({ error: 'All models exhausted' });
      }
      res.json({ model: fallback });
    } catch (error) {
      console.error('Fallback error:', error);
      res.status(500).json({ error: 'Failed to get fallback' });
    }
  }
);

/**
 * POST /dispatch - Record dispatch attempt
 */
router.post(
  '/dispatch',
  [
    body('shotId').isUUID(),
    body('modelId').isString().notEmpty(),
    body('providerRequestId').optional().isString(),
    body('status').isIn(['pending', 'dispatched', 'completed', 'failed', 'timeout', 'fallback']),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      await recordDispatchAttempt(
        req.body.shotId,
        req.body.modelId,
        req.body.providerRequestId,
        req.body.status
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Record dispatch error:', error);
      res.status(500).json({ error: 'Failed to record dispatch' });
    }
  }
);

/**
 * GET /dispatch/:shotId/history - Get dispatch history for shot
 */
router.get(
  '/dispatch/:shotId/history',
  [param('shotId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    try {
      const history = await getDispatchHistory(req.params.shotId as string);
      res.json({ history });
    } catch (error) {
      console.error('Get dispatch history error:', error);
      res.status(500).json({ error: 'Failed to get dispatch history' });
    }
  }
);

// ============================================
// User Model Priority Endpoints (CL-006)
// ============================================

/**
 * GET /users/:userId/model-priority - Get user's model priority
 */
router.get(
  '/users/:userId/model-priority',
  [param('userId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    try {
      const priority = await getUserModelPriority(req.params.userId as string);
      if (!priority) {
        // Return system default
        const sysDefault = await getSystemDefaultPriority();
        return res.json({ priority: sysDefault, isDefault: true });
      }
      res.json({ priority, isDefault: false });
    } catch (error) {
      console.error('Get user priority error:', error);
      res.status(500).json({ error: 'Failed to get user priority' });
    }
  }
);

/**
 * PUT /users/:userId/model-priority - Set user's model priority (CL-006)
 */
router.put(
  '/users/:userId/model-priority',
  [
    param('userId').isUUID(),
    body('priorityList').isArray({ min: 1 }),
    body('priorityList.*').isString(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const priority = await setUserModelPriority(req.params.userId as string, req.body.priorityList);
      res.json({ priority });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('Invalid model ID')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: 'Failed to set user priority' });
    }
  }
);

/**
 * GET /system/model-priority - Get system default priority
 */
router.get(
  '/system/model-priority',
  async (req: Request, res: Response) => {
    try {
      const priority = await getSystemDefaultPriority();
      res.json(priority);
    } catch (error) {
      console.error('Get system priority error:', error);
      res.status(500).json({ error: 'Failed to get system priority' });
    }
  }
);

/**
 * PUT /system/model-priority - Set system default priority (admin)
 */
router.put(
  '/system/model-priority',
  [
    body('priorityList').isArray({ min: 1 }),
    body('priorityList.*').isString(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const priority = await setSystemDefaultPriority(req.body.priorityList);
      res.json(priority);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('Invalid model ID')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: 'Failed to set system priority' });
    }
  }
);

// ============================================
// Adapter Management
// ============================================

/**
 * GET /adapters - List all registered adapters
 */
router.get(
  '/adapters',
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const adapters = getAllAdapters().map(a => ({
        modelId: a.modelId,
        provider: a.provider,
        supportedCapabilities: [
          'text_to_video',
          'image_to_video',
          'reference_conditioning',
        ].filter(c => a.supportsCapability(c)),
        maxDuration: a.getMaxDurationSeconds(),
        supportedResolutions: a.getSupportedResolutions(),
        supportedAspectRatios: a.getSupportedAspectRatios(),
      }));
      res.json({ adapters });
    } catch (error) {
      console.error('Get adapters error:', error);
      res.status(500).json({ error: 'Failed to get adapters' });
    }
  }
);

export default router;