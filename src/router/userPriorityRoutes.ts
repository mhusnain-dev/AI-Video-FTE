/**
 * User Model Priority API Routes (/api/users/.../model-priority)
 * Compatibility layer for frontend contract (PATCH + useSystemDefault)
 * Delegates to existing modelRegistry business logic
 */

import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { getUserModelPriority, setUserModelPriority, getSystemDefaultPriority, initializeModelRegistryTable } from './modelRegistry.js';
import { query } from '../shared/db.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

let initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await initializeModelRegistryTable();
    initialized = true;
  }
}

/**
 * GET /users/:userId/model-priority
 * Returns user's configured priority or system default
 * Frontend expects: { priority: ModelPriorityConfig|SystemDefaultModelPriority, isDefault: boolean }
 */
router.get(
  '/users/:userId/model-priority',
  [param('userId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const priority = await getUserModelPriority(req.params.userId as string);
      if (!priority) {
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
 * PATCH /users/:userId/model-priority
 * Frontend compatibility: accepts { priorityList, useSystemDefault }
 * - useSystemDefault=true: clears user config, returns system default
 * - useSystemDefault=false: sets explicit priorityList (required)
 * Frontend expects: { priority: ModelPriorityConfig|SystemDefaultModelPriority, isDefault: boolean }
 */
router.patch(
  '/users/:userId/model-priority',
  [
    param('userId').isUUID(),
    body('priorityList').optional().isArray({ min: 1 }),
    body('priorityList.*').isString(),
    body('useSystemDefault').optional().isBoolean(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      await ensureInitialized();
      const { priorityList, useSystemDefault } = req.body;

      // CL-006: useSystemDefault=true means user wants system default (no custom config)
      if (useSystemDefault === true) {
        await query(`DELETE FROM user_model_priorities WHERE user_id = $1`, [req.params.userId]);
        const sysDefault = await getSystemDefaultPriority();
        return res.json({ priority: sysDefault, isDefault: true });
      }

      // Otherwise require priorityList to set explicit user priority
      if (!priorityList || !Array.isArray(priorityList) || priorityList.length === 0) {
        return res.status(400).json({ error: 'priorityList is required when useSystemDefault is false' });
      }

      const priority = await setUserModelPriority(req.params.userId as string, priorityList);
      res.json({ priority, isDefault: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('Invalid model ID')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: 'Failed to set user priority' });
    }
  }
);

export default router;