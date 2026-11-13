import EmailTemplate from '../models/EmailTemplate.js';

// Editable transactional emails. Each template is { subject, heading, body, buttonLabel } with
// {{variables}}; the branded HTML layout around it is fixed in code, so an edit can never break the
// email's structure. Text is always HTML-escaped (no raw HTML is accepted), with two small
// conveniences in the body:  **bold**  and a block of lines starting with "> " becomes a highlighted box.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const v = (name, description, sample) => ({ name, description, sample });
const COMMON = [v('appName', 'Product name', 'AUTOMATr'), v('loginUrl', 'Link to the sign-in page', 'https://app.example.com')];

export const TEMPLATES = {
  welcome: {
    label: 'Welcome / user onboarding',
    description: 'Sent when an admin adds a user or customer with "Send welcome email" switched on. Includes their login details.',
    actionVar: 'loginUrl',
    vars: [v('name', 'Recipient name', 'Jordan Meyers'), v('email', 'Their login email', 'jordan@northwind.com'), v('password', 'Their temporary password', 'f3a9-72bd-91ke'), v('customerName', 'Customer / workspace name', 'Northwind Studio'), v('roleLabel', 'Their role, as a phrase', 'an administrator'), ...COMMON],
    defaults: {
      subject: 'Welcome to {{appName}} - your {{customerName}} workspace is ready',
      heading: 'Welcome, {{name}}!',
      body: [
        "Your **{{customerName}}** workspace is ready, and you've been added as {{roleLabel}}.",
        '{{appName}} helps your team create on-brand ad creatives - copy, images and short videos - and get them ready to publish.',
        '> Your login details\n> Email: {{email}}\n> Password: {{password}}',
        'For your security, please change this password after you sign in (Settings).',
        "If you weren't expecting this email, you can ignore it."
      ].join('\n\n'),
      buttonLabel: 'Sign in to {{appName}}'
    }
  },
  passwordReset: {
    label: 'Forgot password / reset link',
    description: 'Sent when someone uses "Forgot password?" on the sign-in page. The button opens the reset page.',
    actionVar: 'resetUrl',
    vars: [v('name', 'Recipient name', 'Jordan Meyers'), v('email', 'Their login email', 'jordan@northwind.com'), v('resetUrl', 'One-time link to choose a new password', 'https://app.example.com/reset-password?token=example'), v('expiresIn', 'How long the link works', '60 minutes'), ...COMMON],
    defaults: {
      subject: 'Reset your {{appName}} password',
      heading: 'Reset your password',
      body: [
        'Hi {{name}},',
        'We received a request to reset the password for **{{email}}**. Use the button below to choose a new one. The link works for {{expiresIn}} and can be used once.',
        "If you didn't ask for this, you can safely ignore this email - your password won't change."
      ].join('\n\n'),
      buttonLabel: 'Choose a new password'
    }
  },
  passwordChanged: {
    label: 'Password changed confirmation',
    description: 'Sent after a password has been reset, so the owner knows if it was not them.',
    actionVar: 'loginUrl',
    vars: [v('name', 'Recipient name', 'Jordan Meyers'), v('email', 'Their login email', 'jordan@northwind.com'), v('when', 'When it happened', '18 Oct 2026, 4:32 pm'), ...COMMON],
    defaults: {
      subject: 'Your {{appName}} password was changed',
      heading: 'Your password was changed',
      body: [
        'Hi {{name}},',
        'The password for **{{email}}** was changed on {{when}}.',
        "If this was you, there's nothing more to do. If it wasn't, reset your password straight away and tell your admin."
      ].join('\n\n'),
      buttonLabel: 'Sign in'
    }
  },
  workspacePaused: {
    label: 'Workspace paused',
    description: 'Notice that a customer workspace has been paused or suspended.',
    actionVar: 'loginUrl',
    vars: [v('name', 'Recipient name', 'Jordan Meyers'), v('customerName', 'Customer / workspace name', 'Northwind Studio'), v('status', 'New status', 'paused'), ...COMMON],
    defaults: {
      subject: 'Your {{customerName}} workspace is {{status}}',
      heading: 'Your workspace is {{status}}',
      body: ['Hi {{name}},', 'Your **{{customerName}}** workspace on {{appName}} is now {{status}}, so signing in and generating new creatives is unavailable for now.', 'Please contact your account manager if you have questions or would like it switched back on.'].join('\n\n'),
      buttonLabel: ''
    }
  },
  workspaceReactivated: {
    label: 'Workspace reactivated',
    description: 'Notice that a customer workspace is active again.',
    actionVar: 'loginUrl',
    vars: [v('name', 'Recipient name', 'Jordan Meyers'), v('customerName', 'Customer / workspace name', 'Northwind Studio'), ...COMMON],
    defaults: {
      subject: 'Your {{customerName}} workspace is active again',
      heading: 'Welcome back!',
      body: ['Hi {{name}},', 'Your **{{customerName}}** workspace on {{appName}} is active again. You and your team can sign in and carry on creating.'].join('\n\n'),
      buttonLabel: 'Sign in to {{appName}}'
    }
  },
  limitReached: {
    label: 'Monthly limit reached',
    description: 'Notice that a customer has used its monthly image or video allowance.',
    actionVar: 'loginUrl',
    vars: [v('name', 'Recipient name', 'Jordan Meyers'), v('customerName', 'Customer / workspace name', 'Northwind Studio'), v('limitType', 'What ran out (images or videos)', 'images'), v('limit', 'The monthly allowance', '200'), v('resetDate', 'When it renews', '1 Nov 2026'), ...COMMON],
    defaults: {
      subject: '{{customerName}} has used its monthly {{limitType}} allowance',
      heading: 'Monthly allowance reached',
      body: ['Hi {{name}},', 'Your **{{customerName}}** workspace has used all {{limit}} {{limitType}} included this month. The allowance renews on **{{resetDate}}**.', 'Contact your account manager if you need more before then.'].join('\n\n'),
      buttonLabel: ''
    }
  }
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);
export const sampleVars = (key) => Object.fromEntries(TEMPLATES[key].vars.map((x) => [x.name, x.sample]));

