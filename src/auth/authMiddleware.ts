/**
 * Authentication Middleware
 * Express middleware to verify JWT on protected routes
 */

import { Request, Response, NextFunction } from 'express';
import { verifyTokenAndGetUser } from './authService.js';
import type { AuthUser } from './authService.js';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * JWT authentication middleware
 * Extracts Bearer token from Authorization header, verifies JWT, attaches user to request
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const user = await verifyTokenAndGetUser(token);
    req.user = user;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid token';
    if (message === 'User not found') {
      res.status(401).json({ error: 'User not found' });
    } else {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
}

/**
 * Admin-only middleware — must be used after authMiddleware
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if ((req.user as any).role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Access check middleware — checks user is approved and access not expired
 */
export async function accessMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const user = req.user as any;
  if (user.status === 'pending') {
    res.status(403).json({ error: 'Account pending admin approval', pending: true });
    return;
  }
  if (user.status === 'revoked' || user.status === 'expired') {
    res.status(403).json({ error: 'Access denied', reason: user.status });
    return;
  }
  if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) {
    res.status(403).json({ error: 'Access expired', expired: true });
    return;
  }
  next();
}
