/**
 * Authentication Routes
 * POST /auth/register, POST /auth/login, GET /auth/me
 */

import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { registerUser, loginUser, verifyTokenAndGetUser, requestPasswordReset, resetPassword } from './authService.js';
import { authMiddleware } from './authMiddleware.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /auth/register — Register a new user
 */
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { email, password } = req.body;
    try {
      const result = await registerUser(email, password);
      res.status(201).json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      if (message.includes('already registered') || message.includes('Invalid email') || message.includes('Password must')) {
        return res.status(400).json({ error: message });
      }
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

/**
 * POST /auth/login — Login existing user
 */
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { email, password } = req.body;
    try {
      const result = await loginUser(email, password);
      res.json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      if (message.includes('Invalid email or password')) {
        return res.status(401).json({ error: message });
      }
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

/**
 * GET /auth/me — Get current user info (requires JWT)
 */
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
      const user = await verifyTokenAndGetUser(req.headers.authorization!.substring(7));
      res.json({ data: user });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

/**
 * POST /auth/forgot-password — Send password reset email
 */
router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      const result = await requestPasswordReset(email);
      res.json({ data: result });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Failed to process request' });
    }
  }
);

/**
 * POST /auth/reset-password — Reset password with token
 */
router.post(
  '/reset-password',
  [body('token').notEmpty(), body('password').isLength({ min: 8 })],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      const result = await resetPassword(token, password);
      res.json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reset failed';
      if (message.includes('Invalid or expired')) {
        return res.status(400).json({ error: message });
      }
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

export default router;
