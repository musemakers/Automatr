import React, { useEffect, useState } from 'react';
import { Card, CardHead, Btn, Chip, ErrorText } from './ui.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';
import { adminApi } from '../api/resources.js';
import { apiErrorMessage } from '../api/client.js';

// Super admin: the standing instructions the app adds to AI prompts on its own (anatomy, full canvas, colour
// integrity, video guardrails ...). Each can be reworded, switched off, or put back to its default.
// The list and the default wording come from the server (constants/blanketRules.js).
function RuleRow({ rule, onSaved }) {
  const [text, setText] = useState(rule.text);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setText(rule.text), [rule.text]);

  const dirty = text.trim() !== rule.text.trim();

  async function run(kind, fn) {
    setBusy(kind);
    setError('');
    try {
      onSaved((await fn()).rules);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy('');
    }
  }

  function toggle() {
    if (rule.enabled && rule.caution && !window.confirm('This instruction protects the product and brand (colours, labels or full colour). Switch it off anyway?')) return;
    run('toggle', () => adminApi.updateBlanketRule(rule.key, { enabled: !rule.enabled }));
  }

  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid var(--line)', opacity: rule.enabled ? 1 : 0.75 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600 }}>
            {rule.label}
            {rule.customised && <span className="hint" style={{ margin: '0 0 0 8px', fontWeight: 400 }}>· edited</span>}
          </div>
          <p className="hint" style={{ margin: '2px 0 0' }}>{rule.description} <span style={{ whiteSpace: 'nowrap' }}>Applies to: {rule.appliesTo}.</span></p>
        </div>
        <div className="chip-row">
          <Chip selected={rule.enabled} onClick={() => !rule.enabled && !busy && toggle()}>On</Chip>
          <Chip selected={!rule.enabled} onClick={() => rule.enabled && !busy && toggle()}>Off</Chip>
        </div>
      </div>

      <textarea
        rows={4}
        maxLength={2500}
        value={text}
        disabled={!rule.enabled || Boolean(busy)}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', marginTop: 10, fontSize: 13, lineHeight: 1.45 }}
      />
      <ErrorText>{error}</ErrorText>
      {(dirty || rule.customised) && (
        <div className="btn-row" style={{ marginTop: 8 }}>
          {dirty && (
            <Btn variant="primary" loading={busy === 'save'} disabled={Boolean(busy) || !text.trim()} onClick={() => run('save', () => adminApi.updateBlanketRule(rule.key, { text }))}>
              Save wording
            </Btn>
          )}
          {dirty && <Btn variant="secondary" disabled={Boolean(busy)} onClick={() => setText(rule.text)}>Discard</Btn>}
          {rule.customised && !dirty && (
            <Btn variant="secondary" loading={busy === 'reset'} disabled={Boolean(busy)} onClick={() => run('reset', () => adminApi.resetBlanketRule(rule.key))}>
              Reset to default
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}

export default function BlanketInstructionsCard() {
  const [groups, setGroups] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.getBlanketRules()
      .then((d) => { setGroups(d.groups || []); setRules(d.rules || []); })
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card style={{ maxWidth: 820 }}>
      <CardHead title="Blanket instructions" tag={loading ? '…' : `${rules.filter((r) => r.enabled).length} of ${rules.length} on`} />
      <p className="hint" style={{ marginBottom: 6 }}>
        Standing instructions the app adds to AI prompts on its own, whatever a person typed: no distorted hands or feet, fill the whole canvas, keep
        product colours and labels exact, keep videos silent and text still, and so on. Change the wording, switch one off, or reset it to the default.
        Changes apply to every workspace within about 20 seconds. They are added when something is generated and are never saved inside a post.
      </p>
      <ErrorText>{error}</ErrorText>
      {loading && <LoadingSpinner label="Loading instructions…" />}
      {!loading && groups.map((g) => {
        const items = rules.filter((r) => r.group === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key} style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{g.label}</div>
            <p className="hint" style={{ margin: '2px 0 4px' }}>{g.hint}</p>
            {items.map((r) => <RuleRow key={r.key} rule={r} onSaved={setRules} />)}
          </div>
        );
      })}
    </Card>
  );
}
