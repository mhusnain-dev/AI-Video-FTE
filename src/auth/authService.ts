/**
 * Authentication Service
 * bcrypt password hashing, JWT token generation/verification
 * Implements CL-038: 24-hour expiry, no refresh token
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../shared/config.js';
import { query } from '../shared/db.js';

const BCRYPT_ROUNDS = 12;

export interface AuthUser {
  id: string;
  email: string;
  createdAt: Date;
  role: string;
  status: string;
  accessExpiresAt: Date | null;
}

export interface AuthTokens {
  token: string;
  user: AuthUser;
}

/**
 * Register a new user
 * Validates email format, hashes password, inserts user, returns JWT
 */
export async function registerUser(email: string, password: string): Promise<AuthTokens> {
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  // Validate password strength
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  // Check if user already exists
  const existing = await query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  if (existing.rows.length > 0) {
    throw new Error('Email already registered');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Determine role and status based on admin email
  const isAdmin = config.adminEmail && email.toLowerCase() === config.adminEmail.toLowerCase();
  const role = isAdmin ? 'admin' : 'user';
  const status = isAdmin ? 'approved' : 'pending';

  // Insert user
  const result = await query<{ id: string; email: string; created_at: Date }>(
    `INSERT INTO users (email, password_hash, role, status) VALUES ($1, $2, $3, $4) RETURNING id, email, created_at`,
    [email.toLowerCase(), passwordHash, role, status]
  );

  const user = result.rows[0];
  const token = generateToken(user.id, user.email);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      role,
      status,
      accessExpiresAt: null,
    },
  };
}

/**
 * Login existing user
 * Finds user by email, compares password, returns JWT
 */
export async function loginUser(email: string, password: string): Promise<AuthTokens & { pending?: boolean; expired?: boolean }> {
  const result = await query<{ id: string; email: string; password_hash: string; created_at: Date; role: string; status: string; access_expires_at: Date | null }>(
    'SELECT id, email, password_hash, created_at, role, status, access_expires_at FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid email or password');
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password_hash);

  if (!validPassword) {
    throw new Error('Invalid email or password');
  }

  const token = generateToken(user.id, user.email);

  // Pending approval
  if (user.status === 'pending') {
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        role: user.role,
        status: user.status,
        accessExpiresAt: user.access_expires_at,
      },
      pending: true,
    };
  }

  // Approved but access expired
  if (user.status === 'approved' && user.access_expires_at && new Date(user.access_expires_at) < new Date()) {
    await query('UPDATE users SET status = $1 WHERE id = $2', ['expired', user.id]);
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        role: user.role,
        status: 'expired',
        accessExpiresAt: user.access_expires_at,
      },
      expired: true,
    };
  }

  // Revoked user
  if (user.status === 'revoked') {
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        role: user.role,
        status: user.status,
        accessExpiresAt: null,
      },
      revoked: true,
    };
  }

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      role: user.role,
      status: user.status,
      accessExpiresAt: user.access_expires_at,
    },
  };
}

/**
 * Verify JWT and return user info
 */
export async function verifyTokenAndGetUser(token: string): Promise<AuthUser> {
  const secret = config.jwtSecret || process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
  const decoded = jwt.verify(token, secret) as { userId: string; email: string };

  const result = await query<{ id: string; email: string; created_at: Date; role: string; status: string; access_expires_at: Date | null }>(
    'SELECT id, email, created_at, role, status, access_expires_at FROM users WHERE id = $1',
    [decoded.userId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  const user = result.rows[0];
  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
    role: user.role,
    status: user.status,
    accessExpiresAt: user.access_expires_at,
  };
}

/**
 * Generate JWT token with 24-hour expiry (CL-038)
 */
function generateToken(userId: string, email: string): string {
  const secret = config.jwtSecret || process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
  const expiryHours = config.jwtExpiryHours || 24;

  return jwt.sign(
    { userId, email },
    secret,
    { expiresIn: `${expiryHours}h` }
  );
}

/**
 * Request a password reset — generates a token and stores a hashed version
 */
export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  // Find user by email
  const result = await query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    return { message: 'If the email exists, a reset link has been sent' };
  }

  const userId = result.rows[0].id;

  // Generate random token
  const rawToken = crypto.randomBytes(32).toString('hex');
  // Hash the token for storage
  const hashedToken = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);

  // Insert into password_resets table with 1-hour expiry
  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [userId, hashedToken]
  );

  // TODO: Send email with rawToken link (frontendUrl + token)
  // For now, the raw token would be included in the reset URL sent to the user

  return { message: 'If the email exists, a reset link has been sent' };
}

/**
 * Reset password using a valid token
 */
export async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  // Find all non-used, non-expired password_resets
  const result = await query<{ id: string; user_id: string; token_hash: string }>(
    `SELECT id, user_id, token_hash FROM password_resets WHERE used = false AND expires_at > NOW()`,
    []
  );

  for (const row of result.rows) {
    const match = await bcrypt.compare(token, row.token_hash);
    if (match) {
      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      // Update user's password_hash
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);

      // Mark token as used
      await query('UPDATE password_resets SET used = true WHERE id = $1', [row.id]);

      return { message: 'Password has been reset' };
    }
  }

  throw new Error('Invalid or expired reset token');
}

/**
 * Approve a pending user (admin only)
 */
export async function approveUser(adminId: string, userId: string, durationHours: number): Promise<void> {
  await query(
    `UPDATE users SET status = 'approved', access_expires_at = NOW() + ($1 || ' hours')::INTERVAL, approved_by = $2, approved_at = NOW() WHERE id = $3`,
    [durationHours.toString(), adminId, userId]
  );

  await query(
    `INSERT INTO admin_audit_log (action, admin_id, target_user_id, details) VALUES ('approve', $1, $2, $3)`,
    [adminId, userId, JSON.stringify({ durationHours })]
  );
}

/**
 * Reject a pending user — deletes the user record (admin only)
 */
export async function rejectUser(adminId: string, userId: string): Promise<void> {
  await query('DELETE FROM users WHERE id = $1', [userId]);

  await query(
    `INSERT INTO admin_audit_log (action, admin_id, target_user_id) VALUES ('reject', $1, $2)`,
    [adminId, userId]
  );
}

/**
 * Revoke an approved user's access (admin only)
 */
export async function revokeAccess(adminId: string, userId: string): Promise<void> {
  await query(
    `UPDATE users SET status = 'revoked', access_expires_at = NULL WHERE id = $1`,
    [userId]
  );

  await query(
    `INSERT INTO admin_audit_log (action, admin_id, target_user_id) VALUES ('revoke', $1, $2)`,
    [adminId, userId]
  );
}

/**
 * Extend an approved user's access duration (admin only)
 */
export async function extendAccess(adminId: string, userId: string, durationHours: number): Promise<void> {
  await query(
    `UPDATE users SET access_expires_at = NOW() + ($1 || ' hours')::INTERVAL WHERE id = $2`,
    [durationHours.toString(), userId]
  );

  await query(
    `INSERT INTO admin_audit_log (action, admin_id, target_user_id, details) VALUES ('extend', $1, $2, $3)`,
    [adminId, userId, JSON.stringify({ durationHours })]
  );
}
