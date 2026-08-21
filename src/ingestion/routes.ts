/**
 * Ingestion API Routes
 * REST endpoints for story creation, plan presentation, revision, and character management
 */

import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import { body, param, query as queryValidator, validationResult } from 'express-validator';
import { createStory, getStory, presentShotPlan, approveShotPlan, approveMerge, reviseShotPlan, updateStoryStatus } from './storyService.js';
import { uploadCharacterReference, getCharacterReferences, getCharacterByName } from './characterService.js';
import { query } from '../shared/db.js';
import { publishStoryCommand } from '../shared/redis.js';
import type { CreateStoryRequest } from './storyService.js';
import type { CharacterReference, ShotPlanRevision, StoryStatus } from '../shared/types.js';

const router = express.Router();

// Validation middleware
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Error logging helper with context
function logError(error: unknown, context: Record<string, any>): void {
  console.error('API Error:', {
    message: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
    ...context,
  });
}

// ============================================
// Story Endpoints
// ============================================

/**
 * POST /stories - Create a new story (FR-001, FR-002, AC-001, AC-004)
 */
router.post(
  '/',
  [
    body('brief.narrative').isString().notEmpty().withMessage('Story narrative required'),
    body('brief.targetDurationSeconds').isInt({ min: 1, max: 3600 }).withMessage('Target duration must be 1-3600 seconds'),
    body('brief.aspectRatio').optional().isIn(['16:9', '9:16', '1:1', '4:5']),
    body('brief.resolution').optional().isIn(['720p', '1080p', '4K']),
    body('brief.characterReferences').optional().isArray(),
    body('brief.styleReferences').optional().isArray(),
    body('brief.negativePrompts').optional().isArray(),
    body('userId').isUUID().withMessage('Valid userId required'),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { userId } = req.body;
    try {
      const request: CreateStoryRequest = req.body;
      const result = await createStory(request);
      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('narrative required') || message.includes('Unable to derive shots')) {
        return res.status(400).json({ error: message });
      }
      logError(error, { endpoint: 'POST /stories', userId });
      res.status(500).json({ error: 'Failed to create story' });
    }
  }
);

/**
 * GET /stories/:storyId - Get story with shot plan
 */
router.get(
  '/:storyId',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const story = await getStory(storyId as string);
      if (!story) {
        return res.status(404).json({ error: 'Story not found' });
      }
      res.json(story);
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId', storyId });
      res.status(500).json({ error: 'Failed to get story' });
    }
  }
);

/**
 * POST /stories/:storyId/present - Present shot plan for approval (FR-003, AC-001)
 */
router.post(
  '/:storyId/present',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const result = await presentShotPlan(storyId as string);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('status')) {
        return res.status(400).json({ error: message });
      }
      logError(error, { endpoint: 'POST /stories/:storyId/present', storyId });
      res.status(500).json({ error: 'Failed to present plan' });
    }
  }
);

/**
 * POST /stories/:storyId/approve - Approve shot plan (FR-003)
 */
router.post(
  '/:storyId/approve',
  [
    param('storyId').isUUID(),
    body('userId').isUUID(),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    const { userId } = req.body;
    try {
      await approveShotPlan(storyId as string, userId);
      res.json({ success: true, status: 'approved' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('status')) {
        return res.status(400).json({ error: message });
      }
      logError(error, { endpoint: 'POST /stories/:storyId/approve', storyId, userId });
      res.status(500).json({ error: 'Failed to approve plan' });
    }
  }
);

/**
 * POST /stories/:storyId/approve-merge - Approve merge from pending_merge state
 */
router.post(
  '/:storyId/approve-merge',
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
      logError(error, { endpoint: 'POST /stories/:storyId/approve-merge', storyId });
      res.status(500).json({ error: 'Failed to approve merge' });
    }
  }
);

/**
 * PATCH /stories/:storyId/plan - Revise shot plan (FR-004, AC-003)
 */
router.patch(
  '/:storyId/plan',
  [
    param('storyId').isUUID(),
    body('revisions').isArray(),
    body('revisions.*.action').isIn(['add', 'remove', 'reorder', 'edit']),
    body('revisions.*.shotId').optional().isUUID(),
    body('revisions.*.newOrder').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const revisions: ShotPlanRevision[] = req.body.revisions;
      const shots = await reviseShotPlan(storyId as string, revisions);
      res.json({ shots });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('status')) {
        return res.status(400).json({ error: message });
      }
      logError(error, { endpoint: 'PATCH /stories/:storyId/plan', storyId });
      res.status(500).json({ error: 'Failed to revise plan' });
    }
  }
);

