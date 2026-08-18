/**
 * Project Settings API Routes
 * GET /api/projects/:projectId/settings, PATCH /api/projects/:projectId/settings
 */

import express, { Request, Response, NextFunction } from 'express';
import { param, body, validationResult } from 'express-validator';
import { query } from '../shared/db.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Default settings matching frontend Settings.tsx defaults
const DEFAULT_PROJECT_SETTINGS = {
  defaultResolution: '1080p',
  defaultAspectRatio: '16:9',
  costBudgetPerStory: null,
  sacredGuardEnabled: true,
};

/**
 * GET /api/projects/:projectId/settings
 * Returns project settings (creates defaults if not exists)
 */
router.get(
  '/projects/:projectId/settings',
  [param('projectId').isString().notEmpty()],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const result = await query<{ settings: Record<string, unknown>; updated_at: Date }>(
        'SELECT settings, updated_at FROM project_settings WHERE project_id = $1',
        [projectId]
      );

      if (result.rows.length === 0) {
        return res.json({
          projectId,
          settings: DEFAULT_PROJECT_SETTINGS,
          updatedAt: null,
        });
      }

      res.json({
        projectId,
        settings: result.rows[0].settings,
        updatedAt: result.rows[0].updated_at,
      });
    } catch (error) {
      console.error('Failed to get project settings:', error);
      res.status(500).json({ error: 'Failed to get project settings' });
    }
  }
);

/**
 * PATCH /api/projects/:projectId/settings
 * Upsert project settings (merge with existing)
 */
router.patch(
  '/projects/:projectId/settings',
  [
    param('projectId').isString().notEmpty(),
    body('settings').isObject().withMessage('Settings object required'),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { settings } = req.body;

      await query(
        `INSERT INTO project_settings (project_id, settings, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (project_id) DO UPDATE
         SET settings = project_settings.settings || $2,
             updated_at = NOW()`,
        [projectId, JSON.stringify(settings)]
      );

      const result = await query<{ settings: Record<string, unknown>; updated_at: Date }>(
        'SELECT settings, updated_at FROM project_settings WHERE project_id = $1',
        [projectId]
      );

      res.json({
        projectId,
        settings: result.rows[0].settings,
        updatedAt: result.rows[0].updated_at,
      });
    } catch (error) {
      console.error('Failed to update project settings:', error);
      res.status(500).json({ error: 'Failed to update project settings' });
    }
  }
);

export default router;