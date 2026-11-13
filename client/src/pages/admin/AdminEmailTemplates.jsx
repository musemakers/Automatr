import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout.jsx';
import { Card, CardHead, Btn, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { adminApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';

const FIELD_KEYS = ['subject', 'heading', 'body', 'buttonLabel'];
const pick = (f) => Object.fromEntries(FIELD_KEYS.map((k) => [k, f?.[k] ?? '']));
const same = (a, b) => FIELD_KEYS.every((k) => (a?.[k] ?? '') === (b?.[k] ?? ''));

const inputStyle = { width: '100%', boxSizing: 'border-box' };
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', margin: '14px 0 5px' };

export default function AdminEmailTemplates() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeKey, setActiveKey] = useState('');
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [view, setView] = useState('desktop'); // desktop | mobile | text
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });
  const bodyRef = useRef(null);
  const lastFocus = useRef('body');

  const load = useCallback(async (keepKey) => {
    try {
      const d = await adminApi.listEmailTemplates();
      setData(d);
      const key = keepKey || d.templates[0]?.key || '';
      setActiveKey(key);
      return d;
    } catch (err) {
      setLoadError(apiErrorMessage(err));
      return null;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => data?.templates.find((t) => t.key === activeKey) || null, [data, activeKey]);

  useEffect(() => {
    if (active) { setDraft(pick(active.fields)); setMsg({ type: '', text: '' }); }
  }, [active?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview, rendered by the server so it is exactly what gets emailed.
  useEffect(() => {
    if (!active || !draft) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await adminApi.previewEmailTemplate(active.key, draft);
        if (!cancelled) setPreview(r);
      } catch (err) {
        if (!cancelled) setPreview({ error: apiErrorMessage(err) });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [active?.key, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = active && draft ? !same(draft, active.fields) : false;
  const isDefault = active && draft ? same(draft, active.defaults) : false;

  function setField(k, v) { setDraft((d) => ({ ...d, [k]: v })); }

  function insertVar(name) {
    const token = `{{${name}}}`;
    const k = lastFocus.current;
    if (k === 'body' && bodyRef.current) {
      const el = bodyRef.current;
      const s = el.selectionStart ?? draft.body.length;
      const e = el.selectionEnd ?? s;
      const next = draft.body.slice(0, s) + token + draft.body.slice(e);
      setField('body', next);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
    } else {
      setField(k, (draft[k] || '') + token);
    }
  }

  async function run(kind, fn, okText) {
    setBusy(kind); setMsg({ type: '', text: '' });
    try { await fn(); setMsg({ type: 'ok', text: okText }); } catch (err) { setMsg({ type: 'err', text: apiErrorMessage(err) }); } finally { setBusy(''); }
  }

  const save = () => run('save', async () => { await adminApi.saveEmailTemplate(active.key, draft); await load(active.key); }, 'Saved. New emails will use this version.');
  const resetDefault = () => {
    if (!window.confirm('Reset this template to the built-in default? Your edits will be lost.')) return;
    run('reset', async () => { await adminApi.resetEmailTemplate(active.key); await load(active.key); }, 'Restored the default.');
  };
  const sendTest = () => run('test', async () => { const r = await adminApi.testEmailTemplate(active.key, draft); setMsg({ type: 'ok', text: `Test email sent to ${r.to}.` }); }, '');
  const loadDefault = () => setDraft(pick(active.defaults));

  if (loadError) return <Layout eyebrow="Admin" title="Email Templates"><ErrorText>{loadError}</ErrorText></Layout>;
  if (!data || !active || !draft) return <Layout eyebrow="Admin" title="Email Templates"><LoadingSpinner /></Layout>;

  const unknown = preview?.unknown || [];
  const srcDoc = preview?.html || '';

  return (
    <Layout eyebrow="Admin" title="Email Templates">
      <div className="page-lede">
        <p>
          Every email the app sends - welcome and onboarding, password reset, security notices and workspace updates - uses these
          templates, for all customers. Edit the wording, preview it, and send yourself a test. The branded layout is fixed;
          you control the text. Use variables like <code>{'{{name}}'}</code> to personalise.
        </p>
      </div>

      {!data.emailConfigured && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14, borderColor: '#F5C26B', background: '#FFF8E8' }}>
          <strong>Email sending isn't set up yet.</strong> You can still edit and preview templates. To actually send (including
          password resets), set <code>SMTP_HOST</code>, <code>SMTP_FROM</code> and the other SMTP values in <code>server/.env</code> and restart the server.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '230px minmax(320px, 1fr) minmax(360px, 1.1fr)', gap: 16, alignItems: 'start' }}>
        {/* Template list */}
        <Card style={{ padding: 8 }}>
          {data.templates.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                if (dirty && !window.confirm('Discard unsaved changes to this template?')) return;
                setActiveKey(t.key);
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 0, borderRadius: 8, cursor: 'pointer',
                background: t.key === activeKey ? 'var(--blue-soft, #EEF3FF)' : 'transparent', color: 'inherit', marginBottom: 2
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.label}</div>
              {t.customised && <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>Customised</span>}
            </button>
          ))}
        </Card>

        {/* Editor */}
        <Card>
          <CardHead title={active.label} tag={active.customised ? 'Customised' : 'Default'} />
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 4px' }}>{active.description}</p>

          <label style={labelStyle}>Subject</label>
          <input style={inputStyle} value={draft.subject} maxLength={200} onFocus={() => { lastFocus.current = 'subject'; }} onChange={(e) => setField('subject', e.target.value)} />

          <label style={labelStyle}>Heading</label>
          <input style={inputStyle} value={draft.heading} maxLength={150} onFocus={() => { lastFocus.current = 'heading'; }} onChange={(e) => setField('heading', e.target.value)} />

          <label style={labelStyle}>Message</label>
          <textarea
            ref={bodyRef}
            style={{ ...inputStyle, minHeight: 190, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
            value={draft.body}
            maxLength={5000}
            onFocus={() => { lastFocus.current = 'body'; }}
            onChange={(e) => setField('body', e.target.value)}
          />
          <p className="hint" style={{ fontSize: 11.5, color: 'var(--muted)', margin: '4px 0 0' }}>
            Blank line = new paragraph. <code>**bold**</code> makes text bold. Lines starting with <code>&gt; </code> form a highlighted box.
          </p>

          <label style={labelStyle}>Button label <span style={{ fontWeight: 400 }}>(leave empty for no button)</span></label>
          <input style={inputStyle} value={draft.buttonLabel} maxLength={60} onFocus={() => { lastFocus.current = 'buttonLabel'; }} onChange={(e) => setField('buttonLabel', e.target.value)} />

          <label style={labelStyle}>Variables - click to insert at the cursor</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {active.vars.map((v) => (
              <button key={v.name} type="button" title={`${v.description} - e.g. ${v.sample}`} onClick={() => insertVar(v.name)}
                style={{ border: '1px solid var(--line)', background: 'var(--fog)', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'Consolas, Menlo, monospace' }}>
                {`{{${v.name}}}`}
              </button>
            ))}
          </div>
          <p className="hint" style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>
            The button links to <code>{`{{${active.actionVar}}}`}</code>.
          </p>

          {unknown.length > 0 && (
            <p style={{ color: '#B45309', fontSize: 12.5, marginTop: 10 }}>
              Unknown variable{unknown.length > 1 ? 's' : ''}: {unknown.map((u) => `{{${u}}}`).join(', ')} - {unknown.length > 1 ? 'they' : 'it'} will appear empty.
            </p>
          )}
          {msg.text && <p style={{ marginTop: 10, fontSize: 13, color: msg.type === 'err' ? '#B42318' : '#067647' }}>{msg.text}</p>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <Btn variant="primary" loading={busy === 'save'} disabled={!dirty || !!busy} onClick={save}>Save changes</Btn>
            <Btn variant="ghost" loading={busy === 'test'} disabled={!!busy} onClick={sendTest} title={data.emailConfigured ? 'Emails this draft, with sample data, to your own address' : 'Email is not configured'}>Send test to me</Btn>
            {!isDefault && <Btn variant="ghost" disabled={!!busy} onClick={loadDefault}>Load default text</Btn>}
            {active.customised && <Btn variant="ghost" loading={busy === 'reset'} disabled={!!busy} onClick={resetDefault}>Reset to default</Btn>}
          </div>
        </Card>

        {/* Preview */}
        <Card style={{ position: 'sticky', top: 12 }}>
          <CardHead title="Preview" tag="sample data" />
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[['desktop', 'Desktop'], ['mobile', 'Mobile'], ['text', 'Plain text']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setView(k)}
                style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 12px', fontSize: 12.5, cursor: 'pointer', background: view === k ? 'var(--ink, #0A0E17)' : 'var(--paper)', color: view === k ? '#fff' : 'inherit' }}>
                {l}
              </button>
            ))}
          </div>
          {preview?.error ? <ErrorText>{preview.error}</ErrorText> : (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>
                <strong>Subject:</strong> {preview?.subject || '...'}
              </div>
              {view === 'text' ? (
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, background: 'var(--fog)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, margin: 0, maxHeight: 560, overflow: 'auto' }}>{preview?.text || ''}</pre>
              ) : (
                <div style={{ background: '#f4f6fb', border: '1px solid var(--line)', borderRadius: 8, padding: view === 'mobile' ? '12px 0' : 0, display: 'flex', justifyContent: 'center' }}>
                  <iframe
                    title="Email preview"
                    sandbox=""
                    srcDoc={srcDoc}
                    style={{ border: 0, width: view === 'mobile' ? 375 : '100%', height: 580, background: '#f4f6fb' }}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </Layout>
  );
}