// ============================================
// Character Reference Endpoints
// ============================================

/**
 * POST /stories/:storyId/characters - Upload character reference (FR-001, FR-022, EC-003, EC-004, AC-002)
 */
router.post(
  '/:storyId/characters',
  [
    param('storyId').isUUID(),
    body('userId').isUUID(),
    body('character.name').isString().notEmpty().withMessage('Character name required'),
    body('character.imageBase64').isString().notEmpty().withMessage('Character reference image required'),
    body('character.voiceReferenceBase64').optional().isString(),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    const { userId, character } = req.body;
    try {
      const result = await uploadCharacterReference({
        storyId: storyId as string,
        userId,
        character,
      });
      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (
        message.includes('not found') ||
        message.includes('Unauthorized') ||
        message.includes('No face detected') ||
        message.includes('Sacred Guard') ||
        message.includes('already exists')
      ) {
        return res.status(400).json({ error: message });
      }
      logError(error, { endpoint: 'POST /stories/:storyId/characters', storyId, userId, characterName: character.name });
      res.status(500).json({ error: 'Failed to upload character reference' });
    }
  }
);

/**
 * GET /stories/:storyId/characters - List character references
 */
router.get(
  '/:storyId/characters',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const characters = await getCharacterReferences(storyId as string);
      res.json({ characters });
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId/characters', storyId });
      res.status(500).json({ error: 'Failed to get characters' });
    }
  }
);

/**
 * GET /stories/:storyId/characters/:name - Get character by name
 */
router.get(
  '/:storyId/characters/:name',
  [param('storyId').isUUID(), param('name').isString().notEmpty()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId, name } = req.params;
    try {
      const character = await getCharacterByName(storyId as string, name as string);
      if (!character) {
        return res.status(404).json({ error: 'Character not found' });
      }
      res.json(character);
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId/characters/:name', storyId, characterName: name });
      res.status(500).json({ error: 'Failed to get character' });
    }
  }
);

// ============================================
// List Stories (Dashboard)
// ============================================

/**
 * GET /stories - List stories with pagination
 */
router.get(
  '/',
  [
    queryValidator('page').optional().isInt({ min: 1 }),
    queryValidator('pageSize').optional().isInt({ min: 1, max: 100 }),
    queryValidator('status').optional().isString(),
    queryValidator('userId').optional().isUUID(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const status = req.query.status as string | undefined;
      const userId = req.query.userId as string | undefined;
      const offset = (page - 1) * pageSize;

      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      let paramIdx = 1;

      if (status) {
        whereClause += ` AND s.status = $${paramIdx++}`;
        params.push(status);
      }
      if (userId) {
        whereClause += ` AND s.user_id = $${paramIdx++}`;
        params.push(userId);
      }

      const countResult = await query<{ total: number }>(
        `SELECT COUNT(*) as total FROM stories s ${whereClause}`,
        params
      );
      const total = Number(countResult.rows[0]?.total) || 0;

      params.push(pageSize, offset);
      const storiesResult = await query(
        `SELECT s.*,
          (SELECT COUNT(*) FROM shots sh WHERE sh.story_id = s.id) as shot_count
         FROM stories s
         ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        params
      );

      res.json({
        data: storiesResult.rows,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    } catch (error) {
      logError(error, { endpoint: 'GET /stories' });
      res.status(500).json({ error: 'Failed to list stories' });
    }
  }
);

// ============================================
// Cancel Story
// ============================================

/**
 * POST /stories/:storyId/cancel - Cancel a story
 */
router.post(
  '/:storyId/cancel',
  [
    param('storyId').isUUID(),
    body('userId').isUUID(),
    body('option').optional().isString(),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const story = await getStory(storyId as string);
      if (!story) {
        return res.status(404).json({ error: 'Story not found' });
      }
      await updateStoryStatus(storyId as string, 'cancelled');
      res.json({ success: true, status: 'cancelled' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('status')) {
        return res.status(400).json({ error: message });
      }
      logError(error, { endpoint: 'POST /stories/:storyId/cancel', storyId });
      res.status(500).json({ error: 'Failed to cancel story' });
    }
  }
);

// ============================================
// Delivery Info
// ============================================

/**
 * GET /stories/:storyId/delivery - Get delivery info for a story
 */
router.get(
  '/:storyId/delivery',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const story = await getStory(storyId as string);
      if (!story) {
        return res.status(404).json({ error: 'Story not found' });
      }
      const deliveryResult = await query(
        `SELECT * FROM delivery_packages WHERE story_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [storyId]
      );
      const delivery = deliveryResult.rows[0] || null;
      res.json({
        storyId,
        status: story.status,
        delivery,
        shots: story.shots,
      });
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId/delivery', storyId });
      res.status(500).json({ error: 'Failed to get delivery info' });
    }
  }
);

