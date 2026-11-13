import os from 'node:os';
import { renderSaved } from './emailTemplateService.js';

// Outgoing email over SMTP (used for customer/user welcome emails). Configure in server/.env:
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL
// Nothing here is required to run the app - if SMTP isn't configured, features that email
// simply report "not configured" and the rest of the app works as before.

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

let cached = null;
async function transporter() {
  if (cached) return cached;
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new Error('The "nodemailer" package is not installed. Run "npm install" in the server folder.');
  }
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    name: os.hostname()
  });
  return cached;
}

export function appUrl() {
  return (process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

export async function sendMail({ to, subject, text, html }) {
  if (!emailConfigured()) throw new Error('Email is not configured. Set SMTP_HOST and SMTP_FROM (and the other SMTP_* values) in server/.env, then restart the server.');
  const t = await transporter();
  return t.sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
}

const roleLabelOf = (role) => (role === 'customerAdmin' ? 'an administrator' : role === 'admin' ? 'an agency administrator' : 'a team member');

/** Render a saved (or default) email template and send it. */
export async function sendTemplated(key, to, vars) {
  const { subject, html, text } = await renderSaved(key, { loginUrl: appUrl(), ...vars });
  return sendMail({ to, subject, text, html });
}

/** Welcome email with login details for a new user. */
export async function sendWelcomeEmail({ to, name, customerName, role, password }) {
  return sendTemplated('welcome', to, { name, email: to, customerName, roleLabel: roleLabelOf(role), password });
}

export async function sendPasswordResetEmail({ to, name, resetUrl, expiresIn = '60 minutes' }) {
  return sendTemplated('passwordReset', to, { name, email: to, resetUrl, expiresIn });
}

export async function sendPasswordChangedEmail({ to, name }) {
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST';
  return sendTemplated('passwordChanged', to, { name, email: to, when });
}
