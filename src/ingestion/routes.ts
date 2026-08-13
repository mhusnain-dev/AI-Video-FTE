/**
 * Ingestion API Routes
 * REST endpoints for story creation, plan presentation, revision, and character management
 */

import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { createStory, getStory, presentShotPlan, approveShotPlan, reviseShotPlan } from './storyService.js';
import { uploadCharacterReference, getCharacterReferences, getCharacterByName } from './characterService.js';
import type { CreateStoryRequest } from './storyService.js';
import type { CharacterReference, ShotPlanRevision } from '../shared/types.js';

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

export default router;