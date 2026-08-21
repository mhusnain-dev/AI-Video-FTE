/**
 * User Preferences API Routes
 * GET /api/users/:userId/preferences, PUT /api/users/:userId/preferences, DELETE /api/users/:userId/preferences
 */

import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import { param, body, validationResult } from 'express-validator';
import { query } from '../shared/db.js';
import type { UserPreferenceData } from '../shared/types.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * GET /api/users/:userId/preferences
 * Returns user's learned preferences
 * Supports both JWT auth and userId query param (for frontend compatibility)
 */
router.get(
  '/users/:userId/preferences',
  [param('userId').isString().notEmpty()],
  validate,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || (req.query.userId as string) || req.params.userId;
      if (!userId) {
        return res.status(400).json({ error: 'userId required' });
      }

      const result = await query<{ preferences: UserPreferenceData }>(
        'SELECT preferences FROM user_preferences WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        return res.json({
          userId,
          preferences: {},
          updatedAt: null,
        });
      }

      res.json({
        userId,
        preferences: result.rows[0].preferences,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to get user preferences:', error);
      res.status(500).json({ error: 'Failed to get preferences' });
    }
  }
);

/**
 * PUT /api/users/:userId/preferences
 * Upsert user preferences (merge with existing)
 * Supports both JWT auth and userId in body/query
 */
router.put(
  '/users/:userId/preferences',
  [
    param('userId').isString().notEmpty(),
    body('preferences').isObject().withMessage('Preferences object required'),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || req.body.userId || (req.query.userId as string) || req.params.userId;
      const { preferences } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'userId required' });
      }

      await query(
        `INSERT INTO user_preferences (user_id, preferences, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET preferences = user_preferences.preferences || $2,
             updated_at = NOW()`,
        [userId, JSON.stringify(preferences)]
      );

      const result = await query<{ preferences: UserPreferenceData }>(
        'SELECT preferences FROM user_preferences WHERE user_id = $1',
        [userId]
      );

      res.json({
        userId,
        preferences: result.rows[0].preferences,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to update user preferences:', error);
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  }
);

/**
 * DELETE /api/users/:userId/preferences
 * Delete user's preferences
 */
router.delete(
  '/users/:userId/preferences',
  [param('userId').isString().notEmpty()],
  validate,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || (req.query.userId as string) || req.params.userId;
      if (!userId) {
        return res.status(400).json({ error: 'userId required' });
      }

      await query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);

      res.json({ success: true, userId, message: 'Preferences deleted' });
    } catch (error) {
      console.error('Failed to delete user preferences:', error);
      res.status(500).json({ error: 'Failed to delete preferences' });
    }
  }
);

export default router;