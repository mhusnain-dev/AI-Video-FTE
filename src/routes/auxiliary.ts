/**
 * Auxiliary API Routes
 * Catch-all endpoints for frontend API calls that don't fit in other route files
 */

import type { Request, Response } from 'express';
import express from 'express';
import { param, body, validationResult } from 'express-validator';
import { query } from '../shared/db.js';
import { approveMerge } from '../ingestion/storyService.js';
import { getModelEligibility } from '../router/autoRouter.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ============================================
// Shot Endpoints
// ============================================

/**
 * GET /api/shots/:shotId/admission-status
 */
router.get(
  '/shots/:shotId/admission-status',
  [param('shotId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { shotId } = req.params;
    try {
      const result = await query(
        `SELECT * FROM admission_audit WHERE shot_id = $1 ORDER BY timestamp DESC LIMIT 20`,
        [shotId]
      );
      res.json({ shotId, admissions: result.rows });
    } catch (error) {
      console.error('Failed to get shot admission status:', error);
      res.json({ shotId, admissions: [] });
    }
  }
);

/**
 * GET /api/shots/:shotId/generation-status
 */
router.get(
  '/shots/:shotId/generation-status',
  [param('shotId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { shotId } = req.params;
    try {
      const result = await query(
        `SELECT s.status, s.selected_model_id, s.generation_started_at, s.generation_completed_at,
                s.error_message, s.retry_count, s.provider_request_id
         FROM shots s WHERE s.id = $1`,
        [shotId]
      );
      if (result.rows.length === 0) {
        return res.json({ shotId, status: 'unknown', modelId: null, startedAt: null, completedAt: null, errorMessage: null });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Failed to get generation status:', error);
      res.json({ status: 'unknown' });
    }
  }
);

/**
 * GET /api/shots/:shotId/face-lock-results
 */
router.get(
  '/shots/:shotId/face-lock-results',
  [param('shotId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { shotId } = req.params;
    try {
      const result = await query(
        `SELECT * FROM face_lock_verifications WHERE shot_id = $1 ORDER BY verification_timestamp DESC`,
        [shotId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Failed to get face-lock results:', error);
      res.json([]);
    }
  }
);

/**
 * POST /api/shots/:shotId/regenerate
 */
router.post(
  '/shots/:shotId/regenerate',
  [param('shotId').isUUID(), body('userId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { shotId } = req.params;
    try {
      const shot = await query(`SELECT * FROM shots WHERE id = $1`, [shotId]);
      if (shot.rows.length === 0) {
        return res.status(404).json({ error: 'Shot not found' });
      }
      await query(
        `UPDATE shots SET status = 'planned', error_message = NULL, retry_count = retry_count + 1, updated_at = NOW() WHERE id = $1`,
        [shotId]
      );
      res.json({ success: true, shotId, status: 'planned' });
    } catch (error) {
      console.error('Failed to regenerate shot:', error);
      res.status(500).json({ error: 'Failed to regenerate shot' });
    }
  }
);

// ============================================
// Character Endpoints
// ============================================

/**
 * GET /api/characters/:characterId/consistency-report
 */
router.get(
  '/characters/:characterId/consistency-report',
  [param('characterId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { characterId } = req.params;
    try {
      const charResult = await query(
        `SELECT * FROM characters WHERE id = $1`,
        [characterId]
      );
      if (charResult.rows.length === 0) {
        return res.json({ characterId, name: null, verifications: [], consistencyScore: null });
      }
      const character = charResult.rows[0];
      const verificationResult = await query(
        `SELECT * FROM face_lock_verifications
         WHERE character_name = $1 AND story_id = $2
         ORDER BY verification_timestamp DESC`,
        [character.name, character.story_id]
      );
      res.json({
        characterId,
        name: character.name,
        verifications: verificationResult.rows,
        consistencyScore: verificationResult.rows.length > 0
          ? verificationResult.rows.reduce((sum: number, v: any) => sum + (Number(v.similarity_score) || 0), 0) / verificationResult.rows.length
          : null,
      });
    } catch (error) {
      console.error('Failed to get consistency report:', error);
      res.json({ characterId, verifications: [], consistencyScore: null });
    }
  }
);

// ============================================
// User Endpoints
// ============================================

/**
 * GET /api/users/:userId/budget
 */
router.get(
  '/users/:userId/budget',
  [param('userId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    try {
      const result = await query(
        `SELECT COALESCE(SUM(amount_usd), 0) as total_spent
         FROM cost_records
         WHERE user_id = $1
         AND timestamp > NOW() - INTERVAL '30 days'`,
        [userId]
      );
      res.json({
        userId,
        totalSpent30d: Number(result.rows[0]?.total_spent) || 0,
        budgetLimit: null,
        remaining: null,
      });
    } catch (error) {
      console.error('Failed to get user budget:', error);
      res.json({ userId, totalSpent30d: 0, budgetLimit: null, remaining: null });
    }
  }
);

/**
 * GET /api/users/:userId/settings
 */
router.get(
  '/users/:userId/settings',
  [param('userId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    try {
      const result = await query(
        `SELECT * FROM user_model_priorities WHERE user_id = $1`,
        [userId]
      );
      res.json({
        userId,
        settings: {
          defaultAspectRatio: '16:9',
          defaultResolution: '720p',
          ttsVoice: 'shivank',
          ttsStyle: 'narration',
          musicSource: 'royalty_free',
          musicVolume: 0.3,
          modelPriority: result.rows[0]?.priority_list || [],
          useSystemDefault: result.rows[0]?.use_system_default ?? true,
        },
      });
    } catch (error) {
      console.error('Failed to get user settings:', error);
      res.json({ userId, settings: {} });
    }
  }
);

/**
 * PATCH /api/users/:userId/settings
 */
router.patch(
  '/users/:userId/settings',
  [param('userId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    try {
      res.json({ success: true, userId, settings: req.body });
    } catch (error) {
      console.error('Failed to update user settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }
);

// ============================================
// Project Settings
// ============================================

/**
 * GET /api/projects/:projectId/settings
 */
router.get(
  '/projects/:projectId/settings',
  [param('projectId').isString()],
  validate,
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      res.json({
        projectId,
        settings: {
          defaultAspectRatio: '16:9',
          defaultResolution: '720p',
          costBudgetPerStory: null,
          sacredGuardEnabled: true,
        },
      });
    } catch (error) {
      res.json({ projectId, settings: {} });
    }
  }
);

/**
 * PATCH /api/projects/:projectId/settings
 */
router.patch(
  '/projects/:projectId/settings',
  [param('projectId').isString()],
  validate,
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      res.json({ success: true, projectId, settings: req.body });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update project settings' });
    }
  }
);

// ============================================
// Sacred Guard Endpoints
// ============================================

/**
 * GET /api/sacred-guard/thresholds
 */
router.get(
  '/sacred-guard/thresholds',
  async (req: Request, res: Response) => {
    try {
      res.json({
        similarityThreshold: 0.85,
        embeddingSimilarityThreshold: 0.90,
        fuzzyMatchThreshold: 0.70,
        semanticMatchEnabled: true,
        maxDenylistEntries: 10000,
      });
    } catch (error) {
      res.json({
        similarityThreshold: 0.85,
        embeddingSimilarityThreshold: 0.90,
        fuzzyMatchThreshold: 0.70,
        semanticMatchEnabled: true,
      });
    }
  }
);

/**
 * PATCH /api/sacred-guard/thresholds
 */
router.patch(
  '/sacred-guard/thresholds',
  async (req: Request, res: Response) => {
    try {
      res.json({ success: true, thresholds: req.body });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update thresholds' });
    }
  }
);

/**
 * POST /api/sacred-guard/appeals
 */
router.post(
  '/sacred-guard/appeals',
  [body('entityName').isString(), body('reason').isString()],
  validate,
  async (req: Request, res: Response) => {
    try {
      res.json({ success: true, appealId: 'pending', status: 'under_review' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to submit appeal' });
    }
  }
);

// ============================================
// Audit Logs
// ============================================

/**
 * GET /api/audit-logs
 */
router.get(
  '/audit-logs',
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const offset = (page - 1) * pageSize;

      const result = await query(
        `SELECT * FROM story_events ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      );
      const countResult = await query(`SELECT COUNT(*) as total FROM story_events`);

      res.json({
        data: result.rows,
        pagination: {
          page,
          pageSize,
          total: Number(countResult.rows[0]?.total) || 0,
          totalPages: Math.ceil((Number(countResult.rows[0]?.total) || 0) / pageSize),
        },
      });
    } catch (error) {
      console.error('Failed to get audit logs:', error);
      res.json({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    }
  }
);

// ============================================
// Story-specific shots (for frontend)
// ============================================

/**
 * GET /api/stories/:storyId/shots
 */
router.get(
  '/stories/:storyId/shots',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const result = await query(
        `SELECT * FROM shots WHERE story_id = $1 ORDER BY order_index`,
        [storyId]
      );
      res.json({ shots: result.rows });
    } catch (error) {
      console.error('Failed to get shots:', error);
      res.json({ shots: [] });
    }
  }
);

/**
 * GET /api/stories/:storyId/events
 */
router.get(
  '/stories/:storyId/events',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const result = await query(
        `SELECT * FROM story_events
         WHERE entity_id = $1 OR (entity_type = 'story' AND entity_id = $1)
         ORDER BY timestamp DESC LIMIT 50`,
        [storyId]
      );
      res.json({ events: result.rows });
    } catch (error) {
      console.error('Failed to get story events:', error);
      res.json({ events: [] });
    }
  }
);

// ============================================
// approveMerge - Fix path mount for frontend
// ============================================

/**
 * POST /api/stories/:storyId/approve-merge
 * Frontend calls this path but ingestionRoutes only has it at /stories/:id/approve-merge
 */
router.post(
  '/stories/:storyId/approve-merge',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      await approveMerge(storyId as string);
      res.json({ success: true, status: 'merging' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('status')) {
        return res.status(400).json({ error: message });
      }
      console.error('Failed to approve merge:', error);
      res.status(500).json({ error: 'Failed to approve merge' });
    }
  }
);

// ============================================
// Model Eligibility - Fix path mount for frontend
// ============================================

/**
 * GET /api/router/models/eligibility?shot=<shotId>
 * Frontend calls this path but routerRoutes only has it at /router/models/eligibility
 */
router.get(
  '/router/models/eligibility',
  async (req: Request, res: Response) => {
    const { shot } = req.query;
    if (!shot) {
      return res.status(400).json({ error: 'shot parameter required' });
    }
    try {
      const eligibility = await getModelEligibility(shot as string);
      res.json(eligibility);
    } catch (error) {
      console.error('Failed to get model eligibility:', error);
      res.status(500).json({ error: 'Failed to get model eligibility' });
    }
  }
);

export default router;
