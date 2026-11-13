import React, { useEffect, useRef, useState } from 'react';
import Layout from './Layout.jsx';
import BloomLoader from './BloomLoader.jsx';
import VideoDownloadMenu from './VideoDownloadMenu.jsx';
import { Card, CardHead, Field, Chip, Btn, AiErrorNotice } from './ui.jsx';
import { customFeaturesApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl, downloadFile } from '../api/client.js';

// Runs a custom feature: renders the form the super admin's brief produced, starts the run, shows each
// image as it is made, lets the person pick a favourite where several options were made, then shows the
// final creative.
//
//   mode="live"  a person using a published feature in their workspace (Generate Media)
//   mode="test"  the super admin testing a feature in Brief Studio (shows the prompts; a finished test
//                unlocks publishing). Pass the full `feature` (with its spec) as a prop.
//
// The UI never names AI models or providers - it only ever says "AI".

const STEP_LABEL = { pending: 'Waiting', running: 'Creating…', done: 'Ready', failed: 'Failed' };
const POLL_MS = 3000;
const isBusy = (run) => run && ['running', 'composing'].includes(run.status);

function defaultsFor(fields) {
  const v = {};
  for (const f of fields || []) {
    if (f.type === 'image') continue;
    if (f.type === 'toggle') v[f.key] = Boolean(f.default);
    else if (f.type === 'multiselect') v[f.key] = [...(f.default || [])];
    else if (f.type === 'number') v[f.key] = f.default ?? f.min ?? 0;
    else v[f.key] = f.default ?? '';
  }
  return v;
}

function ImagePicker({ field, files, onChange }) {
  const ref = useRef(null);
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  const max = field.maxFiles || 1;
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={max > 1}
        style={{ display: 'none' }}
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          e.target.value = '';
          if (picked.length) onChange(picked.slice(0, max));
        }}
      />
      <Btn variant="secondary" type="button" onClick={() => ref.current?.click()}>
        {files.length ? (max > 1 ? 'Replace images' : 'Replace image') : max > 1 ? `+ Upload up to ${max} images` : '+ Upload image'}
      </Btn>
      {urls.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {urls.map((u, i) => (
            <img key={i} src={u} alt="" style={{ height: 72, maxWidth: 140, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }} />
          ))}
        </div>
      )}
    </>
  );
}

const isVideoUrl = (u) => /\.(mp4|webm|mov)(\?|$)/i.test(String(u || ''));

