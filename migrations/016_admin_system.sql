-- Phase M: Admin Account Management System
-- Adds role-based access control, user approval flow, password reset, and audit logging

-- 1. Extend users table with admin/approval fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- Indexes for admin queries
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_access_expires ON users (access_expires_at) WHERE access_expires_at IS NOT NULL;

-- 2. Password reset tokens table
CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets (expires_at);

-- 3. Admin audit log table
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  target_user_id UUID REFERENCES users(id),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log (target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at);
