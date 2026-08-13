/**
 * Dispatch API Routes
 * Webhook endpoints for receiving completion notifications from model providers
 */

import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { handleWebhook, getWebhookStats } from './webhookHandler.js';
import type { WebhookPayload } from '../shared/types.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /webhook/:provider - Receive completion webhook from model provider
 * Implements FR-018, EC-007, EC-008
 *
 * Expected payload (WebhookPayload):
 * {
 *   provider: string,
 *   requestId: string,
 *   status: 'completed' | 'failed',
 *   result?: GenerationResult,
 *   error?: string,
 *   timestamp: Date,
 *   signature: string (HMAC for idempotency)
 * }
 */
router.post(
  '/:provider',
  [
    param('provider').isIn(['google', 'runway', 'luma', 'pika', 'kling']).withMessage('Invalid provider'),
    body('provider').isString(),
    body('requestId').isString().notEmpty(),
    body('status').isIn(['completed', 'failed']),
    body('result').optional().isObject(),
    body('error').optional().isString(),
    body('timestamp').isISO8601(),
    body('signature').isString().notEmpty(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const provider = req.params.provider as string;
      const payload: WebhookPayload = req.body;

      // Convert timestamp string to Date object
      if (typeof payload.timestamp === 'string') {
        payload.timestamp = new Date(payload.timestamp);
      }

      const result = await handleWebhook(provider, payload);

      // Always return 200 to prevent provider retries (idempotency)
      // The response body contains processing result for observability
      res.json({
        success: result.success,
        status: result.status,
        shotId: result.shotId,
        message: result.error,
      });
    } catch (error) {
      console.error('Webhook handler error:', error);
      // Still return 200 to prevent retries, but log the error
      res.json({
        success: false,
        status: 'error',
        error: error instanceof Error ? error.message : 'Internal webhook error',
      });
    }
  }
);

/**
 * GET /webhook/stats - Get webhook processing statistics
 */
router.get(
  '/stats',
  async (req: Request, res: Response) => {
    try {
      const windowMs = parseInt(req.query.windowMs as string) || 3600000; // Default 1 hour
      const stats = await getWebhookStats(windowMs);
      res.json(stats);
    } catch (error) {
      console.error('Webhook stats error:', error);
      res.status(500).json({ error: 'Failed to get webhook stats' });
    }
  }
);

/**
 * POST /webhook/test/:provider - Test webhook endpoint (skips HMAC verification)
 * For testing/development only
 */
router.post(
  '/test/:provider',
  [
    param('provider').isIn(['google', 'runway', 'luma', 'pika', 'kling']).withMessage('Invalid provider'),
    body('provider').isString(),
    body('requestId').isString().notEmpty(),
    body('status').isIn(['completed', 'failed']),
    body('result').optional().isObject(),
    body('error').optional().isString(),
    body('timestamp').isISO8601(),
    body('signature').optional().isString(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const provider = req.params.provider as string;
      const payload: WebhookPayload = req.body;

      if (typeof payload.timestamp === 'string') {
        payload.timestamp = new Date(payload.timestamp);
      }

      // Skip HMAC verification for test endpoint
      const result = await handleWebhook(provider, payload, { skipVerification: true });

      res.json({
        success: result.success,
        status: result.status,
        shotId: result.shotId,
        message: result.error,
        testMode: true,
      });
    } catch (error) {
      console.error('Test webhook error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Test webhook failed' });
    }
  }
);

export default router;