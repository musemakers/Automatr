import React, { useEffect, useRef, useState } from 'react';
import Layout from './Layout.jsx';
import { Card, CardHead, Field, Chip, Btn, AiErrorNotice } from './ui.jsx';
import VideoDownloadMenu from './VideoDownloadMenu.jsx';
import { multiSceneApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl } from '../api/client.js';

// "Multi-scene Video": one short vertical reel made of several separately generated scenes -
// product hero beat -> N look scenes -> brand end card. Several AI models each do one job
// (storyboard, stills, motion); all on-screen text, the exact product, logos and the stitch
// are added by code so they are never redrawn or garbled.
//
// Flow: 1 Brief & assets -> 2 Review storyboard (every prompt editable) -> 3 Generate & watch.

const STATUS_LABEL = { pending: 'Waiting', still: 'Creating scene', animating: 'Adding motion', done: 'Ready', failed: 'Failed' };
const POLL_MS = 4000;

function FileButton({ label, accept = 'image/png,image/jpeg,image/webp', multiple = false, onPick, children }) {
  const ref = useRef(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) onPick(files);
        }}
      />
      <Btn variant="secondary" type="button" onClick={() => ref.current?.click()}>{children || label}</Btn>
    </>
  );
}

function Thumbs({ files }) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {urls.map((u, i) => (
        <img key={i} src={u} alt="" style={{ height: 56, maxWidth: 120, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }} />
      ))}
    </div>
  );
}

