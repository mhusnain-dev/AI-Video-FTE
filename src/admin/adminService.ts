/**
 * Admin Service
 * Business logic for user management, approval, and audit logging
 */

import { query } from '../shared/db.js';

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  status: string;
  accessExpiresAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

/**
 * List all users with optional status filter
 */
export async function listUsers(status?: string): Promise<AdminUser[]> {
  let sql = 'SELECT id, email, role, status, access_expires_at, approved_by, approved_at, created_at FROM users';
  const params: string[] = [];
  if (status) {
    sql += ' WHERE status = $1';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const result = await query<{ id: string; email: string; role: string; status: string; access_expires_at: Date | null; approved_by: string | null; approved_at: Date | null; created_at: Date }>(sql, params);
  return result.rows.map(row => ({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    accessExpiresAt: row.access_expires_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  }));
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<AdminUser | null> {
  const result = await query<{ id: string; email: string; role: string; status: string; access_expires_at: Date | null; approved_by: string | null; approved_at: Date | null; created_at: Date }>(
    'SELECT id, email, role, status, access_expires_at, approved_by, approved_at, created_at FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    accessExpiresAt: row.access_expires_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

/**
 * Approve a user with access duration
 */
export async function approveUser(adminId: string, userId: string, durationHours: number): Promise<void> {
  await query(
    `UPDATE users SET 
      status = 'approved', 
      access_expires_at = NOW() + INTERVAL '1 hour' * $1, 
      approved_by = $2, 
      approved_at = NOW() 
    WHERE id = $3`,
    [durationHours, adminId, userId]
  );
  await logAudit(adminId, 'approve', userId, { durationHours });
}

/**
 * Reject a user (delete account)
 */
export async function rejectUser(adminId: string, userId: string): Promise<void> {
  const user = await getUserById(userId);
  await query('DELETE FROM users WHERE id = $1', [userId]);
  await logAudit(adminId, 'reject', userId, { email: user?.email });
}

/**
 * Revoke a user's access
 */
export async function revokeAccess(adminId: string, userId: string): Promise<void> {
  await query(
    "UPDATE users SET status = 'revoked', access_expires_at = NULL WHERE id = $1",
    [userId]
  );
  await logAudit(adminId, 'revoke', userId, {});
}

/**
 * Extend a user's access
 */
export async function extendAccess(adminId: string, userId: string, durationHours: number): Promise<void> {
  await query(
    `UPDATE users SET access_expires_at = NOW() + INTERVAL '1 hour' * $1 WHERE id = $2`,
    [durationHours, userId]
  );
  await logAudit(adminId, 'extend', userId, { durationHours });
}

/**
 * Delete a user
 */
export async function deleteUser(adminId: string, userId: string): Promise<void> {
  const user = await getUserById(userId);
  await query('DELETE FROM users WHERE id = $1', [userId]);
  await logAudit(adminId, 'delete', userId, { email: user?.email });
}

/**
 * Get audit log with pagination
 */
export async function getAuditLog(limit: number = 50, offset: number = 0): Promise<AuditLogEntry[]> {
  const result = await query<{ id: string; admin_id: string; admin_email: string; action: string; target_user_id: string | null; target_email: string | null; details: Record<string, unknown>; created_at: Date }>(
    `SELECT a.id, a.admin_id, u1.email as admin_email, a.action, a.target_user_id, u2.email as target_email, a.details, a.created_at
     FROM admin_audit_log a
     LEFT JOIN users u1 ON a.admin_id = u1.id
     LEFT JOIN users u2 ON a.target_user_id = u2.id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows.map(row => ({
    id: row.id,
    adminId: row.admin_id,
    adminEmail: row.admin_email,
    action: row.action,
    targetUserId: row.target_user_id,
    targetEmail: row.target_email,
    details: row.details,
    createdAt: row.created_at,
  }));
}

/**
 * Log an admin action to the audit trail
 */
async function logAudit(adminId: string, action: string, targetUserId: string, details: Record<string, unknown>): Promise<void> {
  await query(
    'INSERT INTO admin_audit_log (admin_id, action, target_user_id, details) VALUES ($1, $2, $3, $4)',
    [adminId, action, targetUserId, JSON.stringify(details)]
  );
}
