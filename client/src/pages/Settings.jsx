import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { Card, CardHead, Field, Btn, ErrorText } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { authApi, linkedinApi, metaApi, xApi, youtubeApi } from '../api/resources.js';
import { apiErrorMessage } from '../api/client.js';
import IndustrySelect from '../components/IndustrySelect.jsx';

// Every social connector (LinkedIn, Meta, X, YouTube) follows the exact
// same shape: load a redacted status, connect via a full-page redirect to
// the platform's OAuth screen, disconnect via a simple POST. Rather than
// writing that four times, this hook parameterizes it over whichever
// {getConnectUrl, getStatus, disconnect} api object is passed in.
function useSocialConnection(api) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function reload() {
    setLoading(true);
    api
      .getStatus()
      .then(setStatus)
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    setConnecting(true);
    setError('');
    try {
      const { url } = await api.getConnectUrl();
      window.location.href = url; // full navigation - none of these OAuth screens are embeddable
    } catch (e) {
      setError(apiErrorMessage(e));
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError('');
    setNotice('');
    try {
      await api.disconnect();
      setNotice('Disconnected.');
      reload();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setDisconnecting(false);
    }
  }

  return { status, loading, connecting, disconnecting, error, notice, setNotice, setError, connect, disconnect, reload };
}

function ConnectionRow({ label, conn, describe }) {
  return (
    <div>
      <ErrorText>{conn.error}</ErrorText>
      {conn.notice && !conn.error && <p className="hint" style={{ marginBottom: 14, color: 'var(--blue-dark)' }}>{conn.notice}</p>}
      {conn.loading && <p className="hint">Loading…</p>}
      {!conn.loading && conn.status && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200, flex: '1 1 auto' }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{label}</p>
            <p className="hint" style={{ margin: '2px 0 0' }}>{describe(conn.status)}</p>
          </div>
          {conn.status.configured && (
            conn.status.connected ? (
              <Btn variant="secondary" loading={conn.disconnecting} onClick={conn.disconnect}>Disconnect</Btn>
            ) : (
              <Btn variant="primary" loading={conn.connecting} onClick={conn.connect}>Connect</Btn>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { user, setUser } = useAuth();
  const [industries, setIndustries] = useState([]);
  const [form, setForm] = useState({
    name: user?.name || '',
    companyName: user?.company?.name || '',
    designation: user?.company?.designation || '',
    industry: user?.company?.industry || ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const linkedin = useSocialConnection(linkedinApi);
  const meta = useSocialConnection(metaApi);
  const x = useSocialConnection(xApi);
  const youtube = useSocialConnection(youtubeApi);
  const connections = [
    { conn: linkedin, param: 'linkedin', label: 'LinkedIn' },
    { conn: meta, param: 'meta', label: 'Meta' },
    { conn: x, param: 'x', label: 'X' },
    { conn: youtube, param: 'youtube', label: 'YouTube' }
  ];

  useEffect(() => {
    authApi.industries().then(({ industries }) => setIndustries([...(industries || [])].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })))).catch(() => {});
  }, []);

  // Every OAuth callback redirects the whole browser back here with
  // ?<platform>=connected or ?<platform>=error&message=... (see each
  // controller's #callback) rather than a JSON response - pick that up
  // once on load and clean the URL so a refresh doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let sawAny = false;
    for (const { conn, param, label } of connections) {
      const result = params.get(param);
      if (!result) continue;
      sawAny = true;
      if (result === 'connected') {
        conn.setNotice(`${label} connected.`);
        conn.reload();
      } else if (result === 'error') {
        conn.setError(params.get('message') || `Could not connect ${label}.`);
      }
    }
    if (sawAny) window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { user: updated } = await authApi.updateMe(form);
      setUser(updated);
      setSuccess('Saved.');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout eyebrow="Workspace" title="Account Settings">
      <div className="page-lede"><p>Update your profile and your industry segment — this drives your dashboard&apos;s news feed and stock ticker.</p></div>

      <Card style={{ maxWidth: 520 }}>
        <CardHead title="Profile" />
        <ErrorText>{error}</ErrorText>
        {success && <p className="hint" style={{ marginBottom: 14, color: 'var(--blue-dark)' }}>{success}</p>}

        <form onSubmit={handleSubmit}>
          <Field label="Full name">
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </Field>
          <Field label="Company name">
            <input type="text" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
          </Field>
          <Field label="Designation">
            <input type="text" value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
          </Field>
          <Field label="Industry segment" hint="Changing this updates the news feed and stock ticker on your dashboard.">
            <IndustrySelect value={form.industry} items={[...new Set([form.industry, ...industries].filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }))} onChange={(v) => setForm((f) => ({ ...f, industry: v }))} />
          </Field>
          <div className="btn-row">
            <Btn variant="primary" block loading={saving} type="submit">Save changes</Btn>
          </div>
        </form>
      </Card>

      <Card style={{ maxWidth: 520 }}>
        <CardHead title="Connected accounts" />

        <ConnectionRow
          label="LinkedIn"
          conn={linkedin}
          describe={(s) =>
            !s.configured
              ? 'Not set up on this server yet - an admin needs to add LinkedIn API credentials.'
              : s.connected
                ? `Connected as ${s.name || 'your LinkedIn account'}. Posts publish to your personal feed.`
                : 'Not connected - posts to LinkedIn will fail until you connect your account.'
          }
        />

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '18px 0' }} />

        <ConnectionRow
          label="Meta (Instagram & Facebook)"
          conn={meta}
          describe={(s) =>
            !s.configured
              ? 'Not set up on this server yet - an admin needs to add Meta API credentials.'
              : s.connected
                ? `Connected to ${s.pageName || 'a Facebook Page'}${s.instagramUsername ? ` and @${s.instagramUsername} on Instagram` : ' (no Instagram account linked to this Page)'}.`
                : 'Not connected - posts to Instagram/Facebook will fail until you connect an account.'
          }
        />

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '18px 0' }} />

        <ConnectionRow
          label="X"
          conn={x}
          describe={(s) =>
            !s.configured
              ? 'Not set up on this server yet - an admin needs to add X API credentials.'
              : s.connected
                ? `Connected as @${s.username || 'your X account'}.`
                : 'Not connected - posts to X will fail until you connect your account.'
          }
        />

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '18px 0' }} />

        <ConnectionRow
          label="YouTube"
          conn={youtube}
          describe={(s) =>
            !s.configured
              ? 'Not set up on this server yet - an admin needs to add YouTube API credentials.'
              : s.connected
                ? `Connected to ${s.channelTitle || 'your channel'}. Only publishes a generated video, not the still image.`
                : 'Not connected - posts to YouTube will fail until you connect your channel.'
          }
        />
      </Card>

      <p className="hint" style={{ maxWidth: 520 }}>
        Email address changes and password resets aren&apos;t self-service yet — ask your workspace admin
        (Admin → Users &amp; Access) if you need either of those updated.
      </p>
    </Layout>
  );
}