export default function MultiSceneEditor({ onBack }) {
  const [config, setConfig] = useState(null);
  const [phase, setPhase] = useState('brief'); // brief | storyboard | running
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // brief
  const [product, setProduct] = useState('');
  const [theme, setTheme] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('');
  const [notes, setNotes] = useState('');
  const [lookCount, setLookCount] = useState(4);
  const [labelsText, setLabelsText] = useState('');
  const [productFile, setProductFile] = useState([]);
  const [endLogo, setEndLogo] = useState([]);
  const [marketLogos, setMarketLogos] = useState([]);
  const [urlText, setUrlText] = useState('');

  // storyboard / job
  const [job, setJob] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [planNote, setPlanNote] = useState('');
  const [past, setPast] = useState([]);

  useEffect(() => {
    multiSceneApi.config().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Earlier reels are kept on the server's persistent storage - list them so nothing made before is ever lost.
  useEffect(() => {
    if (phase === 'brief') multiSceneApi.list().then((r) => setPast(r.reels || [])).catch(() => setPast([]));
  }, [phase]);

  async function openPast(id) {
    setError(null);
    try {
      const j = await multiSceneApi.get(id);
      setJob(j);
      setScenes(j.scenes.map((s) => ({ ...s })));
      setPhase(j.status === 'storyboard' ? 'storyboard' : 'running');
    } catch (err) {
      setError(apiErrorInfo(err));
    }
  }

  // Poll while a reel is being made.
  useEffect(() => {
    if (phase !== 'running' || !job?.id) return undefined;
    if (job.status === 'completed' || job.status === 'failed') return undefined;
    const t = setInterval(async () => {
      try {
        const next = await multiSceneApi.get(job.id);
        setJob(next);
      } catch (err) {
        setError(apiErrorInfo(err));
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [phase, job?.id, job?.status]);

  const cap = config?.capSeconds || 10;
  const notReady = config && Object.entries(config.ready || {}).filter(([, ok]) => !ok).map(([k]) => k);

  async function handlePlan() {
    setError(null);
    if (!productFile.length) return setError({ message: 'Upload the product image first.' });
    setBusy(true);
    try {
      const form = new FormData();
      form.append('product', productFile[0]);
      if (endLogo[0]) form.append('endLogo', endLogo[0]);
      marketLogos.slice(0, 6).forEach((f) => form.append('marketLogos', f));
      form.append('brief', JSON.stringify({
        product, theme, audience, tone, notes, urlText, lookCount,
        labels: labelsText.split(',').map((s) => s.trim()).filter(Boolean)
      }));
      const planned = await multiSceneApi.plan(form);
      setJob(planned);
      setScenes(planned.scenes.map((s) => ({ ...s })));
      setPlanNote(planned.note || '');
      setPhase('storyboard');
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    setBusy(true);
    try {
      const started = await multiSceneApi.generate(job.id, { scenes });
      setJob(started);
      setPhase('running');
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setBusy(false);
    }
  }

  const edit = (i, field, value) => setScenes((prev) => prev.map((s, j) => (j === i ? { ...s, [field]: value } : s)));
  const totalSeconds = scenes.reduce((a, s) => a + (Number(s.seconds) || 0), 0);

  const crumb = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onBack}
        title="Start a new one"
        style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--line)', textUnderlineOffset: 5 }}
      >
        Generate Media
      </button>
      <span aria-hidden="true" style={{ color: 'var(--muted)', fontWeight: 400 }}>&rsaquo;</span>
      <span style={{ color: 'var(--blue)' }}>Multi-scene Video</span>
    </span>
  );

  return (
    <Layout title={crumb}>
      <div className="page-lede">
        <p>
          A short vertical reel built from several scenes - a product moment, a run of different looks, then your brand end card.
          Up to {cap}s, the longest the video model can produce.
        </p>
      </div>

      <AiErrorNotice error={error} />
      {notReady && notReady.length > 0 && (
        <div className="notice-banner" style={{ marginBottom: 18 }}>
          Some AI models are not set up yet ({notReady.map((k) => ({ storyboard: 'storyboard writer', stills: 'scene images', motion: 'video' }[k] || k)).join(', ')}). Ask an admin to configure them before generating.
        </div>
      )}

      {phase === 'brief' && (
        <>
          <Card>
            <CardHead title="1 · Product & idea" />
            <Field label="Product image" hint="The exact product shot used in the reel - it is placed in the scene untouched, never redrawn. A transparent-background PNG works best.">
              <FileButton onPick={setProductFile}>{productFile.length ? 'Replace product image' : '+ Upload product image'}</FileButton>
              <Thumbs files={productFile} />
            </Field>
            <Field label="Product name">
              <input type="text" maxLength={120} placeholder="e.g. Infinite black kajal" value={product} onChange={(e) => setProduct(e.target.value)} />
            </Field>
            <Field label="Idea / theme" hint="What the reel is about, in a sentence or two.">
              <textarea rows={3} maxLength={400} placeholder="e.g. One kajal, five work-week looks - from 9-5 office to Friday night" value={theme} onChange={(e) => setTheme(e.target.value)} />
            </Field>
            <div className="grid-2">
              <Field label="Audience & market" hint="Optional.">
                <input type="text" maxLength={200} placeholder="e.g. Working women 22-35, India" value={audience} onChange={(e) => setAudience(e.target.value)} />
              </Field>
              <Field label="Tone" hint="Optional.">
                <input type="text" maxLength={120} placeholder="e.g. Confident, playful, premium" value={tone} onChange={(e) => setTone(e.target.value)} />
              </Field>
            </div>
            <Field label="Number of looks" hint={`Each look is its own scene. The reel is capped at ${cap}s, so more looks means shorter cuts.`}>
              <div className="chip-row">
                {Array.from({ length: (config?.maxLooks || 5) - (config?.minLooks || 2) + 1 }, (_, i) => (config?.minLooks || 2) + i).map((n) => (
                  <Chip key={n} selected={lookCount === n} onClick={() => setLookCount(n)}>{n}</Chip>
                ))}
              </div>
            </Field>
            <Field label="Look labels" hint="Optional, comma-separated, in order - e.g. Monday, Tuesday, Wednesday. Leave empty to let the writer choose.">
              <input type="text" placeholder="Monday, Tuesday, Wednesday, Thursday" value={labelsText} onChange={(e) => setLabelsText(e.target.value)} />
            </Field>
            <Field label="Anything else" hint="Optional.">
              <textarea rows={2} maxLength={600} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </Card>

          <Card>
            <CardHead title="2 · End card" tag="Optional" />
            <p className="hint" style={{ marginTop: 0 }}>Logos are pasted onto the end card exactly as uploaded - they are never regenerated.</p>
            <Field label="Brand logo">
              <FileButton onPick={setEndLogo}>{endLogo.length ? 'Replace logo' : '+ Upload logo'}</FileButton>
              <Thumbs files={endLogo} />
            </Field>
            <Field label="Website text" hint="Shown under the button, e.g. www.yourbrand.com">
              <input type="text" maxLength={60} value={urlText} onChange={(e) => setUrlText(e.target.value)} />
            </Field>
            <Field label="Available-on logos" hint="Up to 6 marketplace / retailer logos, shown in a row under “Available On”.">
              <FileButton multiple onPick={(f) => setMarketLogos(f.slice(0, 6))}>{marketLogos.length ? 'Replace logos' : '+ Upload logos'}</FileButton>
              <Thumbs files={marketLogos} />
            </Field>
          </Card>

          <div className="btn-row">
            <Btn variant="primary" loading={busy} onClick={handlePlan}>Plan storyboard →</Btn>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>Planning only writes the storyboard. Nothing is generated until you approve it on the next screen.</p>

          {past.length > 0 && (
            <Card style={{ marginTop: 24 }}>
              <CardHead title="Your earlier reels" tag={`${past.length}`} />
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {past.map((r) => (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openPast(r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && openPast(r.id)}
                    style={{ width: 110, cursor: 'pointer', textAlign: 'center' }}
                    title={r.title}
                  >
                    <div
                      style={{
                        width: 110, height: 195, borderRadius: 10, border: '1px solid var(--line)',
                        background: r.thumb ? `center / cover url(${resolveAssetUrl(r.thumb)})` : 'var(--paper, #111)',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontSize: 11, color: '#fff'
                      }}
                    >
                      <span style={{ background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 6, marginBottom: 6 }}>
                        {r.status === 'completed' ? `${Number(r.totalSeconds).toFixed(0)}s` : r.status === 'storyboard' ? 'Draft' : r.status === 'failed' ? 'Failed' : 'Working…'}
                      </span>
                    </div>
                    <p className="hint" style={{ margin: '6px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</p>
                    <p className="hint" style={{ margin: 0, fontSize: 11 }}>{new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {phase === 'storyboard' && (
        <>
          <p className="hint" style={{ marginBottom: 14 }}>
            Review and edit every scene. The scene prompt describes the image; the motion prompt describes how it moves. On-screen words
            (titles, labels, button text) are added afterwards by software, so they will always be spelled exactly as you type them here.
            Timing is set automatically: {totalSeconds.toFixed(1)}s total (max {cap}s).
          </p>
          {planNote && <div className="notice-banner" style={{ marginBottom: 14 }}>{planNote}</div>}

          {scenes.map((s, i) => (
            <Card key={i}>
              <CardHead
                title={s.kind === 'hero' ? 'Scene 1 · Product moment' : s.kind === 'end' ? 'Final · End card' : `Scene ${i + 1} · Look ${i}`}
                tag={`${Number(s.seconds).toFixed(1)}s`}
              />
              {s.kind === 'hero' && (
                <div className="grid-2">
                  <Field label="Kicker"><input type="text" maxLength={24} value={s.label} onChange={(e) => edit(i, 'label', e.target.value)} /></Field>
                  <Field label="Title"><input type="text" maxLength={24} value={s.title} onChange={(e) => edit(i, 'title', e.target.value)} /></Field>
                </div>
              )}
              {s.kind === 'hero' && (
                <Field label="Subline"><input type="text" maxLength={44} value={s.subline || ''} onChange={(e) => edit(i, 'subline', e.target.value)} /></Field>
              )}
              {s.kind === 'look' && (
                <div className="grid-2">
                  <Field label="Look title"><input type="text" maxLength={24} value={s.title} onChange={(e) => edit(i, 'title', e.target.value)} /></Field>
                  <Field label="Label (day / occasion)"><input type="text" maxLength={18} value={s.label} onChange={(e) => edit(i, 'label', e.target.value)} /></Field>
                </div>
              )}
              {s.kind === 'end' && (
                <div className="grid-2">
                  <Field label="Button text"><input type="text" maxLength={18} value={s.title} onChange={(e) => edit(i, 'title', e.target.value)} /></Field>
                  <Field label="Website text"><input type="text" maxLength={40} value={s.label} onChange={(e) => edit(i, 'label', e.target.value)} /></Field>
                </div>
              )}
              {s.kind !== 'end' && (
                <>
                  <Field label={s.kind === 'hero' ? 'Scene prompt (setting only - the product is added exactly as uploaded)' : 'Scene prompt'}>
                    <textarea rows={4} maxLength={900} value={s.stillPrompt} onChange={(e) => edit(i, 'stillPrompt', e.target.value)} />
                  </Field>
                  <Field label="Motion prompt">
                    <textarea rows={2} maxLength={240} value={s.motionPrompt} onChange={(e) => edit(i, 'motionPrompt', e.target.value)} />
                  </Field>
                </>
              )}
            </Card>
          ))}

          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <Btn variant="secondary" onClick={() => setPhase('brief')}>← Back</Btn>
            <Btn variant="primary" loading={busy} onClick={handleGenerate}>Generate reel ({totalSeconds.toFixed(1)}s) →</Btn>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            This creates {scenes.filter((s) => s.kind !== 'end').length} scene images and {scenes.filter((s) => s.kind !== 'end').length} short video clips, so it uses more credits than a single image and takes a few minutes.
          </p>
        </>
      )}

      {phase === 'running' && job && (
        <>
          <Card>
            <CardHead title={job.status === 'completed' ? 'Your reel' : job.status === 'failed' ? 'Something went wrong' : 'Making your reel'} tag={job.stage} />
            {job.status === 'failed' && <p className="error-text">{job.error || 'Generation failed.'}</p>}
            {job.status === 'completed' && job.videoUrl && (
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <video src={resolveAssetUrl(job.videoUrl)} controls playsInline style={{ width: 260, maxWidth: '100%', borderRadius: 14, background: '#000' }} />
                <div>
                  <p className="hint" style={{ marginTop: 0 }}>{Number(job.totalSeconds).toFixed(1)}s · 9:16 · no audio</p>
                  <VideoDownloadMenu url={job.videoUrl} baseName="automatr-reel" align="left" className="btn btn-primary"><span>Download video</span></VideoDownloadMenu>
                </div>
              </div>
            )}
            {job.status !== 'completed' && job.status !== 'failed' && (
              <p className="hint" style={{ marginTop: 0 }}>This usually takes a few minutes. You can leave this page open while it works.</p>
            )}
          </Card>

          <Card>
            <CardHead title="Scenes" />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {job.scenes.map((s, i) => (
                <div key={i} style={{ width: 96, textAlign: 'center' }}>
                  <div
                    style={{
                      width: 96, height: 170, borderRadius: 10, border: '1px solid var(--line)',
                      background: s.stillUrl ? `center / cover url(${resolveAssetUrl(s.stillUrl)})` : 'var(--paper, #111)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12
                    }}
                  >
                    {s.kind === 'end' ? 'End card' : !s.stillUrl ? '…' : ''}
                  </div>
                  <p className="hint" style={{ margin: '6px 0 0' }}>{s.kind === 'end' ? 'Added by software' : STATUS_LABEL[s.status] || s.status}</p>
                  {s.note && <p className="hint" style={{ margin: 0, color: 'var(--danger, #c00)' }}>{s.note}</p>}
                </div>
              ))}
            </div>
          </Card>

          {(job.status === 'completed' || job.status === 'failed') && (
            <div className="btn-row">
              <Btn variant="secondary" onClick={() => setPhase('storyboard')}>Edit storyboard & regenerate</Btn>
              <Btn variant="secondary" onClick={onBack}>Start a new one</Btn>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
