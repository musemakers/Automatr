import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout.jsx';
import CustomFeatureRunner, { FieldInput } from '../../components/CustomFeatureRunner.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { Card, CardHead, Chip, Field, Btn, ErrorText } from '../../components/ui.jsx';
import { customFeaturesApi, adminApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';

// Brief Studio (agency super admin only).
//   1. Write a brief  -> the AI immediately shows the form the customer will see (product image, model
//                        image, dropdowns ...) plus the hidden prompts behind it
//   2. Edit           -> ONLY the form labels and the prompts; nothing else is editable
//   3. Test it        -> the real form, real run
//   4. Deploy         -> all customers or chosen ones
// The UI never names AI models or providers.

const EXAMPLES = [
  'Before & after creative for a cosmetics product, as ONE image. The customer uploads the product photo and an optional model photo and picks the skin concern; the single image shows before on the left and after on the right.',
  'One product image on a seasonal background (Diwali, monsoon or summer, chosen by the customer) from a single product photo.',
  'A single 5-second video: the product photo slowly comes alive with soft light and gentle camera movement.'
];

const MAX_REF_MB = 60;
const kindOfFile = (f) => (f?.type?.startsWith('video/') ? 'video' : 'image');

// Upload box for the optional reference image / video (super admin).
function ReferencePicker({ file, onFile, disabled, label = 'Upload reference image or video' }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const input = useRef(null);
  useEffect(() => {
    if (!file) { setUrl(''); return undefined; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^(image\/(png|jpe?g|webp)|video\/(mp4|webm|quicktime))$/.test(f.type)) { setErr('Use a PNG, JPG or WebP image, or an MP4, WebM or MOV video.'); return; }
    if (f.size > MAX_REF_MB * 1024 * 1024) { setErr(`That file is larger than ${MAX_REF_MB} MB.`); return; }
    setErr('');
    onFile(f);
  }
  return (
    <div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" onChange={pick} style={{ display: 'none' }} />
      {file ? (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {kindOfFile(file) === 'video'
            ? <video src={url} muted playsInline controls style={{ height: 120, borderRadius: 10, border: '1px solid var(--line)' }} />
            : <img src={url} alt="" style={{ height: 120, borderRadius: 10, border: '1px solid var(--line)' }} />}
          <div>
            <div style={{ fontWeight: 600 }}>{file.name}</div>
            <div className="hint" style={{ margin: '2px 0 8px' }}>{kindOfFile(file) === 'video' ? 'Reference video' : 'Reference image'}</div>
            <Btn variant="secondary" type="button" disabled={disabled} onClick={() => onFile(null)}>Remove</Btn>
          </div>
        </div>
      ) : (
        <Btn variant="secondary" type="button" disabled={disabled} onClick={() => input.current?.click()}>{label}</Btn>
      )}
      {err && <p className="error-text" style={{ margin: '6px 0 0' }}>{err}</p>}
    </div>
  );
}

const labelsOf = (spec) => Object.fromEntries((spec?.fields || []).map((f) => [f.key, f.label]));
const promptsOf = (spec) => Object.fromEntries((spec?.steps || []).map((s) => [s.key, s.prompt]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function StatusTag({ f }) {
  if (f.status === 'published') {
    const n = f.availability?.customers?.length || 0;
    return <span className="tag" style={{ background: 'rgba(38,166,91,.15)', color: '#26a65b' }}>{`Live · ${f.availability?.mode === 'all' ? 'all customers' : `${n} customer${n === 1 ? '' : 's'}`}`}</span>;
  }
  return <span className="tag">{f.testedCurrent ? 'Tested · not deployed' : 'Needs testing'}</span>;
}

const STEPS = ['Brief', 'Form & prompts', 'Test', 'Deploy'];

function Stepper({ step, onStep }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0 20px' }}>
      {STEPS.map((label, i) => {
        const active = step === i;
        return (
          <button key={label} type="button" onClick={() => onStep(i)} aria-current={active ? 'step' : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${active ? 'var(--accent, #111)' : 'var(--border, #ddd)'}`,
              background: active ? 'var(--accent, #111)' : 'transparent', color: active ? '#fff' : 'inherit', font: 'inherit', fontWeight: 600
            }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
              background: active ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.07)' }}>{i + 1}</span>
            {`Step ${i + 1} · ${label}`}
          </button>
        );
      })}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

// Plain text with a pencil; click the pencil (or the text) to edit, Enter / click away to keep, Esc to cancel.
function EditableText({ value, onChange, label, maxLength = 60, size = 15, weight = 600 }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => { const v = draft.trim(); if (v && v !== value) onChange(v); setEditing(false); };
  const textStyle = { fontSize: size, fontWeight: weight, lineHeight: 1.3 };
  if (editing) {
    return (
      <input autoFocus type="text" aria-label={label} maxLength={maxLength} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{ ...textStyle, font: 'inherit', fontSize: size, fontWeight: weight, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border, #ccc)', minWidth: 240, maxWidth: '100%' }} />
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={textStyle} onClick={start}>{value}</span>
      <button type="button" aria-label={label} title="Edit" onClick={start}
        style={{ display: 'inline-flex', padding: 4, border: 0, background: 'transparent', color: 'inherit', opacity: 0.55, cursor: 'pointer' }}><PencilIcon /></button>
    </span>
  );
}

// ------------------------------------------------------------------ editor for one feature

function FeatureEditor({ featureId, customers, onChanged, onClose }) {
  const [feature, setFeature] = useState(null);
  const [name, setName] = useState('');
  const [labels, setLabels] = useState({});
  const [prompts, setPrompts] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [avail, setAvail] = useState({ mode: 'all', customers: [] });
  const [step, setStep] = useState(1);
  const [brief, setBrief] = useState('');
  const [outType, setOutType] = useState('image');
  const textMode = 'ai'; // text on the image is always written by the AI (the "Exact" option was removed)
  const [newRef, setNewRef] = useState(null);
  const [dropRef, setDropRef] = useState(false);

  const adopt = useCallback((f) => {
    setFeature(f);
    setName(f.name);
    setBrief(f.brief || '');
    setOutType(f.spec?.output === 'video' ? 'video' : 'image');
    setNewRef(null); setDropRef(false);
    setLabels(labelsOf(f.spec));
    setPrompts(promptsOf(f.spec));
    setAvail({ mode: f.availability?.mode === 'selected' ? 'selected' : 'all', customers: f.availability?.customers || [] });
    onChanged?.();
  }, [onChanged]);

  useEffect(() => {
    setFeature(null); setError(''); setNotice('');
    customFeaturesApi.adminGet(featureId).then(({ feature: f }) => adopt(f)).catch((e) => setError(apiErrorMessage(e)));
  }, [featureId, adopt]);

  const live = feature?.status === 'published';
  const labelsDirty = feature && !same(labels, labelsOf(feature.spec));
  const promptsDirty = feature && !same(prompts, promptsOf(feature.spec));
  const nameDirty = feature && name.trim() !== feature.name;
  const dirty = Boolean(labelsDirty || promptsDirty || nameDirty);

  // What the test form is built from: the SAVED spec only.
  const testFeature = useMemo(() => (feature ? { id: feature.id, name: feature.name, description: feature.description, spec: feature.spec } : null), [feature?.id, feature?.spec, feature?.name, feature?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key, fn, okMsg) {
    setBusy(key); setError(''); setNotice('');
    try {
      const res = await fn();
      if (res?.feature) adopt(res.feature);
      if (okMsg) setNotice(okMsg);
      return res;
    } catch (e) {
      setError(apiErrorMessage(e));
      return null;
    } finally {
      setBusy('');
    }
  }

  const save = () => act('save', () => customFeaturesApi.adminUpdate(featureId, {
    ...(nameDirty ? { name } : {}),
    ...(labelsDirty ? { labels } : {}),
    ...(promptsDirty ? { prompts } : {})
  }), promptsDirty ? 'Saved. Test it again before deploying.' : 'Saved.');

  if (!feature) return <Card>{error ? <ErrorText>{error}</ErrorText> : <LoadingSpinner />}</Card>;

  const fields = feature.spec.fields || [];
  const steps = feature.spec.steps || [];
  const nameOf = (key, list) => list.find((x) => x.key === key)?.label || key;
  const customerId = (c) => String(c._id || c.id);

  const promptEditors = steps.map((s) => {
          const uses = [...(s.imageInputs || []).map((k) => nameOf(k, fields)), ...(s.useSteps || []).map((k) => `${nameOf(k, steps)} image`)];
          return (
            <Field key={s.key} label={s.label} hint={uses.length ? `Also given to the AI as reference: ${uses.join(', ')}` : 'Created from the prompt alone.'}>
              <textarea rows={6} maxLength={2600} disabled={live} value={prompts[s.key] ?? ''} onChange={(e) => setPrompts((p) => ({ ...p, [s.key]: e.target.value }))} />
            </Field>
          );
        });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <Btn variant="secondary" onClick={onClose}>← All features</Btn>
        <EditableText label="Edit feature name" value={name} onChange={setName} size={20} weight={700} />
        <StatusTag f={feature} />
      </div>
      <Stepper step={step} onStep={setStep} />
      <ErrorText>{error}</ErrorText>
      {notice && <div className="notice-banner" style={{ margin: '10px 0' }}>{notice}</div>}
      {feature.designNote && step === 1 && <div className="notice-banner" style={{ margin: '10px 0' }}>{feature.designNote}</div>}

      {step === 0 && (<>
      <h3 style={{ margin: '4px 0 10px', fontSize: 16 }}>Brief</h3>
      <Card>
        <p className="hint" style={{ marginTop: 0 }}>
          The brief and output type the AI used to build this feature. You can edit the brief at any time. To make the AI build the form and prompt again from the new brief, use Rebuild.
        </p>
        <Field label="Output type">
          <div className="chip-row">
            <Chip selected={outType === 'image'} onClick={() => !live && setOutType('image')}>Image</Chip>
            <Chip selected={outType === 'video'} onClick={() => !live && setOutType('video')}>Video</Chip>
          </div>
        </Field>
        <Field label="Reference" hint="The AI studies a reference image or video and builds the form and prompt to recreate it with the customer's own product. Add or replace it, then press Rebuild.">
          {feature.reference && !dropRef && !newRef && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600 }}>{feature.reference.name || 'Reference'} <span className="hint" style={{ margin: 0 }}>· {feature.reference.kind === 'video' ? 'video' : 'image'}{feature.reference.usesImage ? ' · used as a layout and style guide' : ''}{feature.reference.textBlocks ? ` · ${feature.reference.textBlocks} text area${feature.reference.textBlocks === 1 ? '' : 's'} recreated` : ''}</span></div>
              <details style={{ margin: '6px 0' }}>
                <summary className="hint" style={{ cursor: 'pointer' }}>What the AI understood</summary>
                <p className="hint" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{feature.reference.analysis}</p>
              </details>
              <Btn variant="secondary" type="button" disabled={live || Boolean(busy)} onClick={() => setDropRef(true)}>Remove reference</Btn>
            </div>
          )}
          {feature.reference && dropRef && !newRef && <p className="hint" style={{ marginTop: 0 }}>The reference will be removed when you rebuild.</p>}
          <ReferencePicker file={newRef} disabled={live || Boolean(busy)} label={feature.reference && !dropRef ? 'Replace reference' : 'Upload reference image or video'}
            onFile={(f) => { setNewRef(f); if (f) { setDropRef(false); setOutType(kindOfFile(f)); } }} />
        </Field>
        <Field label="Brief" hint="What the client needs, what the customer provides (product photo, model, choices) and the look you want.">
          <textarea rows={7} maxLength={6000} value={brief} onChange={(e) => setBrief(e.target.value)} />
        </Field>
        {live && <p className="hint">This feature is live. You can save the brief as a note; unpublish it before rebuilding the form and prompt.</p>}
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          <Btn variant="secondary" loading={busy === 'brief'} disabled={Boolean(busy) || brief.trim() === (feature.brief || '') || brief.trim().length < 12}
            onClick={() => act('brief', () => customFeaturesApi.adminUpdate(featureId, { brief: brief.trim() }), 'Brief saved.')}>Save brief only</Btn>
          <Btn variant="primary" loading={busy === 'rebuild'} disabled={Boolean(busy) || live || (brief.trim().length < 12 && !newRef && !(feature.reference && !dropRef))}
            onClick={async () => {
              if (!window.confirm('Rebuild the form and prompt from this brief and reference? Your label and prompt edits will be replaced, and the feature will need a new test.')) return;
              const r = await act('rebuild', () => customFeaturesApi.adminRedesign(featureId, { brief: brief.trim(), outputType: outType, textMode, ...(dropRef && !newRef ? { removeReference: 'true' } : {}) }, newRef), 'Rebuilt. Check the form and prompt.');
              if (r) setStep(1);
            }}>Rebuild form &amp; prompt</Btn>
          <Btn variant="secondary" disabled={Boolean(busy)} onClick={() => setStep(1)}>Next: Form &amp; prompts →</Btn>
        </div>
        {busy === 'rebuild' && <p className="hint">{newRef ? 'Studying the reference and designing the form and prompt - this can take a couple of minutes.' : 'Designing the form and prompt - this can take up to a minute.'}</p>}
      </Card>
      </>)}

      {step === 1 && (<>
      <h3 style={{ margin: '4px 0 10px', fontSize: 16 }}>What your customers will see</h3>
      <Card>
        <p className="hint" style={{ marginTop: 0 }}>
          This is the form exactly as it will appear in Generate Media, including the images they need to upload. Use the pencil to rename a label.
        </p>
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <EditableText label={`Edit label: ${f.label}`} value={labels[f.key] ?? f.label} onChange={(v) => setLabels((p) => ({ ...p, [f.key]: v }))} />
              <span className="hint" style={{ margin: 0 }}>{f.required ? 'Required' : 'Optional'}{f.type === 'image' ? ' · image upload' : ''}</span>
            </div>
            <fieldset disabled style={{ border: 0, padding: 0, margin: 0, opacity: 0.85 }}>
              <FieldInput field={f} value={f.type === 'multiselect' ? f.default || [] : f.default} files={[]} onValue={() => {}} onFiles={() => {}} />
            </fieldset>
            {f.help && <p className="hint" style={{ margin: '4px 0 0' }}>{f.help}</p>}
          </div>
        ))}
        <Btn variant="primary" type="button" disabled style={{ marginTop: 6 }}>Generate →</Btn>
      </Card>

      <h3 style={{ margin: '28px 0 10px', fontSize: 16 }}>Prompts</h3>
      <Card>
        <CardHead title="Hidden from customers" tag={feature.spec.output === 'video' ? 'Single video' : 'Single image'} />
        <p className="hint" style={{ marginTop: 0 }}>
          The prompt for the one image or video the AI creates. Customer answers are inserted where you see a value in double curly braces
          ({fields.map((f) => `{{${f.key}}}`).join(' ')}). Don't ask for words or logos inside the image or video.
          {live ? ' Unpublish to edit prompts; labels can still be changed while live.' : ''}
        </p>
        {promptEditors}
      </Card>

      <div className="btn-row" style={{ flexWrap: 'wrap', marginTop: 12 }}>
        <Btn variant="primary" loading={busy === 'save'} disabled={!dirty || Boolean(busy) || (promptsDirty && live)} onClick={save}>Save changes</Btn>
        <Btn variant="secondary" disabled={dirty || Boolean(busy)} onClick={() => setStep(2)}>Next: Test →</Btn>
        {dirty && <span className="hint" style={{ margin: 0 }}>Unsaved changes - save to continue</span>}
      </div>
      </>)}

      {step === 2 && (<>
      <h3 style={{ margin: '4px 0 10px', fontSize: 16 }}>Test and refine</h3>
      <div className="notice-banner" style={{ marginBottom: 14 }}>
        {dirty
          ? 'You have unsaved changes. Save them, then press "Test again" - the test always uses the saved prompt.'
          : feature.testedCurrent
            ? 'The current version has passed a test - you can deploy it, or keep refining the prompt below.'
            : 'Run a test with real inputs. Look at the result, adjust the prompt on the right, save and test again. A completed test of the current version unlocks deploying.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, alignItems: 'start' }}>
        <div>
          <CustomFeatureRunner
            mode="test"
            embedded
            feature={testFeature}
            onRunUpdate={(r) => {
              if (r.status !== 'completed') return;
              customFeaturesApi.adminGet(featureId).then(({ feature: f }) => setFeature((cur) => (cur ? { ...cur, testedCurrent: f.testedCurrent, lastTestedAt: f.lastTestedAt } : cur))).catch(() => {});
            }}
          />
        </div>
        <Card>
          <CardHead title="Prompt" tag="Hidden from customers" />
          <p className="hint" style={{ marginTop: 0 }}>
            Change what you didn't like in the result, save, then press "Test again with the same inputs" on the left. Customer answers go where you see a value in double curly braces
            ({fields.map((f) => `{{${f.key}}}`).join(' ')}).
            {live ? ' Unpublish to edit the prompt.' : ''}
          </p>
          {promptEditors}
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <Btn variant="primary" loading={busy === 'save'} disabled={!dirty || Boolean(busy) || (promptsDirty && live)} onClick={save}>Save prompt</Btn>
            {promptsDirty && !live && (
              <Btn variant="secondary" disabled={Boolean(busy)} onClick={() => setPrompts(promptsOf(feature.spec))}>Discard changes</Btn>
            )}
          </div>
        </Card>
      </div>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <Btn variant="secondary" onClick={() => setStep(1)}>← Back</Btn>
        <Btn variant="primary" disabled={dirty || !feature.testedCurrent} onClick={() => setStep(3)}>Next: Deploy →</Btn>
      </div>
      </>)}

      {step === 3 && (<>
      <h3 style={{ margin: '4px 0 10px', fontSize: 16 }}>Deploy</h3>
      <Card>
        {!feature.testedCurrent && !live && <div className="notice-banner" style={{ marginBottom: 14 }}>Deploying unlocks after a successful test of the current version.</div>}
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input type="radio" name="avail" checked={avail.mode === 'all'} onChange={() => setAvail((a) => ({ ...a, mode: 'all' }))} /> All customers
          </label>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input type="radio" name="avail" checked={avail.mode === 'selected'} onChange={() => setAvail((a) => ({ ...a, mode: 'selected' }))} /> Only specific customers
          </label>
        </div>
        {avail.mode === 'selected' && (
          <div style={{ display: 'grid', gap: 6, marginBottom: 14, maxHeight: 260, overflow: 'auto' }}>
            {customers.length === 0 && <p className="hint">No customers yet.</p>}
            {customers.map((c) => {
              const id = customerId(c);
              return (
                <label key={id} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={avail.customers.includes(id)} onChange={(e) => setAvail((a) => ({ ...a, customers: e.target.checked ? [...a.customers, id] : a.customers.filter((x) => x !== id) }))} />
                  {c.name}{c.status && c.status !== 'active' ? ` (${c.status})` : ''}
                </label>
              );
            })}
          </div>
        )}
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          <Btn variant="primary" loading={busy === 'publish'} disabled={Boolean(busy) || dirty || !feature.testedCurrent || (avail.mode === 'selected' && avail.customers.length === 0)}
            onClick={() => act('publish', () => customFeaturesApi.adminPublish(featureId, avail), live ? 'Availability updated.' : 'Deployed. It now appears in Generate Media for the chosen customers.')}>
            {live ? 'Update availability' : 'Deploy'}
          </Btn>
          {live && <Btn variant="secondary" loading={busy === 'unpublish'} disabled={Boolean(busy)} onClick={() => act('unpublish', () => customFeaturesApi.adminUnpublish(featureId), 'Unpublished. Customers no longer see it.')}>Unpublish</Btn>}
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>Deployed features appear as a tile in Generate Media and count toward each customer's image allowance and budget.</p>
      </Card>

      <div className="btn-row" style={{ marginTop: 28 }}>
        <Btn variant="secondary" onClick={() => setStep(2)}>← Back</Btn>
        <Btn variant="secondary" disabled={Boolean(busy)} onClick={async () => {
          if (!window.confirm(deleteMessage(feature))) return;
          const r = await act('remove', () => customFeaturesApi.adminRemove(featureId));
          if (r) onClose();
        }}>Delete feature</Btn>
      </div>
      </>)}
    </>
  );
}

function deleteMessage(f) {
  const live = f.status === 'published';
  return `Delete "${f.name}"?` + (live ? ' It is live, so customers will lose access to it immediately.' : '') + ' This cannot be undone.';
}

// ------------------------------------------------------------------ page

export default function AdminBriefStudio() {
  const [features, setFeatures] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [brief, setBrief] = useState('');
  const [outputType, setOutputType] = useState('image');
  const textMode = 'ai'; // text on the image is always written by the AI (the "Exact" option was removed)
  const [refFile, setRefFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    customFeaturesApi.adminList().then(({ features }) => setFeatures(features)).catch((e) => setError(apiErrorMessage(e))).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    adminApi.listCustomers().then(({ customers }) => setCustomers(customers.filter((c) => c.status !== 'archived'))).catch(() => {});
  }, [load]);

  async function handleDelete(f) {
    if (!window.confirm(deleteMessage(f))) return;
    setError('');
    try {
      await customFeaturesApi.adminRemove(f.id);
      setFeatures((list) => list.filter((x) => x.id !== f.id));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }

  async function handleCreate() {
    setError('');
    setBusy(true);
    try {
      const { feature } = await customFeaturesApi.adminCreate({ brief: brief.trim(), outputType, textMode }, refFile);
      setCreating(false); setBrief(''); setRefFile(null);
      load();
      setOpenId(feature.id);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout eyebrow="Admin" title="Brief Studio">
      {openId ? (
        <FeatureEditor featureId={openId} customers={customers} onChanged={load} onClose={() => { setOpenId(null); load(); }} />
      ) : (
        <>
          <div className="page-lede">
            <p>
              Write a brief and the AI builds the form your customers will see and the prompt behind it. The result is always a single image or a single video. Rename the labels, adjust the
              prompts, test it, then deploy it to every customer or only the ones who need it.
            </p>
          </div>
          <ErrorText>{error}</ErrorText>

          {creating ? (
            <Card>
              <CardHead title="New feature" />
              <Field label="Output type" hint="Every feature produces exactly one result.">
                <div className="chip-row">
                  <Chip selected={outputType === 'image'} onClick={() => setOutputType('image')}>Image</Chip>
                  <Chip selected={outputType === 'video'} onClick={() => setOutputType('video')}>Video</Chip>
                </div>
              </Field>
              <Field label="Reference (optional)" hint="Upload an image or video you want recreated. The AI studies it and builds the form and prompt that make a similar creative from your customer's own product. Max 60 MB.">
                <ReferencePicker file={refFile} disabled={busy} onFile={(f) => { setRefFile(f); if (f) setOutputType(kindOfFile(f)); }} />
              </Field>
              <Field label={refFile ? 'Brief (optional with a reference)' : 'Brief'} hint="What does the client need? Mention what the customer provides (product photo, model, choices) and the look you want. Add notes to steer the AI, e.g. \u201cthe background and props should come from the ingredient shown on the pack\u201d. Customers also get an optional Additional notes box.">
                <textarea rows={6} maxLength={6000} value={brief} placeholder="e.g. Olivia Cosmetics needs a before & after creative from a product photo…" onChange={(e) => setBrief(e.target.value)} />
                <div className="chip-row" style={{ marginTop: 8 }}>
                  {EXAMPLES.map((ex, i) => <Chip key={i} onClick={() => setBrief(ex)}>{`Example ${i + 1}`}</Chip>)}
                </div>
              </Field>
              <div className="btn-row">
                <Btn variant="primary" loading={busy} disabled={brief.trim().length < 12 && !refFile} onClick={handleCreate}>Build form →</Btn>
                <Btn variant="secondary" disabled={busy} onClick={() => setCreating(false)}>Cancel</Btn>
              </div>
              {busy && <p className="hint">{refFile ? 'Studying the reference and designing the form and prompt - this can take a couple of minutes.' : 'Designing the form and prompts - this can take up to a minute.'}</p>}
            </Card>
          ) : (
            <div className="btn-row" style={{ marginBottom: 18 }}><Btn variant="primary" onClick={() => setCreating(true)}>+ New feature</Btn></div>
          )}

          {loading ? <LoadingSpinner /> : features.length === 0 && !creating ? (
            <div className="empty-state">No custom features yet. Create the first one from a brief.</div>
          ) : (
            <div className="grid-2" style={{ gap: 16, maxWidth: 900 }}>
              {features.map((f) => (
                <div key={f.id} role="button" tabIndex={0} onClick={() => setOpenId(f.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(f.id)}
                  style={{ padding: 20, borderRadius: 12, border: '1px solid var(--border, #333)', cursor: 'pointer' }}>
                  <strong style={{ fontSize: 16 }}>{f.name}</strong>
                  <div style={{ margin: '6px 0' }}><StatusTag f={f} /></div>
                  <p className="hint" style={{ margin: 0 }}>{f.description || f.brief.slice(0, 110)}</p>
                  <p className="hint" style={{ margin: '8px 0 0', fontSize: 12 }}>{f.spec?.output === 'video' ? 'Video' : 'Image'}{f.reference ? ' · from reference' : ''} · {f.testRuns} test run{f.testRuns === 1 ? '' : 's'} · {f.runs} real run{f.runs === 1 ? '' : 's'}</p>
                  <div style={{ marginTop: 10 }}>
                    <Btn variant="secondary" onClick={(e) => { e.stopPropagation(); handleDelete(f); }}>Delete</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
