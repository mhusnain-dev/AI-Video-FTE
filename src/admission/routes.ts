/**
 * Admission API Routes
 * REST endpoints for admission pipeline management
 */

import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { runAdmissionPipeline, checkStoryCreationAdmission, checkPostGenerationAdmission, resolvePause } from './admissionController.js';
import { getRateLimitStatus } from './rateLimitGate.js';
import type { AdmissionContext } from '../shared/types.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /admission/check - Run full admission pipeline for a shot
 */
router.post(
  '/check',
  [
    body('storyId').isUUID(),
    body('shotId').isUUID(),
    body('userId').isUUID(),
    body('prompt').isString(),
    body('referenceImages').isArray(),
    body('modelId').isString().notEmpty(),
    body('estimatedCost').isFloat({ min: 0 }),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const context: AdmissionContext = req.body;
      const result = await runAdmissionPipeline(context);
      res.json(result);
    } catch (error) {
      console.error('Admission check error:', error);
      res.status(500).json({ error: 'Admission check failed' });
    }
  }
);

/**
 * POST /admission/story-creation - Check admission at story creation (enforcement point a)
 */
router.post(
  '/story-creation',
  [
    body('storyId').isUUID(),
    body('userId').isUUID(),
    body('prompt').isString(),
    body('referenceImages').isArray(),
    body('modelId').isString().notEmpty(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { storyId, userId, prompt, referenceImages, modelId } = req.body;
      const result = await checkStoryCreationAdmission(storyId, userId, prompt, referenceImages, modelId);
      res.json(result);
    } catch (error) {
      console.error('Story creation admission error:', error);
      res.status(500).json({ error: 'Story creation admission failed' });
    }
  }
);

/**
 * POST /admission/post-generation - Check admission post-generation (enforcement point e)
 */
router.post(
  '/post-generation',
  [
    body('storyId').isUUID(),
    body('shotId').isUUID(),
    body('userId').isUUID(),
    body('generatedFramesBase64').isArray(),
    body('modelId').isString().notEmpty(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { storyId, shotId, userId, generatedFramesBase64, modelId } = req.body;
      const result = await checkPostGenerationAdmission(storyId, shotId, userId, generatedFramesBase64, modelId);
      res.json(result);
    } catch (error) {
      console.error('Post-generation admission error:', error);
      res.status(500).json({ error: 'Post-generation admission failed' });
    }
  }
);

/**
 * POST /admission/resolve-pause - Resolve a paused story
 */
router.post(
  '/resolve-pause',
  [
    body('storyId').isUUID(),
    body('resolution').isIn(['reduce_scope', 'increase_budget', 'cancel', 'rate_limit_resolved', 'sacred_guard_resolved']),
    body('userId').isUUID(),
    body('metadata').optional().isObject(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { storyId, resolution, userId, metadata } = req.body;
      await resolvePause(storyId, resolution, userId, metadata || {});
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('Invalid resolution') || message.includes('not in paused state')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: 'Failed to resolve pause' });
    }
  }
);

/**
 * GET /admission/rate-limit-status - Get current rate limit status
 */
router.get(
  '/rate-limit-status',
  [
    body('userId').isUUID(),
    body('modelId').isString().notEmpty(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { userId, modelId } = req.body;
      const status = await getRateLimitStatus(userId, modelId);
      res.json(status);
    } catch (error) {
      console.error('Rate limit status error:', error);
      res.status(500).json({ error: 'Failed to get rate limit status' });
    }
  }
);

/**
 * GET /admission/audit - Get admission audit log for a story/shot
 */
router.get(
  '/audit',
  [
    body('storyId').isUUID(),
    body('shotId').optional().isUUID(),
    body('gate').optional().isIn(['moderation', 'sacred_guard', 'cost_guard', 'rate_limit']),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { query } = await import('../shared/db.js');
      const { storyId, shotId, gate } = req.body;

      let sql = `SELECT * FROM admission_audit WHERE story_id = $1`;
      const params: any[] = [storyId];

      if (shotId) {
        params.push(shotId);
        sql += ` AND shot_id = $${params.length}`;
      }
      if (gate) {
        params.push(gate);
        sql += ` AND gate = $${params.length}`;
      }

      sql += ` ORDER BY timestamp DESC LIMIT 100`;

      const result = await query(sql, params);
      res.json({ audit: result.rows });
    } catch (error) {
      console.error('Admission audit error:', error);
      res.status(500).json({ error: 'Failed to get admission audit' });
    }
  }
);

/**
 * POST /admission/denylist/add - Add entity to Sacred Guard denylist (first approval)
 */
router.post(
  '/denylist/add',
  [
    body('entityName').isString().notEmpty(),
    body('entityType').isString().notEmpty(),
    body('matchType').isIn(['exact', 'transliterated', 'fuzzy', 'visual_semantic']),
    body('requestedBy').isUUID(),
    body('embedding').optional().isArray(),
    body('metadata').optional().isObject(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { addToDenylist } = await import('./sacredGuard.js');
      const { entityName, entityType, matchType, requestedBy, embedding, metadata } = req.body;
      const id = await addToDenylist(entityName, entityType, matchType, requestedBy, embedding, metadata);
      res.json({ id, message: 'Denylist entry added, awaiting second approval for activation' });
    } catch (error) {
      console.error('Add denylist error:', error);
      res.status(500).json({ error: 'Failed to add denylist entry' });
    }
  }
);

/**
 * PUT /admission/denylist/:id/approve - Second approval to activate denylist entry
 */
router.put(
  '/denylist/:id/approve',
  [
    param('id').isUUID(),
    body('approverId').isUUID(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { approveDenylistEntry } = await import('./sacredGuard.js');
      const { id } = req.params as Record<string, string>;
      const { approverId } = req.body;
      await approveDenylistEntry(id, approverId);
      res.json({ success: true, message: 'Denylist entry activated' });
    } catch (error) {
      console.error('Approve denylist error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('Already fully approved')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: 'Failed to approve denylist entry' });
    }
  }
);

/**
 * DELETE /admission/denylist/:id - Remove denylist entry (dual-authorization)
 */
router.delete(
  '/denylist/:id',
  [
    param('id').isUUID(),
    body('approver1').isUUID(),
    body('approver2').isUUID(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { removeFromDenylist } = await import('./sacredGuard.js');
      const { id } = req.params as Record<string, string>;
      const { approver1, approver2 } = req.body;
      await removeFromDenylist(id, approver1, approver2);
      res.json({ success: true, message: 'Denylist entry deactivated' });
    } catch (error) {
      console.error('Remove denylist error:', error);
      res.status(500).json({ error: 'Failed to remove denylist entry' });
    }
  }
);

/**
 * POST /admission/denylist/:id/appeal - Appeal a Sacred Guard block
 */
router.post(
  '/denylist/:id/appeal',
  [
    param('id').isUUID(),
    body('appellantId').isUUID(),
    body('reason').isString().notEmpty(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { appealSacredGuardBlock } = await import('./sacredGuard.js');
      const { id } = req.params as Record<string, string>;
      const { appellantId, reason } = req.body;
      await appealSacredGuardBlock(id, appellantId, reason);
      res.json({ success: true, message: 'Appeal recorded' });
    } catch (error) {
      console.error('Appeal error:', error);
      res.status(500).json({ error: 'Failed to record appeal' });
    }
  }
);

export default router;