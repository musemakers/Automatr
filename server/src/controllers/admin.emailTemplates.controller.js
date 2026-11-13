import EmailTemplate from '../models/EmailTemplate.js';
import { TEMPLATES, TEMPLATE_KEYS, sampleVars, resolveFields, render } from '../services/emailTemplateService.js';
import { emailConfigured, sendMail } from '../services/emailService.js';

const LIMITS = { subject: 200, heading: 150, body: 5000, buttonLabel: 60 };

function cleanFields(input = {}) {
  const f = {};
  for (const k of Object.keys(LIMITS)) f[k] = String(input[k] ?? '').replace(/\r\n/g, '\n').trim();
  return f;
}

function validate(key, f) {
  for (const k of Object.keys(LIMITS)) if (f[k].length > LIMITS[k]) return `${k} is too long (max ${LIMITS[k]} characters).`;
  if (!f.subject) return 'The subject is required.';
  if (!f.heading) return 'The heading is required.';
  if (!f.body) return 'The message body is required.';
  const def = TEMPLATES[key];
  if (key === 'passwordReset' && !f.buttonLabel && !f.body.includes('{{resetUrl}}')) {
    return 'The password-reset email needs a button label or the {{resetUrl}} variable in the body - otherwise people cannot reach the link.';
  }
  void def;
  return null;
}

const need = (req, res) => {
  if (!TEMPLATES[req.params.key]) { res.status(404).json({ error: 'Unknown email template.' }); return false; }
  return true;
};

export async function listTemplates(_req, res, next) {
  try {
    const out = [];
    for (const key of TEMPLATE_KEYS) {
      const def = TEMPLATES[key];
      const fields = await resolveFields(key);
      out.push({ key, label: def.label, description: def.description, actionVar: def.actionVar, vars: def.vars, defaults: def.defaults, fields, customised: fields.customised });
    }
    res.json({ templates: out, emailConfigured: emailConfigured(), from: process.env.SMTP_FROM || '' });
  } catch (err) { next(err); }
}

export async function previewTemplate(req, res, next) {
  try {
    if (!need(req, res)) return;
    const f = cleanFields(req.body);
    const vars = { appName: 'AUTOMATr', ...sampleVars(req.params.key) };
    res.json(render(req.params.key, f, vars));
  } catch (err) { next(err); }
}

export async function saveTemplate(req, res, next) {
  try {
    if (!need(req, res)) return;
    const f = cleanFields(req.body);
    const bad = validate(req.params.key, f);
    if (bad) return res.status(400).json({ error: bad });
    await EmailTemplate.findOneAndUpdate({ key: req.params.key }, { ...f, key: req.params.key, updatedBy: req.user?.email || '' }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.json({ ok: true, fields: await resolveFields(req.params.key) });
  } catch (err) { next(err); }
}

export async function resetTemplate(req, res, next) {
  try {
    if (!need(req, res)) return;
    await EmailTemplate.deleteOne({ key: req.params.key });
    res.json({ ok: true, fields: await resolveFields(req.params.key) });
  } catch (err) { next(err); }
}

/** Sends the (unsaved) edit with sample data - only ever to the signed-in admin's own address. */
export async function testTemplate(req, res, next) {
  try {
    if (!need(req, res)) return;
    if (!emailConfigured()) return res.status(400).json({ error: 'Email is not configured. Set SMTP_HOST and SMTP_FROM in server/.env and restart the server.' });
    const to = req.user?.email;
    if (!to) return res.status(400).json({ error: 'Your account has no email address.' });
    const f = cleanFields(req.body);
    const r = render(req.params.key, f, { appName: 'AUTOMATr', ...sampleVars(req.params.key) });
    await sendMail({ to, subject: `[Test] ${r.subject}`, text: r.text, html: r.html });
    res.json({ ok: true, to });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not send the test email.' });
  }
}
