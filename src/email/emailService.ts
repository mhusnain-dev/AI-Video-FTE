import nodemailer from 'nodemailer';
import { config } from '../shared/config.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.smtp?.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }
  return transporter;
}

export async function sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
  try {
    const t = getTransporter();
    if (!t) {
      console.error('SMTP not configured, cannot send password reset email');
      return;
    }
    const frontendUrl = config.frontendUrl || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
    await t.sendMail({
      from: config.smtp?.fromEmail,
      to,
      subject: 'Password Reset Request',
      html: `
        <h1>Password Reset</h1>
        <p>You requested a password reset. Click the link below to reset your password:</p>
        <p><a href="${resetLink}">Reset Password</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not request this, please ignore this email.</p>
      `,
    });
  } catch (error) {
    console.error('Failed to send password reset email:', error);
  }
}

export async function sendApprovalEmail(to: string): Promise<void> {
  try {
    const t = getTransporter();
    if (!t) {
      console.error('SMTP not configured, cannot send approval email');
      return;
    }
    await t.sendMail({
      from: config.smtp?.fromEmail,
      to,
      subject: 'Your Account Has Been Approved',
      html: `
        <h1>Account Approved</h1>
        <p>Your account has been approved by an administrator.</p>
        <p>You can now log in and start using the platform.</p>
      `,
    });
  } catch (error) {
    console.error('Failed to send approval email:', error);
  }
}

export async function sendAccessExpiredEmail(to: string): Promise<void> {
  try {
    const t = getTransporter();
    if (!t) {
      console.error('SMTP not configured, cannot send access expired email');
      return;
    }
    await t.sendMail({
      from: config.smtp?.fromEmail,
      to,
      subject: 'Your Access Has Expired',
      html: `
        <h1>Access Expired</h1>
        <p>Your account access has expired.</p>
        <p>Please contact an administrator to regain access.</p>
      `,
    });
  } catch (error) {
    console.error('Failed to send access expired email:', error);
  }
}

export async function sendAccessRevokedEmail(to: string): Promise<void> {
  try {
    const t = getTransporter();
    if (!t) {
      console.error('SMTP not configured, cannot send access revoked email');
      return;
    }
    await t.sendMail({
      from: config.smtp?.fromEmail,
      to,
      subject: 'Your Access Has Been Revoked',
      html: `
        <h1>Access Revoked</h1>
        <p>Your account access has been revoked by an administrator.</p>
        <p>Please contact an administrator if you believe this is an error.</p>
      `,
    });
  } catch (error) {
    console.error('Failed to send access revoked email:', error);
  }
}