export function FieldInput({ field, value, files, onValue, onFiles }) {
  switch (field.type) {
    case 'image':
      return <ImagePicker field={field} files={files || []} onChange={onFiles} />;
    case 'textarea':
      return <textarea rows={3} maxLength={1500} placeholder={field.placeholder || ''} value={value ?? ''} onChange={(e) => onValue(e.target.value)} />;
    case 'select':
      return (
        <select value={value ?? ''} onChange={(e) => onValue(e.target.value)}>
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'multiselect':
      return (
        <div className="chip-row">
          {field.options.map((o) => {
            const on = (value || []).includes(o.value);
            return <Chip key={o.value} selected={on} onClick={() => onValue(on ? value.filter((x) => x !== o.value) : [...(value || []), o.value])}>{o.label}</Chip>;
          })}
        </div>
      );
    case 'number':
      return <input type="number" min={field.min} max={field.max} value={value ?? ''} onChange={(e) => onValue(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'toggle':
      return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onValue(e.target.checked)} />
          <span>{value ? 'Yes' : 'No'}</span>
        </label>
      );
    default:
      return <input type="text" maxLength={600} placeholder={field.placeholder || ''} value={value ?? ''} onChange={(e) => onValue(e.target.value)} />;
  }
}

function Thumb({ url, alt = '', height = 190 }) {
  return (
    isVideoUrl(url)
      ? <video src={resolveAssetUrl(url)} muted playsInline preload="metadata" style={{ height, maxWidth: '100%', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper, #111)', display: 'block' }} />
      : <img src={resolveAssetUrl(url)} alt={alt} style={{ height, maxWidth: '100%', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper, #111)', display: 'block' }} />
  );
}

export default function CustomFeatureRunner({ featureId, feature: provided = null, mode = 'live', onBack, embedded = false, onRunUpdate }) {
  const isTest = mode === 'test';
  const [feature, setFeature] = useState(provided);
  const [values, setValues] = useState(() => defaultsFor(provided?.spec?.fields));
  const [files, setFiles] = useState({});
  const [run, setRun] = useState(null);
  const [picks, setPicks] = useState({});
  const [past, setPast] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Live mode loads the feature itself; test mode is handed it (and re-handed it whenever the spec changes).
  useEffect(() => {
    if (provided) {
      setFeature(provided);
      setValues((prev) => ({ ...defaultsFor(provided.spec?.fields), ...Object.fromEntries(Object.entries(prev).filter(([k]) => (provided.spec?.fields || []).some((f) => f.key === k))) }));
      return;
    }
    let alive = true;
    customFeaturesApi.get(featureId).then(({ feature: f }) => {
      if (!alive) return;
      setFeature(f);
      setValues(defaultsFor(f.spec?.fields));
    }).catch((err) => alive && setError(apiErrorInfo(err)));
    return () => { alive = false; };
  }, [featureId, provided]);

  useEffect(() => {
    if (isTest || !featureId || run) return;
    customFeaturesApi.listRuns(featureId).then((r) => setPast(r.runs || [])).catch(() => setPast([]));
  }, [featureId, isTest, run]);

  // Keep the polled run, the pick buttons and the parent in step.
  function applyRun(next) {
    setRun(next);
    setPicks(Object.fromEntries(next.steps.map((s) => [s.key, s.selected || 0])));
    onRunUpdate?.(next);
  }

  useEffect(() => {
    if (!run?.id || !isBusy(run)) return undefined;
    const t = setInterval(async () => {
      try {
        const { run: next } = await customFeaturesApi.getRun(run.id);
        applyRun(next);
      } catch (err) {
        setError(apiErrorInfo(err));
      }
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status]);

  const fields = feature?.spec?.fields || [];

  async function handleStart() {
    setError(null);
    for (const f of fields) {
      if (f.type === 'image' && f.required && !(files[f.key] || []).length) return setError({ message: `Please add: ${f.label}.` });
      if ((f.type === 'text' || f.type === 'textarea') && f.required && !String(values[f.key] || '').trim()) return setError({ message: `Please fill in: ${f.label}.` });
      if (f.type === 'multiselect' && f.required && !(values[f.key] || []).length) return setError({ message: `Please choose at least one: ${f.label}.` });
    }
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of fields) {
        if (f.type === 'image') (files[f.key] || []).slice(0, f.maxFiles || 1).forEach((file) => form.append(f.key, file));
        else if (f.type === 'multiselect') form.append(f.key, JSON.stringify(values[f.key] || []));
        else form.append(f.key, String(values[f.key] ?? ''));
      }
      const { run: started } = await (isTest ? customFeaturesApi.adminTest(feature.id, form) : customFeaturesApi.start(feature.id, form));
      applyRun(started);
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setBusy(false);
    }
  }

  async function openPast(id) {
    setError(null);
    try {
      const { run: r } = await customFeaturesApi.getRun(id);
      applyRun(r);
    } catch (err) {
      setError(apiErrorInfo(err));
    }
  }

  async function handleCompose() {
    setError(null);
    setBusy(true);
    try {
      const { run: next } = await customFeaturesApi.compose(run.id, picks);
      applyRun(next);
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    setError(null);
    setBusy(true);
    try {
      const { run: next } = await customFeaturesApi.retry(run.id);
      applyRun(next);
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setBusy(false);
    }
  }

  const reset = () => { setRun(null); setError(null); setFiles({}); setValues(defaultsFor(fields)); };
  // Test mode: back to the form with the same photos and answers, to try an edited prompt.
  const rerun = () => { setRun(null); setError(null); };
  const multiSteps = run ? run.steps.filter((s) => s.variants.length > 1) : [];

  const body = (
    <>
      <AiErrorNotice error={error} />

      {!run && feature && (
        <>
          {isTest && (
            <div className="notice-banner" style={{ marginBottom: 14 }}>
              This is exactly the form people will see. A test run uses real AI credits; a successful test of the current version unlocks publishing.
            </div>
          )}
          <Card>
            <CardHead title={feature.name} />
            {feature.description && <p className="hint" style={{ marginTop: 0 }}>{feature.description}</p>}
            {fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? '' : ' (optional)'}`} hint={f.help || undefined}>
                <FieldInput
                  field={f}
                  value={values[f.key]}
                  files={files[f.key]}
                  onValue={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                  onFiles={(arr) => setFiles((p) => ({ ...p, [f.key]: arr }))}
                />
              </Field>
            ))}
          </Card>
          <div className="btn-row">
            <Btn variant="primary" loading={busy} onClick={handleStart}>
              {isTest ? 'Run a test' : 'Generate'} →
            </Btn>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {feature.spec?.output === 'video'
              ? 'This creates one video. It usually takes a few minutes.'
              : 'This creates one image.'}
          </p>

          {!isTest && past.length > 0 && (
            <Card style={{ marginTop: 24 }}>
              <CardHead title="Your earlier results" tag={`${past.length}`} />
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {past.map((r) => (
                  <div key={r.id} role="button" tabIndex={0} onClick={() => openPast(r.id)} onKeyDown={(e) => e.key === 'Enter' && openPast(r.id)} style={{ width: 110, cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ width: 110, height: 150, borderRadius: 10, border: '1px solid var(--line)', background: (r.finalUrl || r.thumb) && !isVideoUrl(r.finalUrl || r.thumb) ? `center / cover url(${resolveAssetUrl(r.finalUrl || r.thumb)})` : 'var(--paper, #111)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{isVideoUrl(r.finalUrl || r.thumb) ? 'Video' : null}</div>
                    <p className="hint" style={{ margin: '6px 0 0', fontSize: 11 }}>
                      {r.status === 'completed' ? new Date(r.createdAt).toLocaleDateString() : r.status === 'failed' ? 'Failed' : r.status === 'review' ? 'Pick options' : 'Working…'}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {run && (
        <>
          <Card>
            <CardHead title={run.status === 'completed' ? 'Your creative' : run.status === 'failed' ? 'Something went wrong' : run.status === 'review' ? 'Pick your favourites' : 'Creating your creative'} tag={run.stage} />
            {run.status === 'failed' && <p className="error-text">{run.error || 'Generation failed.'}</p>}
            {isBusy(run) && <p className="hint" style={{ marginTop: 0 }}>This usually takes a minute or two. You can leave this page open while it works.</p>}
            {run.status === 'composing' && (
              <div style={{ position: 'relative', width: 'min(100%, 260px)', height: 340, borderRadius: 14, overflow: 'hidden' }}>
                <BloomLoader label="Putting it together…" />
              </div>
            )}
            {run.status === 'completed' && run.finalUrl && (
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {isVideoUrl(run.finalUrl)
                  ? <video src={resolveAssetUrl(run.finalUrl)} controls playsInline loop style={{ maxWidth: 'min(100%, 560px)', maxHeight: 640, borderRadius: 14, border: '1px solid var(--line)', background: '#000' }} />
                  : <img src={resolveAssetUrl(run.finalUrl)} alt="Final creative" style={{ maxWidth: 'min(100%, 560px)', maxHeight: 640, borderRadius: 14, border: '1px solid var(--line)', background: '#fff' }} />}
                <div>
                  {isVideoUrl(run.finalUrl)
                    ? <VideoDownloadMenu url={run.finalUrl} baseName={(run.featureName || 'creative').replace(/[^a-z0-9]+/gi, '-').toLowerCase()} className="btn btn-primary"><span>Download</span></VideoDownloadMenu>
                    : <Btn variant="primary" type="button" onClick={() => downloadFile(resolveAssetUrl(run.finalUrl), `${(run.featureName || 'creative').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jpg`).catch((e) => setError({ message: e.message }))}>Download</Btn>}
                </div>
              </div>
            )}
          </Card>

          {(isTest || run.status !== 'completed') && <Card>
            <CardHead title="Output" />
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {run.steps.map((s) => (
                <div key={s.key} style={{ minWidth: 120 }}>
                  <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{s.label}</p>
                  {s.variants.length === 0 && (s.status === 'running' ? (
                    // Same generating loader as New Creative.
                    <div style={{ position: 'relative', width: 130, height: 190, borderRadius: 10, overflow: 'hidden' }}>
                      <BloomLoader label="Creating…" />
                    </div>
                  ) : (
                    <div style={{ width: 130, height: 190, borderRadius: 10, border: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, textAlign: 'center', padding: 6 }}>
                      {STEP_LABEL[s.status] || s.status}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {s.variants.map((v, i) => {
                      const chosen = s.variants.length > 1 && (picks[s.key] ?? 0) === i;
                      return (
                        <div
                          key={i}
                          role={s.variants.length > 1 ? 'button' : undefined}
                          tabIndex={s.variants.length > 1 ? 0 : undefined}
                          onClick={() => s.variants.length > 1 && setPicks((p) => ({ ...p, [s.key]: i }))}
                          onKeyDown={(e) => s.variants.length > 1 && e.key === 'Enter' && setPicks((p) => ({ ...p, [s.key]: i }))}
                          style={{ cursor: s.variants.length > 1 ? 'pointer' : 'default', outline: chosen ? '3px solid var(--blue, #4f6bff)' : 'none', outlineOffset: 2, borderRadius: 12 }}
                          title={s.variants.length > 1 ? `Option ${i + 1}` : undefined}
                        >
                          <Thumb url={v.url} alt={`${s.label}${s.variants.length > 1 ? ` option ${i + 1}` : ''}`} height={190} />
                          {s.variants.length > 1 && <p className="hint" style={{ margin: '4px 0 0', textAlign: 'center' }}>{chosen ? 'Chosen' : `Option ${i + 1}`}</p>}
                        </div>
                      );
                    })}
                  </div>
                  {s.note && <p className="hint" style={{ margin: '6px 0 0', color: s.status === 'failed' ? 'var(--danger, #c00)' : undefined, maxWidth: 220 }}>{s.note}</p>}
                  {isTest && s.prompt && (
                    <details style={{ marginTop: 6, maxWidth: 260 }}>
                      <summary className="hint" style={{ cursor: 'pointer' }}>Prompt used</summary>
                      <p className="hint" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{s.prompt}</p>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </Card>}

          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            {(run.status === 'review' || (run.status === 'completed' && multiSteps.length > 0)) && (
              <Btn variant="primary" loading={busy} onClick={handleCompose}>
                {run.status === 'review' ? 'Create final creative →' : 'Update final creative'}
              </Btn>
            )}
            {run.status === 'failed' && <Btn variant="primary" loading={busy} onClick={handleRetry}>Try again (keeps finished images)</Btn>}
            {isTest && !isBusy(run) && <Btn variant="primary" onClick={rerun}>Test again with the same inputs</Btn>}
            {!isBusy(run) && <Btn variant="secondary" onClick={reset}>{run.status === 'completed' ? 'Make another' : 'Start over'}</Btn>}
          </div>
        </>
      )}
    </>
  );

  if (embedded) return body;

  const crumb = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onBack}
        title="Back to Generate Media"
        style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--line)', textUnderlineOffset: 5 }}
      >
        Generate Media
      </button>
      <span aria-hidden="true" style={{ color: 'var(--muted)', fontWeight: 400 }}>&rsaquo;</span>
      <span style={{ color: 'var(--blue)' }}>{feature?.name || 'Custom feature'}</span>
    </span>
  );

  return <Layout title={crumb}>{body}</Layout>;
}