/** The fields in force for a template: the saved edit, else the built-in default. */
export async function resolveFields(key) {
  const def = TEMPLATES[key];
  if (!def) throw new Error(`Unknown email template "${key}".`);
  const saved = await EmailTemplate.findOne({ key }).lean();
  if (!saved) return { ...def.defaults, customised: false };
  return { subject: saved.subject, heading: saved.heading, body: saved.body, buttonLabel: saved.buttonLabel || '', customised: true, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy };
}

// ---- rendering --------------------------------------------------------------------------------
function interpolate(str, vars, unknown, escape) {
  return String(str ?? '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, name) => {
    if (!(name in vars)) { unknown.add(name); return ''; }
    const val = String(vars[name] ?? '');
    return escape ? esc(val) : val;
  });
}

const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/** Renders { subject, html, text, unknown[] } for a template using `fields` (a saved/edited version) and `vars`. */
export function render(key, fields, vars) {
  const def = TEMPLATES[key];
  const unknown = new Set();
  // Substitute first (values are untrusted, so they are escaped when placed into HTML below).
  const sub = (s) => interpolate(s, vars, unknown, false);
  const subject = sub(fields.subject).replace(/[\r\n]+/g, ' ').trim();
  const heading = sub(fields.heading);
  const body = sub(fields.body);
  const buttonLabel = sub(fields.buttonLabel).trim();
  const actionUrl = vars[def.actionVar] || vars.loginUrl || '';

  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const htmlBlocks = blocks.map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => l.trim().startsWith('>'))) {
      const rows = lines.map((l) => l.replace(/^\s*>\s?/, ''));
      const [first, ...rest] = rows;
      return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#EEF3FF;border-radius:10px;margin:0 0 22px;"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.7;"><div style="font-weight:700;margin-bottom:4px;">${inline(first)}</div>${rest.map((r) => `<div>${inline(r)}</div>`).join('')}</td></tr></table>`;
    }
    return `<p style="margin:0 0 14px;line-height:1.6;">${lines.map(inline).join('<br>')}</p>`;
  });

  const button = buttonLabel && actionUrl
    ? `<p style="margin:8px 0 22px;"><a href="${esc(actionUrl)}" style="display:inline-block;background:#2E5EFF;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${esc(buttonLabel)}</a></p>`
    : '';
  const fallbackLink = buttonLabel && actionUrl
    ? `<p style="margin:0;font-size:12px;color:#5B6274;line-height:1.5;word-break:break-all;">If the button doesn't work, copy this link into your browser:<br>${esc(actionUrl)}</p>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fb;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0A0E17;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#0A0E17;color:#ffffff;padding:20px 28px;font-size:18px;font-weight:700;letter-spacing:.02em;">${esc(vars.appName || 'AUTOMATr')}</td></tr>
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 14px;font-size:21px;">${esc(heading)}</h1>
        ${htmlBlocks.join('\n        ')}
        ${button}
        ${fallbackLink}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    heading,
    '',
    ...blocks.map((b) => b.split('\n').map((l) => l.replace(/^\s*>\s?/, '  ').replace(/\*\*(.+?)\*\*/g, '$1')).join('\n')).flatMap((b) => [b, '']),
    ...(buttonLabel && actionUrl ? [`${buttonLabel}: ${actionUrl}`] : [])
  ].join('\n').trim();

  return { subject, html, text, unknown: [...unknown].filter((n) => !def.vars.some((x) => x.name === n)) };
}

/** Render a saved/default template with real values (what actually gets emailed). */
export async function renderSaved(key, vars) {
  const fields = await resolveFields(key);
  return render(key, fields, { appName: 'AUTOMATr', ...vars });
}
