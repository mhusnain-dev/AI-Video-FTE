/**
 * User Feedback API Routes
 * POST /api/stories/:id/feedback, GET /api/stories/:id/feedback
 */

import type { Request, Response } from 'express';
import express from 'express';
import { param, body, validationResult } from 'express-validator';
import { query } from '../shared/db.js';
import type { UserFeedback } from '../shared/types.js';

const router = express.Router({ mergeParams: true });

const validate = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /api/stories/:id/feedback — Submit rating + optional flag
 */
router.post(
  '/:storyId/feedback',
  [
    param('storyId').isUUID(),
    body('userId').isString().notEmpty(),
    body('rating').optional().isInt({ min: 1, max: 5 }),
    body('flagReason').optional().isString(),
    body('flagComment').optional().isString(),
    body('shotId').optional().isUUID(),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    const { userId, rating, flagReason, flagComment, shotId } = req.body;
    try {
      const result = await query<UserFeedback>(
        `INSERT INTO user_feedback (user_id, story_id, shot_id, rating, flag_reason, flag_comment)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, user_id, story_id, shot_id, rating, flag_reason, flag_comment, created_at`,
        [userId, storyId, shotId || null, rating || null, flagReason || null, flagComment || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      res.status(500).json({ error: 'Failed to submit feedback' });
    }
  }
);

/**
 * GET /api/stories/:id/feedback — Get all feedback for a story
 */
router.get(
  '/:storyId/feedback',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    try {
      const result = await query<UserFeedback>(
        `SELECT id, user_id, story_id, shot_id, rating, flag_reason, flag_comment, created_at
         FROM user_feedback
         WHERE story_id = $1
         ORDER BY created_at DESC`,
        [storyId]
      );

      res.json({
        storyId,
        feedback: result.rows,
        summary: {
          totalReviews: result.rows.length,
          averageRating: result.rows.length > 0
            ? result.rows.reduce((sum, r) => sum + (r.rating || 0), 0) / result.rows.filter(r => r.rating).length
            : null,
          totalFlags: result.rows.filter(r => r.flagReason).length,
        },
      });
    } catch (error) {
      console.error('Failed to get feedback:', error);
      res.status(500).json({ error: 'Failed to get feedback' });
    }
  }
);

export default router;
