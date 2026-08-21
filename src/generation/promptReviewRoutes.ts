/**
 * Prompt Review API Routes
 * POST /api/stories/:id/prompt-review — returns compiled+sanitized prompt for review
 * PUT /api/stories/:id/prompt-review — accepts user-edited prompt, saves it, proceeds
 */

import type { Request, Response } from 'express';
import express from 'express';
import { param, body, validationResult } from 'express-validator';
import { query } from '../shared/db.js';
import { compilePrompt } from './promptCompiler.js';
import { sanitizePrompt } from '../sanitizer/promptSanitizer.js';
import type { ModelConstraints } from '../shared/types.js';

const router = express.Router({ mergeParams: true });

const validate = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /api/stories/:id/prompt-review — Returns compiled+sanitized prompt for user review
 */
router.post(
  '/:storyId/prompt-review',
  [
    param('storyId').isUUID(),
    body('shotId').isUUID().withMessage('shotId required'),
    body('userId').isString().notEmpty(),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    const { shotId, userId } = req.body;
    try {
      // Get shot data
      const shotResult = await query(
        'SELECT * FROM shots WHERE id = $1 AND story_id = $2',
        [shotId, storyId]
      );
      if (shotResult.rows.length === 0) {
        return res.status(404).json({ error: 'Shot not found' });
      }

      // Get characters
      const charResult = await query(
        'SELECT * FROM characters WHERE story_id = $1',
        [storyId]
      );

      // Get model
      const modelId = shotResult.rows[0].selected_model_id || 'kie-veo3-fast';
      const modelResult = await query(
        'SELECT * FROM models WHERE id = $1',
        [modelId]
      );

      if (modelResult.rows.length === 0) {
        return res.status(400).json({ error: 'Model not found' });
      }

      // Compile prompt
      const compiled = await compilePrompt(
        shotResult.rows[0],
        charResult.rows,
        modelResult.rows[0],
        { maxPromptLength: 4000 }
      );

      // Sanitize prompt
      const modelConstraints: ModelConstraints = {
        modelId,
        maxLength: 4000,
      };
      const sanitized = sanitizePrompt(compiled.prompt, modelConstraints);

      res.json({
        storyId,
        shotId,
        compiled: {
          prompt: compiled.prompt,
          negativePrompt: compiled.negativePrompt,
          parameters: compiled.parameters,
          characterConditioning: compiled.characterConditioning,
        },
        sanitized: {
          prompt: sanitized.sanitized,
          piiFound: sanitized.piiFound,
          injectionsFound: sanitized.injectionsFound,
          warnings: sanitized.warnings,
        },
      });
    } catch (error) {
      console.error('Failed to get prompt review:', error);
      res.status(500).json({ error: 'Failed to get prompt review' });
    }
  }
);

/**
 * PUT /api/stories/:id/prompt-review — Accepts user-edited prompt, saves it, proceeds to dispatch
 */
router.put(
  '/:storyId/prompt-review',
  [
    param('storyId').isUUID(),
    body('shotId').isUUID().withMessage('shotId required'),
    body('userId').isString().notEmpty(),
    body('editedPrompt').isString().notEmpty().withMessage('editedPrompt required'),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    const { shotId, userId, editedPrompt } = req.body;
    try {
      // Get shot
      const shotResult = await query(
        'SELECT * FROM shots WHERE id = $1 AND story_id = $2',
        [shotId, storyId]
      );
      if (shotResult.rows.length === 0) {
        return res.status(404).json({ error: 'Shot not found' });
      }

      // Sanitize the edited prompt
      const modelId = shotResult.rows[0].selected_model_id || 'kie-veo3-fast';
      const modelConstraints: ModelConstraints = {
        modelId,
        maxLength: 4000,
      };
      const sanitized = sanitizePrompt(editedPrompt, modelConstraints);

      // Save the sanitized prompt and update shot status
      await query(
        `UPDATE shots
         SET approved_prompt = $1,
             status = 'approved',
             updated_at = NOW()
         WHERE id = $2`,
        [sanitized.sanitized, shotId]
      );

      // Emit approval event
      const { emitShotStateChange } = await import('../shared/events.js');
      await emitShotStateChange(shotId, shotResult.rows[0].status, 'approved', 'prompt_review_approved', {
        userId,
        piiFound: sanitized.piiFound,
        injectionsFound: sanitized.injectionsFound,
      });

      res.json({
        success: true,
        storyId,
        shotId,
        status: 'approved',
        sanitized: {
          piiFound: sanitized.piiFound,
          injectionsFound: sanitized.injectionsFound,
          warnings: sanitized.warnings,
        },
      });
    } catch (error) {
      console.error('Failed to save prompt review:', error);
      res.status(500).json({ error: 'Failed to save prompt review' });
    }
  }
);

export default router;
