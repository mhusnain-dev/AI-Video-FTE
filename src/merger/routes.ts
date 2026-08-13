/**
 * Merger API Routes
 * REST endpoints for video merging, delivery, and partial regeneration
 */

import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { mergeStoryShots, generateDeliveryPackage, partialRegenerate, MergeOptions } from './merger.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /merge - Merge shots for a story (FR-027, FR-028, FR-029, AC-025)
 */
router.post(
  '/merge',
  [
    body('storyId').isUUID(),
    body('resolution').optional().isIn(['720p', '1080p', '4K']),
    body('format').optional().isIn(['mp4']),
    body('transition').optional().isObject(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { storyId, resolution, format, transition } = req.body;
      const options: MergeOptions = {};
      if (resolution) options.resolution = resolution;
      if (transition) options.transition = transition;
      const result = await mergeStoryShots(storyId, options);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('not approved')) {
        return res.status(400).json({ error: message });
      }
      console.error('Merge story shots error:', error);
      res.status(500).json({ error: 'Failed to merge story shots' });
    }
  }
);

/**
 * POST /delivery - Generate delivery package (FR-030, AC-025)
 */
router.post(
  '/delivery',
  [
    body('storyId').isUUID(),
    body('resolution').optional().isIn(['720p', '1080p', '4K']),
    body('format').optional().isIn(['mp4']),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { storyId } = req.body;
      const result = await generateDeliveryPackage(storyId);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('not merged')) {
        return res.status(400).json({ error: message });
      }
      console.error('Generate delivery package error:', error);
      res.status(500).json({ error: 'Failed to generate delivery package' });
    }
  }
);

/**
 * POST /partial-regenerate - Partially regenerate specific shots (FR-031, AC-026)
 */
router.post(
  '/partial-regenerate',
  [
    body('storyId').isUUID(),
    body('shotIds').isArray({ min: 1 }),
    body('shotIds.*').isUUID(),
    body('userId').isUUID(),
    body('resolution').optional().isIn(['720p', '1080p', '4K']),
    body('format').optional().isIn(['mp4']),
    body('transition').optional().isObject(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { storyId, shotIds, userId, ...options } = req.body;
      const mergeOptions: MergeOptions = {};
      if (options.resolution) mergeOptions.resolution = options.resolution;
      if (options.transition) mergeOptions.transition = options.transition;
      const result = await partialRegenerate(storyId, shotIds, mergeOptions);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('not found') || message.includes('invalid') || message.includes('not completed')) {
        return res.status(400).json({ error: message });
      }
      console.error('Partial regenerate error:', error);
      res.status(500).json({ error: 'Failed to partially regenerate' });
    }
  }
);

/**
 * GET /delivery/:deliveryId - Get delivery package info
 */
router.get(
  '/delivery/:deliveryId',
  [param('deliveryId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    try {
      // This would query the delivery_packages table
      const { query } = await import('../shared/db.js');
      const result = await query(
        `SELECT * FROM delivery_packages WHERE id = $1`,
        [req.params.deliveryId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Delivery package not found' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Get delivery package error:', error);
      res.status(500).json({ error: 'Failed to get delivery package' });
    }
  }
);

export default router;