// ============================================
// Download
// ============================================

/**
 * GET /stories/:storyId/download - Get download URL for a story
 */
router.get(
  '/:storyId/download',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const deliveryResult = await query(
        `SELECT * FROM delivery_packages WHERE story_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [storyId]
      );
      const delivery = deliveryResult.rows[0];
      if (!delivery) {
        return res.json({ signedUrl: '', expiresAt: null });
      }
      res.json({
        signedUrl: delivery.video_url || '',
        expiresAt: delivery.expires_at,
      });
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId/download', storyId });
      res.status(500).json({ error: 'Failed to get download URL' });
    }
  }
);

// ============================================
// State History
// ============================================

/**
 * GET /stories/:storyId/state-history - Get state change history for a story
 */
router.get(
  '/:storyId/state-history',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const result = await query(
        `SELECT * FROM story_events
         WHERE entity_id = $1 OR (entity_type = 'story' AND entity_id = $1)
         ORDER BY timestamp DESC
         LIMIT 100`,
        [storyId]
      );
      res.json(result.rows);
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId/state-history', storyId });
      res.status(500).json({ error: 'Failed to get state history' });
    }
  }
);

// ============================================
// Cost Breakdown
// ============================================

/**
 * GET /stories/:storyId/cost-breakdown - Get cost breakdown for a story
 */
router.get(
  '/:storyId/cost-breakdown',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const story = await getStory(storyId as string);
      if (!story) {
        return res.status(404).json({ error: 'Story not found' });
      }
      const costResult = await query(
        `SELECT model_id, cost_type, SUM(amount_usd) as total_usd, COUNT(*) as count
         FROM cost_records
         WHERE story_id = $1
         GROUP BY model_id, cost_type
         ORDER BY total_usd DESC`,
        [storyId]
      );
      res.json({
        storyId,
        totalEstimated: story.totalEstimatedCost,
        totalActual: story.totalActualCost,
        breakdown: costResult.rows,
      });
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId/cost-breakdown', storyId });
      res.status(500).json({ error: 'Failed to get cost breakdown' });
    }
  }
);

// ============================================
// Cost Attribution
// ============================================

/**
 * GET /stories/:storyId/cost-attribution - Get per-shot cost attribution
 */
router.get(
  '/:storyId/cost-attribution',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const result = await query(
        `SELECT cr.*, s.order_index as shot_order, s.visual_description
         FROM cost_records cr
         LEFT JOIN shots s ON cr.shot_id = s.id
         WHERE cr.story_id = $1
         ORDER BY s.order_index, cr.timestamp`,
        [storyId]
      );
      res.json({
        storyId,
        records: result.rows,
      });
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId/cost-attribution', storyId });
      res.status(500).json({ error: 'Failed to get cost attribution' });
    }
  }
);

// ============================================
// Admission Pipeline Status
// ============================================

/**
 * GET /stories/:storyId/admission-pipeline - Get admission pipeline status for all shots
 */
router.get(
  '/:storyId/admission-pipeline',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const result = await query(
        `SELECT * FROM admission_audit
         WHERE story_id = $1
         ORDER BY timestamp DESC
         LIMIT 100`,
        [storyId]
      );
      res.json({
        storyId,
        admissions: result.rows,
      });
    } catch (error) {
      logError(error, { endpoint: 'GET /stories/:storyId/admission-pipeline', storyId });
      res.status(500).json({ error: 'Failed to get admission pipeline' });
    }
  }
);

// ============================================
// Delete Character
// ============================================

/**
 * DELETE /stories/:storyId/characters/:characterId - Delete a character reference
 */
router.delete(
  '/:storyId/characters/:characterId',
  [param('storyId').isUUID(), param('characterId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId, characterId } = req.params;
    try {
      const result = await query(
        `DELETE FROM characters WHERE id = $1 AND story_id = $2 RETURNING id`,
        [characterId, storyId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Character not found' });
      }
      res.json({ success: true, characterId });
    } catch (error) {
      logError(error, { endpoint: 'DELETE /stories/:storyId/characters/:characterId', storyId, characterId });
      res.status(500).json({ error: 'Failed to delete character' });
    }
  }
);

export default router;