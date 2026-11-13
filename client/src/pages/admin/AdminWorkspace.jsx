import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout.jsx';
import { Card, CardHead, Btn, Field, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { adminApi, authApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';

const MODES = [
  { id: 'none', label: 'Download only', help: 'Nothing is sent anywhere. People download from the app.' },
  { id: 'folder', label: 'Shared folder', help: 'Finished creatives are copied into this customer’s own delivery folder on the server.' },
  { id: 'webhook', label: 'Webhook', help: 'Each delivery is sent to your system (DAM, Zapier, Make, n8n…) as a signed JSON message with file links.' }
];

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');

export default function AdminWorkspace() {
  const { customer: sessionCustomer, isAgency, refreshSession } = useAuth();
  const [view, setView] = useState(null);
  const [industries, setIndustries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState(null);

  function applyView(v) {
    setView(v);
    const c = v.customer;
    setForm({
      name: c.name,
      industry: c.industry,
      mode: c.delivery?.mode || 'none',
      autoOnPublish: Boolean(c.delivery?.autoOnPublish),
      subfolder: c.delivery?.subfolder || 'delivered',
      webhookUrl: c.delivery?.webhookUrl || '',
      webhookSecret: '',
      clearWebhookSecret: false
    });
  }

  useEffect(() => {
    setLoading(true);
    adminApi
      .getCurrentCustomer()
      .then(applyView)
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
    authApi.industries().then(({ industries }) => setIndustries(industries)).catch(() => {});
  }, [sessionCustomer?._id, sessionCustomer?.id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function payload() {
    return {
      name: form.name,
      industry: form.industry,
      delivery: {
        mode: form.mode,
        autoOnPublish: form.mode !== 'none' && form.autoOnPublish,
        subfolder: form.subfolder,
        webhookUrl: form.webhookUrl,
        webhookSecret: form.webhookSecret || undefined,
        clearWebhookSecret: form.clearWebhookSecret || undefined
      }
    };
  }

  async function save(e) {
    e?.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const v = await adminApi.updateCurrentCustomer(payload());
      applyView(v);
      setNotice('Saved.');
      refreshSession().catch(() => {});
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setError('');
    setNotice('');
    try {
      await adminApi.updateCurrentCustomer(payload()); // test what is on screen
      const r = await adminApi.testDelivery();
      setNotice(`Test OK — ${r.mode === 'folder' ? 'the delivery folder is writable' : 'your webhook accepted the test message'} (${r.location}).`);
      adminApi.getCurrentCustomer().then(applyView).catch(() => {});
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  if (loading || !form) {
    return (
      <Layout eyebrow="Admin" title="Workspace & Delivery">
        <ErrorText>{error}</ErrorText>
        {loading ? <LoadingSpinner label="Loading workspace…" /> : null}
      </Layout>
    );
  }

  const c = view.customer;
  const dm = MODES.find((m) => m.id === form.mode);

  return (
    <Layout eyebrow="Admin" title="Workspace & Delivery">
      <div className="page-lede">
        <p>
          Settings for <strong>{c.name}</strong>. Everything here applies to this customer only. AI model choices live in{' '}
          <Link to="/admin/ai-settings">AI Settings</Link>, the team in <Link to="/admin/users">Users &amp; Access</Link>, and the brand library in{' '}
          <Link to="/brand">Brand Assets</Link>.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>
      {notice && <div className="notice notice--ok">{notice}</div>}
      {view.storage.persistent === false && (
        <div className="notice notice--warn">
          This server isn&apos;t using a persistent volume for files, so saved and delivered files can disappear on redeploy.
        </div>
      )}

      <div className="kv-grid">
        <div className="kv"><span>Team members</span><strong>{view.counts.users}</strong></div>
        <div className="kv"><span>Saved posts</span><strong>{view.counts.posts}</strong></div>
        <div className="kv"><span>Brand assets</span><strong>{view.counts.assets}</strong></div>
        {isAgency && <div className="kv"><span>AI spend this month (est.)</span><strong>${(view.monthCostUsd || 0).toFixed(2)}</strong></div>}
      </div>

      <form onSubmit={save}>
        <Card>
          <CardHead title="Workspace" />
          <div className="grid-2">
            <Field label="Workspace name">
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </Field>
            <Field label="Industry" hint="Used for industry news and AI context.">
              <select value={form.industry} onChange={(e) => set('industry', e.target.value)}>
                {[...new Set([form.industry, ...industries])].map((i) => <option key={i}>{i}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Storage folder" hint="Where this customer's generated and uploaded files are kept. Set when the customer was created.">
            <input type="text" className="mono" value={view.storage.path} disabled />
          </Field>
        </Card>

        <Card>
          <CardHead title="Delivery destination" />
          <div className="chip-row" style={{ marginBottom: 8 }}>
            {MODES.map((m) => (
              <span key={m.id} className={`chip ${form.mode === m.id ? 'selected' : ''}`} onClick={() => set('mode', m.id)}>{m.label}</span>
            ))}
          </div>
          <p className="hint" style={{ marginBottom: 14 }}>{dm?.help}</p>

          {form.mode === 'folder' && (
            <Field label="Delivery subfolder" hint={`Files land in ${view.storage.path}/${form.subfolder || 'delivered'}/<post id>/ with a caption and manifest.`}>
              <input type="text" value={form.subfolder} onChange={(e) => set('subfolder', e.target.value)} />
            </Field>
          )}

          {form.mode === 'webhook' && (
            <>
              <Field label="Webhook URL" hint="Must be a public https address.">
                <input type="text" value={form.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} placeholder="https://example.com/automatr-hook" />
              </Field>
              <Field
                label="Signing secret (optional)"
                hint={c.delivery?.hasWebhookSecret && !form.clearWebhookSecret ? 'A secret is saved. Type a new one to replace it. Messages carry an HMAC-SHA256 signature in the X-Automatr-Signature header.' : 'If set, every message is signed (HMAC-SHA256, X-Automatr-Signature header) so you can verify it came from AUTOMATr.'}
              >
                <input type="password" autoComplete="new-password" value={form.webhookSecret} onChange={(e) => set('webhookSecret', e.target.value)} placeholder={c.delivery?.hasWebhookSecret ? '••••••••' : ''} />
              </Field>
              {c.delivery?.hasWebhookSecret && (
                <label className="perm-row" style={{ marginBottom: 14 }}>
                  <input type="checkbox" checked={form.clearWebhookSecret} onChange={(e) => set('clearWebhookSecret', e.target.checked)} />
                  Remove the saved secret
                </label>
              )}
            </>
          )}

          {form.mode !== 'none' && (
            <label className="perm-row" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={form.autoOnPublish} onChange={(e) => set('autoOnPublish', e.target.checked)} />
              Deliver automatically whenever a post is published
            </label>
          )}

          {form.mode !== 'none' && (
            <p className="hint" style={{ marginBottom: 14 }}>
              Last delivery: {fmtDate(c.delivery?.lastDeliveredAt)}
              {c.delivery?.lastError ? <> · <span style={{ color: '#B42318' }}>last error: {c.delivery.lastError}</span></> : null}
            </p>
          )}

          <div className="btn-row">
            {form.mode !== 'none' && <Btn variant="secondary" type="button" loading={testing} onClick={test}>Save &amp; send test</Btn>}
            <Btn variant="primary" type="submit" loading={saving}>Save changes</Btn>
          </div>
        </Card>
      </form>
    </Layout>
  );
}
