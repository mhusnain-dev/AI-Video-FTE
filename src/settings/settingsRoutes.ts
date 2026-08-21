/**
 * User Settings API Routes
 * GET /api/settings, PUT /api/settings
 */

import type { Request, Response } from 'express';
import express from 'express';
import { body, validationResult } from 'express-validator';
import { query } from '../shared/db.js';
import type { UserSettingsData } from '../shared/types.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * GET /api/settings — Return current user's settings
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.user?.id || (req.query.userId as string);
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  try {
    const result = await query<{ settings: UserSettingsData; updated_at: Date }>(
      'SELECT settings, updated_at FROM user_settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        userId,
        settings: {},
        updatedAt: null,
      });
    }

    res.json({
      userId,
      settings: result.rows[0].settings,
      updatedAt: result.rows[0].updated_at,
    });
  } catch (error) {
    console.error('Failed to get user settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * PUT /api/settings — Upsert user settings
 */
router.put(
  '/',
  [
    body('settings').isObject().withMessage('Settings object required'),
  ],
  validate,
  async (req: Request, res: Response) => {
    const userId = req.user?.id || req.body.userId;
    const { settings } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    try {
      await query(
        `INSERT INTO user_settings (user_id, settings, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET settings = user_settings.settings || $2,
             updated_at = NOW()`,
        [userId, JSON.stringify(settings)]
      );

      const result = await query<{ settings: UserSettingsData; updated_at: Date }>(
        'SELECT settings, updated_at FROM user_settings WHERE user_id = $1',
        [userId]
      );

      res.json({
        userId,
        settings: result.rows[0].settings,
        updatedAt: result.rows[0].updated_at,
      });
    } catch (error) {
      console.error('Failed to update user settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }
);

export default router;
