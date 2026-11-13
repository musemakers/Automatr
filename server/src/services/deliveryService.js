import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import Customer from '../models/Customer.js';
import { uploadDir, resolveUploadPath } from '../utils/storage.js';

// DELIVERY: how a customer gets finished creatives out of AUTOMATr.
//   folder  - files + caption + manifest are copied to <customer folder>/<subfolder>/<post id>/
//   webhook - one signed JSON POST to the customer's own endpoint (DAM, Zapier, Make, n8n, ...)
// Triggered from "Deliver" on a post, or automatically when a post is published
// (customer.delivery.autoOnPublish). Never throws into the publish flow - see deliverSafely.

const safeName = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'file';

/** Everything deliverable on the post's chosen design: images, size variants, carousel slides, finished videos. */
export function collectDeliverables(post) {
  const designs = post.designs || [];
  const d = designs.find((x) => x.label === post.selectedVariantLabel) || designs[0];
  if (!d) return { design: null, files: [], caption: '' };
  const files = [];
  const add = (url, role) => {
    if (url && typeof url === 'string' && url.startsWith('/uploads/') && !files.some((f) => f.url === url)) files.push({ url, role });
  };
  add(d.imageUrl, 'master');
  for (const v of d.formatVariants || []) add(v.imageUrl, `format-${v.formatId}`);
  for (const s of d.carouselSlides || []) add(s.imageUrl, `slide-${s.index}`);
  for (const j of d.videoJobs || []) if (j.status === 'completed') add(j.videoUrl, `video-${j.formatId || 'primary'}`);
  return { design: d, files, caption: d.caption || '' };
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
}

/** Webhook targets must be public https URLs (blocks localhost / internal network targets). */
export async function assertSafeWebhookUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Object.assign(new Error('Webhook URL is not a valid URL.'), { status: 400 });
  }
  const allowHttp = process.env.ALLOW_INSECURE_WEBHOOKS === 'true';
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) {
    throw Object.assign(new Error('Webhook URL must start with https://'), { status: 400 });
  }
  if (allowHttp) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw Object.assign(new Error('Webhook URL must be a public address.'), { status: 400 });
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error('Webhook host could not be resolved.'), { status: 400 });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw Object.assign(new Error('Webhook URL must be a public address.'), { status: 400 });
  return u;
}

function publicBase() {
  return (process.env.PUBLIC_BASE_URL || process.env.SERVER_PUBLIC_URL || '').replace(/\/$/, '');
}

export function signPayload(secret, timestamp, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

async function deliverToFolder(customer, post, { files, caption, design }) {
  const sub = safeName(customer.delivery.subfolder || 'delivered');
  const dir = path.join(uploadDir({ customer }), sub, String(post._id));
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const f of files) {
    const src = resolveUploadPath(f.url, { customer });
    if (!src || !fs.existsSync(src)) continue;
    const name = `${safeName(f.role)}-${safeName(path.basename(src))}`;
    fs.copyFileSync(src, path.join(dir, name));
    written.push(name);
  }
  if (caption) fs.writeFileSync(path.join(dir, 'caption.txt'), caption, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ postId: String(post._id), variant: design?.label, mediums: post.mediums, status: post.status, deliveredAt: new Date().toISOString(), files: written }, null, 2)
  );
  return { mode: 'folder', location: `customers/${customer.storage.folder}/${sub}/${post._id}`, files: written.length };
}

async function deliverToWebhook(customer, post, { files, caption, design }) {
  const url = await assertSafeWebhookUrl(customer.delivery.webhookUrl);
  const base = publicBase();
  const payload = {
    event: 'creative.delivered',
    customer: { id: String(customer._id), name: customer.name },
    post: { id: String(post._id), status: post.status, mediums: post.mediums, variant: design?.label || '' },
    caption,
    files: files.map((f) => ({ role: f.role, url: `${base}${f.url}` })),
    deliveredAt: new Date().toISOString()
  };
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'AUTOMATr-Delivery/1.0', 'X-Automatr-Timestamp': ts };
  if (customer.delivery.webhookSecret) headers['X-Automatr-Signature'] = signPayload(customer.delivery.webhookSecret, ts, body);
  const res = await fetch(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  return { mode: 'webhook', location: `${url.origin}${url.pathname}`, files: files.length, warning: base ? undefined : 'PUBLIC_BASE_URL is not set, so file links in the webhook are relative.' };
}

/** Deliver one post to its customer's destination. Throws on misconfiguration/failure. */
export async function deliverPost(post, customer) {
  const mode = customer.delivery?.mode || 'none';
  if (mode === 'none') throw Object.assign(new Error('No delivery destination is configured for this customer.'), { status: 400 });
  const bundle = collectDeliverables(post);
  if (!bundle.design || (!bundle.files.length && !bundle.caption)) {
    throw Object.assign(new Error('This post has nothing to deliver yet (no finished image, video or caption).'), { status: 400 });
  }
  let result;
  try {
    result = mode === 'folder' ? await deliverToFolder(customer, post, bundle) : await deliverToWebhook(customer, post, bundle);
  } catch (err) {
    await Customer.updateOne({ _id: customer._id }, { $set: { 'delivery.lastError': String(err.message).slice(0, 300) } });
    throw err;
  }
  await Customer.updateOne({ _id: customer._id }, { $set: { 'delivery.lastDeliveredAt': new Date(), 'delivery.lastError': '' } });
  return result;
}

/** For the publish flow: only when autoOnPublish is on, and never throws. */
export async function deliverSafely(post, customer) {
  if (!customer || customer.delivery?.mode === 'none' || !customer.delivery?.autoOnPublish) return null;
  try {
    return { ok: true, ...(await deliverPost(post, customer)) };
  } catch (err) {
    console.warn('[delivery] auto-delivery failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/** Sends a tiny test event so a customer admin can check their webhook / folder works. */
export async function testDelivery(customer) {
  const mode = customer.delivery?.mode || 'none';
  if (mode === 'none') throw Object.assign(new Error('Choose a delivery destination first.'), { status: 400 });
  if (mode === 'folder') {
    const dir = path.join(uploadDir({ customer }), safeName(customer.delivery.subfolder || 'delivered'));
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return { mode, location: `customers/${customer.storage.folder}/${safeName(customer.delivery.subfolder || 'delivered')}`, ok: true };
  }
  const url = await assertSafeWebhookUrl(customer.delivery.webhookUrl);
  const body = JSON.stringify({ event: 'delivery.test', customer: { id: String(customer._id), name: customer.name }, sentAt: new Date().toISOString() });
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { 'Content-Type': 'application/json', 'X-Automatr-Timestamp': ts };
  if (customer.delivery.webhookSecret) headers['X-Automatr-Signature'] = signPayload(customer.delivery.webhookSecret, ts, body);
  const res = await fetch(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  return { mode, location: `${url.origin}${url.pathname}`, ok: true };
}
