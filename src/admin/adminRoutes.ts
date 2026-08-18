/**
 * Admin Routes
 * GET /admin/users, POST /admin/approve/:id, POST /admin/reject/:id,
 * POST /admin/revoke/:id, POST /admin/extend/:id, DELETE /admin/users/:id, GET /admin/audit
 */

import express, { Request, Response } from 'express';
import { body, param, query as queryValidator, validationResult } from 'express-validator';
import * as adminService from './adminService.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// GET /admin/users — List all users (optional ?status=pending|approved|revoked)
router.get('/users',
  [queryValidator('status').optional().isIn(['pending', 'approved', 'revoked', 'expired'])],
  validate,
  async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const users = await adminService.listUsers(status);
      res.json({ data: { users } });
    } catch (error) {
      console.error('List users error:', error);
      res.status(500).json({ error: 'Failed to list users' });
    }
  }
);

// POST /admin/approve/:id — Approve user with duration
router.post('/approve/:id',
  [param('id').isUUID(), body('durationHours').isInt({ min: 1, max: 8760 })],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { durationHours } = req.body;
      const userId = req.params.id as string;
      await adminService.approveUser(req.user!.id, userId, durationHours);
      res.json({ data: { success: true, message: `User approved for ${durationHours} hours` } });
    } catch (error) {
      console.error('Approve user error:', error);
      res.status(500).json({ error: 'Failed to approve user' });
    }
  }
);

// POST /admin/reject/:id — Reject (delete) user
router.post('/reject/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      await adminService.rejectUser(req.user!.id, userId);
      res.json({ data: { success: true, message: 'User rejected and removed' } });
    } catch (error) {
      console.error('Reject user error:', error);
      res.status(500).json({ error: 'Failed to reject user' });
    }
  }
);

// POST /admin/revoke/:id — Revoke user access
router.post('/revoke/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      await adminService.revokeAccess(req.user!.id, userId);
      res.json({ data: { success: true, message: 'User access revoked' } });
    } catch (error) {
      console.error('Revoke access error:', error);
      res.status(500).json({ error: 'Failed to revoke access' });
    }
  }
);

// POST /admin/extend/:id — Extend user access
router.post('/extend/:id',
  [param('id').isUUID(), body('durationHours').isInt({ min: 1, max: 8760 })],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { durationHours } = req.body;
      const userId = req.params.id as string;
      await adminService.extendAccess(req.user!.id, userId, durationHours);
      res.json({ data: { success: true, message: `Access extended by ${durationHours} hours` } });
    } catch (error) {
      console.error('Extend access error:', error);
      res.status(500).json({ error: 'Failed to extend access' });
    }
  }
);

// DELETE /admin/users/:id — Delete user
router.delete('/users/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      await adminService.deleteUser(req.user!.id, userId);
      res.json({ data: { success: true, message: 'User deleted' } });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

// GET /admin/audit — Get audit log
router.get('/audit',
  [queryValidator('limit').optional().isInt({ min: 1, max: 200 }), queryValidator('offset').optional().isInt({ min: 0 })],
  validate,
  async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const auditLog = await adminService.getAuditLog(limit, offset);
      res.json({ data: { auditLog } });
    } catch (error) {
      console.error('Get audit log error:', error);
      res.status(500).json({ error: 'Failed to get audit log' });
    }
  }
);

export default router;
