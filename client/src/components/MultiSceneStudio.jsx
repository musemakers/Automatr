import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from './Layout.jsx';
import BloomLoader from './BloomLoader.jsx';
import { AiErrorNotice } from './ui.jsx';
import VideoDownloadMenu from './VideoDownloadMenu.jsx';
import { FlowStepBar } from './flow/FlowParts.jsx';
import { Rail, RailStage, RailStageInner, RailPanel, RailBottom } from './flow/Rail.jsx';
import { sceneReelApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl } from '../api/client.js';
import { peekSceneHandoff, clearSceneHandoff } from '../utils/sceneHandoff.js';
import '../styles/video-flow.css';
import '../styles/scene-studio.css';

import iconFlow from '../assets/video/icon-convert-video.svg';
import iconArrowWhite from '../assets/video/icon-arrow-right-white.svg';
import iconSparkleWhite from '../assets/size-adapt/icon-sparkle-white.svg';
import iconDownWhite from '../assets/video/icon-download-white.svg';

// Multi-scene Video: Setup -> Scenes -> Generate -> Download.
//  Setup    what the video is about, shape (vertical / horizontal), target length, "keep scenes flowing"
//  Scenes   one card per scene: brief, optional reference image (its starting frame), length, transition, on-screen text
//  Generate each scene is made in turn (the server keeps going if the person leaves the page)
//  Download the finished reel (MP4 or GIF), with "Redo this scene" for any scene that missed
const STEPS = [['01', 'Setup'], ['02', 'Scenes'], ['03', 'Generate'], ['04', 'Download']];
const STAGE_KEYS = ['setup', 'scenes', 'make', 'done'];
const TOTALS = [15, 30, 45, 60];
const LENGTHS = [3, 4, 5, 6, 8, 10];
const MAX_SCENES = 12;
const TRANSITIONS = [['cut', 'Cut'], ['fade', 'Fade'], ['dissolve', 'Dissolve'], ['wipe', 'Wipe'], ['slide', 'Slide up']];

const newId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const blankScene = (over = {}) => ({ id: newId(), brief: '', caption: '', seconds: 5, transition: 'fade', ref: '', refUrl: '', ...over });
const pad2 = (n) => String(n).padStart(2, '0');
const sum = (list) => list.reduce((a, s) => a + (Number(s.seconds) || 0), 0);

/** Splits `total` seconds over `count` scenes of 3-10 s each (whole seconds). */
function splitSeconds(total, count) {
  const out = Array.from({ length: count }, () => Math.min(10, Math.max(3, Math.floor(total / count))));
  let diff = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0 && i < count * 12; i += 1) {
    const k = i % count;
    const next = out[k] + Math.sign(diff);
    if (next >= 3 && next <= 10) { out[k] = next; diff -= Math.sign(diff); }
  }
  return out;
}

const fromServerScene = (s) => ({ id: s.id, brief: s.brief, caption: s.caption || '', seconds: s.seconds, transition: s.transition, ref: s.ref || '', refUrl: s.refUrl || '' });

export default function MultiSceneStudio({ onBack }) {
  const init = useMemo(() => peekSceneHandoff(), []);
  useEffect(() => { clearSceneHandoff(); }, []);
  const tpl = init?.template || null;
  const openReel = init?.reel || null;

  const [stage, setStage] = useState(() => (openReel ? (openReel.status === 'completed' ? 'done' : 'make') : 'setup'));
  const [title, setTitle] = useState(() => openReel?.title || tpl?.title || '');
  const [idea, setIdea] = useState(() => openReel?.overallBrief || '');
  const [aspect, setAspect] = useState(() => openReel?.settings?.aspect || tpl?.aspect || '9:16');
  const [total, setTotal] = useState(() => openReel?.settings?.totalTarget || tpl?.total || 30);
  const [continuity, setContinuity] = useState(() => openReel?.settings?.continuity !== false);
  const [scenes, setScenes] = useState(() => (openReel ? openReel.scenes.map(fromServerScene) : tpl ? tpl.scenes.map((s) => blankScene(s)) : []));
  const [reel, setReel] = useState(openReel);
  const [error, setError] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [uploadingId, setUploadingId] = useState('');
  const [redo, setRedo] = useState(null); // { id, brief }
  const [note, setNote] = useState('');
  const fileRef = useRef(null);
  const pickFor = useRef('');

  // ---- polling while the reel is being made
  useEffect(() => {
    if (!reel?.id || reel.status !== 'running') return undefined;
    let live = true;
    const tick = async () => {
      try {
        const r = await sceneReelApi.get(reel.id);
        if (!live) return;
        setReel(r);
        if (r.status === 'completed') {
          setStage('done');
          window.dispatchEvent(new Event('automatr:allowance-refresh'));
        } else if (r.status === 'failed') {
          window.dispatchEvent(new Event('automatr:allowance-refresh'));
        }
      } catch { /* a missed poll is fine: the next one catches up */ }
    };
    const t = setInterval(tick, 4000);
    return () => { live = false; clearInterval(t); };
  }, [reel?.id, reel?.status]);

  const ideaOk = idea.trim().length >= 10;
  const allBriefs = scenes.length > 0 && scenes.every((s) => s.brief.trim());
  const totalNow = sum(scenes);
  const near = Math.abs(totalNow - total) <= Math.max(2, total * 0.1);
  const aspectCls = aspect === '16:9' ? 'is-wide' : 'is-tall';

  const update = (id, patch) => setScenes((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (i, d) => setScenes((list) => { const j = i + d; if (j < 0 || j >= list.length) return list; const n = list.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; });
  const dup = (i) => setScenes((list) => (list.length >= MAX_SCENES ? list : [...list.slice(0, i + 1), { ...list[i], id: newId() }, ...list.slice(i + 1)]));
  const remove = (id) => setScenes((list) => list.filter((s) => s.id !== id));
  const add = () => setScenes((list) => (list.length >= MAX_SCENES ? list : [...list, blankScene()]));
  const fit = () => setScenes((list) => { const secs = splitSeconds(total, list.length); return list.map((s, i) => ({ ...s, seconds: secs[i] })); });

  async function draftWithAI() {
    if (!ideaOk) return;
    setError(null); setNote(''); setDrafting(true);
    try {
      const out = await sceneReelApi.suggest({ idea: idea.trim(), totalSeconds: total, aspect });
      setScenes(out.scenes.map((s) => blankScene(s)));
      if (!title.trim() && out.title) setTitle(out.title);
      setNote(out.note || '');
      setStage('scenes');
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setDrafting(false);
    }
  }

  function startBlank() {
    if (!ideaOk) return;
    setError(null);
    if (!scenes.length) setScenes(splitSeconds(total, Math.min(MAX_SCENES, Math.max(2, Math.round(total / 5)))).map((seconds, i) => blankScene({ seconds, transition: i === 0 ? 'cut' : 'fade' })));
    setStage('scenes');
  }

  async function chooseRef(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const id = pickFor.current;
    if (!file || !id) return;
    setError(null); setUploadingId(id);
    try {
      const out = await sceneReelApi.upload(file);
      update(id, { ref: out.file, refUrl: out.url });
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setUploadingId('');
    }
  }

  async function generate() {
    if (!allBriefs || starting) return;
    setError(null); setStarting(true);
    try {
      const r = await sceneReelApi.create({
        title: title.trim() || 'Multi-scene video',
        overallBrief: idea.trim(),
        settings: { aspect, totalTarget: total, continuity },
        scenes: scenes.map(({ id, brief, caption, seconds, transition, ref }) => ({ id, brief, caption, seconds, transition, ref }))
      });
      setReel(r);
      setStage('make');
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setStarting(false);
    }
  }

  async function retry() {
    setError(null);
    try { setReel(await sceneReelApi.retry(reel.id)); } catch (err) { setError(apiErrorInfo(err)); }
  }

  async function redoScene() {
    if (!redo) return;
    setError(null);
    try {
      const r = await sceneReelApi.redoScene(reel.id, redo.id, { brief: redo.brief });
      setReel(r);
      setScenes(r.scenes.map(fromServerScene));
      setRedo(null);
      setStage('make');
    } catch (err) {
      setError(apiErrorInfo(err));
    }
  }

  const reachable = [!reel, !reel && (scenes.length > 0), Boolean(reel), reel?.status === 'completed'];
  const goStep = (i) => setStage(STAGE_KEYS[i]);
  const bar = <FlowStepBar icon={iconFlow} name="Multi-scene Video" steps={STEPS} step={STAGE_KEYS.indexOf(stage)} reachable={reachable} onStep={goStep} />;

  // ------------------------------------------------------------------ 01 Setup
  if (stage === 'setup') {
    const count = scenes.length || Math.min(MAX_SCENES, Math.max(2, Math.round(total / 5)));
    const secs = scenes.length ? scenes.map((s) => s.seconds) : splitSeconds(total, count);
    return (
      <Layout rail>
        {bar}
        <Rail>
          <RailStage>
            <div className="ms-plan">
              <p className="ms-plan__title">How your {total}-second video will be built</p>
              <div className={`ms-plan__frame ${aspectCls}`} aria-hidden="true">
                <div className="ms-plan__strip">
                  {secs.map((sec, i) => <div key={i} className="ms-plan__block" style={{ flexGrow: sec }}><b>{i + 1}</b><span>{sec}s</span></div>)}
                </div>
              </div>
              <p className="ms-plan__hint">{count} scenes · each one is a separate shot, joined with smooth transitions{continuity ? ', and each scene picks up where the last one ended' : ''}.</p>
            </div>
          </RailStage>
          <RailPanel label="Settings">
            <AiErrorNotice error={error} />
            <p className="sa-kicker">{pad2(1)} / Setup</p>
            <h2 className="sa-heading">Plan your multi-scene video</h2>
            <p>Tell us what the video is about. We can draft the scenes for you, or you can build them yourself.</p>

            <div className="ms-field">
              <label htmlFor="ms-idea">What is the video about?</label>
              <textarea id="ms-idea" rows={4} maxLength={1500} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="For example: A 30-second launch reel for our new rose-gold kajal. Soft, premium, a young woman getting ready for a night out." />
              <p className="ms-hint">The product, who it is for, the mood. The more specific, the better the scenes.</p>
            </div>
            <div className="ms-field">
              <label htmlFor="ms-title">Name <span>(optional)</span></label>
              <input id="ms-title" type="text" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shown in Saved Documents" />
            </div>
            <div className="ms-field">
              <span className="ms-label">Shape</span>
              <div className="ms-chips" role="radiogroup" aria-label="Shape">
                {[['9:16', 'Vertical 9:16', 'Reels, Stories, Shorts'], ['16:9', 'Horizontal 16:9', 'YouTube, web']].map(([k, label, sub]) => (
                  <button key={k} type="button" role="radio" aria-checked={aspect === k} className={`ms-chip ms-chip--wide ${aspect === k ? 'is-on' : ''}`} onClick={() => setAspect(k)}><b>{label}</b><small>{sub}</small></button>
                ))}
              </div>
            </div>
            <div className="ms-field">
              <span className="ms-label">Target length</span>
              <div className="ms-chips" role="radiogroup" aria-label="Target length">
                {TOTALS.map((t) => <button key={t} type="button" role="radio" aria-checked={total === t} className={`ms-chip ${total === t ? 'is-on' : ''}`} onClick={() => setTotal(t)}>{t}s</button>)}
              </div>
              <p className="ms-hint">You can fine-tune every scene&apos;s length next. Scenes are 3 to 10 seconds each.</p>
            </div>
            <label className="ms-check">
              <input type="checkbox" checked={continuity} onChange={(e) => setContinuity(e.target.checked)} />
              <span><b>Keep scenes flowing</b> (recommended)<small>Each scene starts from the last frame of the one before, so the look and subject stay consistent. Takes longer because scenes are made one after another.</small></span>
            </label>

            <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!ideaOk || drafting} onClick={tpl && scenes.length ? startBlank : draftWithAI}>
              {drafting ? <><span className="spinner" style={{ width: 16, height: 16 }} /><span>Drafting scenes…</span></> : tpl && scenes.length
                ? <><span>Continue to scenes</span><img src={iconArrowWhite} alt="" /></>
                : <><img src={iconSparkleWhite} alt="" className="sa-btn__sm" /><span>Draft scenes for me</span></>}
            </button>
            {tpl && scenes.length > 0 && (
              <button type="button" className="ms-link" disabled={!ideaOk || drafting} onClick={draftWithAI}>Rewrite the scenes for my idea instead</button>
            )}
            {!(tpl && scenes.length) && <button type="button" className="ms-link" disabled={!ideaOk} onClick={startBlank}>I&apos;ll write the scenes myself</button>}
            {!ideaOk && <p className="ms-hint" role="status">Describe your video in a sentence or two to continue.</p>}
          </RailPanel>
        </Rail>
      </Layout>
    );
  }

  // ------------------------------------------------------------------ 02 Scenes
  if (stage === 'scenes') {
    return (
      <Layout rail>
        {bar}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={chooseRef} />
        <Rail>
          <RailStage scroll>
            <RailStageInner>
              <ol className="ms-scenes">
                {scenes.map((s, i) => (
                  <li key={s.id} className="ms-scene">
                    <div className="ms-scene__head">
                      <span className="ms-scene__n">Scene {i + 1}</span>
                      <span className="ms-scene__len">{s.seconds}s</span>
                      <span className="ms-scene__tools">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move scene ${i + 1} up`}>↑</button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === scenes.length - 1} aria-label={`Move scene ${i + 1} down`}>↓</button>
                        <button type="button" onClick={() => dup(i)} disabled={scenes.length >= MAX_SCENES}>Duplicate</button>
                        <button type="button" onClick={() => remove(s.id)} disabled={scenes.length <= 1}>Delete</button>
                      </span>
                    </div>
                    <div className="ms-scene__body">
                      <div className="ms-scene__main">
                        <label htmlFor={`b-${s.id}`}>What happens in this scene</label>
                        <textarea id={`b-${s.id}`} rows={3} maxLength={500} value={s.brief} onChange={(e) => update(s.id, { brief: e.target.value })} placeholder="Describe what we see: the subject, the action, the camera move and the light." />
                        <label htmlFor={`c-${s.id}`}>On-screen text <span>(optional)</span></label>
                        <input id={`c-${s.id}`} type="text" maxLength={60} value={s.caption} onChange={(e) => update(s.id, { caption: e.target.value })} placeholder="A short line shown over this scene" />
                      </div>
                      <div className="ms-scene__ref">
                        <span className="ms-label">Starting image <em>(optional)</em></span>
                        {s.refUrl ? (
                          <div className="ms-ref">
                            <img src={resolveAssetUrl(s.refUrl)} alt={`Starting image for scene ${i + 1}`} />
                            <div>
                              <button type="button" onClick={() => { pickFor.current = s.id; fileRef.current?.click(); }}>Replace</button>
                              <button type="button" onClick={() => update(s.id, { ref: '', refUrl: '' })}>Remove</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="ms-ref ms-ref--empty" disabled={uploadingId === s.id} onClick={() => { pickFor.current = s.id; fileRef.current?.click(); }}>
                            {uploadingId === s.id ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <span>+ Add image</span>}
                            <small>Product, person or place to start from</small>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="ms-scene__opts">
                      <div>
                        <span className="ms-label">Length</span>
                        <div className="ms-chips ms-chips--tight" role="radiogroup" aria-label={`Length of scene ${i + 1}`}>
                          {LENGTHS.map((n) => <button key={n} type="button" role="radio" aria-checked={s.seconds === n} className={`ms-chip ms-chip--sm ${s.seconds === n ? 'is-on' : ''}`} onClick={() => update(s.id, { seconds: n })}>{n}s</button>)}
                        </div>
                      </div>
                      {i > 0 && (
                        <div>
                          <label className="ms-label" htmlFor={`t-${s.id}`}>Comes in with</label>
                          <select id={`t-${s.id}`} value={s.transition} onChange={(e) => update(s.id, { transition: e.target.value })}>
                            {TRANSITIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <button type="button" className="ms-add" onClick={add} disabled={scenes.length >= MAX_SCENES}>+ Add scene {scenes.length >= MAX_SCENES ? `(max ${MAX_SCENES})` : ''}</button>
            </RailStageInner>
          </RailStage>
          <RailPanel label="Settings">
            <AiErrorNotice error={error} />
            <p className="sa-kicker">{pad2(2)} / Scenes</p>
            <h2 className="sa-heading">Build your scenes</h2>
            {note && <p className="ms-hint" role="status">{note}</p>}
            <p>Each scene is one shot. Add a starting image to begin a scene from your own product or person, and set how long each shot lasts.</p>

            <div className="ms-total" aria-live="polite">
              <div className="ms-total__row"><b>{scenes.length} scene{scenes.length === 1 ? '' : 's'}</b><span>{totalNow}s of {total}s target</span></div>
              <div className="ms-total__bar"><span className={near ? 'is-ok' : ''} style={{ width: `${Math.min(100, Math.round((totalNow / total) * 100))}%` }} /></div>
              {!near && <button type="button" className="ms-link" onClick={fit}>Match the {total}s target</button>}
              <p className="ms-hint">Transitions overlap scenes slightly, so the finished video can be a second or two shorter.</p>
            </div>
            <p className="ms-hint"><b>{scenes.length}</b> video generation{scenes.length === 1 ? '' : 's'} will be used, one per scene.</p>

            <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!allBriefs || starting} onClick={generate}>
              {starting ? <><span className="spinner" style={{ width: 16, height: 16 }} /><span>Starting…</span></> : <><span>Generate video</span><img src={iconArrowWhite} alt="" /></>}
            </button>
            {!allBriefs && <p className="ms-hint" role="status">Every scene needs a short description before you can generate.</p>}
            <button type="button" className="ms-link" onClick={() => setStage('setup')}>Back to setup</button>
          </RailPanel>
        </Rail>
      </Layout>
    );
  }

  // ------------------------------------------------------------------ 03 Generate
  if (stage === 'make' && reel) {
    const running = reel.status === 'running';
    const failed = reel.status === 'failed';
    const doneCount = reel.scenes.filter((s) => s.status === 'done').length;
    return (
      <Layout rail>
        {bar}
        <Rail>
          <RailStage scroll>
            <RailStageInner>
              <ul className={`ms-tiles ${reel.settings.aspect === '16:9' ? 'is-wide' : 'is-tall'}`}>
                {reel.scenes.map((s, i) => (
                  <li key={s.id} className={`ms-tile is-${s.status}`}>
                    <div className="ms-tile__img">
                      {s.frameUrl ? <img src={resolveAssetUrl(s.frameUrl)} alt="" /> : s.refUrl ? <img className="is-ref" src={resolveAssetUrl(s.refUrl)} alt="" /> : null}
                      {s.status === 'generating' && <div className="ms-tile__busy"><BloomLoader bare label={`Making scene ${i + 1}`} /></div>}
                    </div>
                    <p className="ms-tile__label"><b>{i + 1}</b> {s.status === 'done' ? 'Ready' : s.status === 'generating' ? 'Making…' : s.status === 'failed' ? 'Needs another try' : 'Waiting'}</p>
                    {s.status === 'failed' && s.note && <p className="ms-tile__note">{s.note}</p>}
                  </li>
                ))}
              </ul>
            </RailStageInner>
          </RailStage>
          <RailPanel label="Progress">
            <AiErrorNotice error={error} />
            <p className="sa-kicker">{pad2(3)} / Generate</p>
            <h2 className="sa-heading">{failed ? 'Some scenes need another try' : 'Making your video'}</h2>
            {running && <p role="status">{reel.stage || 'Working'}. {doneCount} of {reel.scenes.length} scenes ready. This can take several minutes, and you can leave this page: it will keep going. Find it again under Generate Media → Made for You.</p>}
            {failed && <p className="rail__bottom-error" role="alert">{reel.error || 'We couldn’t finish your video. Your finished scenes are saved.'}</p>}
            {failed && (
              <>
                <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={retry}><span>Try again</span></button>
                {doneCount === 0 && <button type="button" className="ms-link" onClick={() => { setScenes(reel.scenes.map(fromServerScene)); setReel(null); setStage('scenes'); }}>Edit the scenes first</button>}
              </>
            )}
          </RailPanel>
        </Rail>
      </Layout>
    );
  }

  // ------------------------------------------------------------------ 04 Download
  const url = reel?.videoUrl ? resolveAssetUrl(reel.videoUrl) : '';
  const base = (reel?.title || 'multi-scene-video').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'multi-scene-video';
  const text = (
    <>
      <AiErrorNotice error={error} />
      <p>{reel?.title || 'Your video'}</p>
      <p role="status">Your video is ready{reel?.totalSeconds ? ` (${Math.round(reel.totalSeconds)}s)` : ''}. Preview it, download it, or redo a scene below.</p>
      <VideoDownloadMenu url={reel?.videoUrl || ''} baseName={base} up disabled={!url} align="left" className="sa-btn sa-btn--primary sa-btn--lg">
        <span>Download</span><img className="sa-icon-down" src={iconDownWhite} alt="" />
      </VideoDownloadMenu>
    </>
  );
  const extras = (
    <button type="button" className="sa-btn sa-btn--outline sa-btn--sm" onClick={onBack}><span>Make another</span></button>
  );
  return (
    <Layout rail pageClass="page-result page-video-done">
      {bar}
      <Rail bottom>
        <RailStage scroll>
          <RailStageInner>
            <div className="ms-final">
              <div className={`ms-final__video ${reel?.settings?.aspect === '16:9' ? 'is-wide' : 'is-tall'}`}>
                {url ? <video src={url} controls loop playsInline aria-label="Your video" /> : <p className="vf-canvas__empty">Your video will show here.</p>}
              </div>
              {reel && (
                <div className="ms-redo">
                  <p className="ms-redo__title">Not happy with a scene? Redo just that one.</p>
                  <ul>
                    {reel.scenes.map((s, i) => (
                      <li key={s.id}>
                        <div className="ms-redo__row">
                          <span><b>{i + 1}</b> {s.brief.length > 90 ? `${s.brief.slice(0, 90)}…` : s.brief}</span>
                          <button type="button" className="ms-link" onClick={() => setRedo(redo?.id === s.id ? null : { id: s.id, brief: s.brief })}>{redo?.id === s.id ? 'Cancel' : 'Redo'}</button>
                        </div>
                        {redo?.id === s.id && (
                          <div className="ms-redo__edit">
                            <textarea rows={3} maxLength={500} value={redo.brief} onChange={(e) => setRedo({ ...redo, brief: e.target.value })} aria-label={`New description for scene ${i + 1}`} />
                            <button type="button" className="sa-btn sa-btn--primary sa-btn--sm" disabled={!redo.brief.trim()} onClick={redoScene}><span>Redo scene {i + 1}</span></button>
                            <p className="ms-hint">{continuity ? 'Scenes after this one are made again too, so the story still flows. ' : ''}Each scene made uses one video generation.</p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </RailStageInner>
        </RailStage>
        <RailBottom label="Download options" text={text} actions={extras} />
      </Rail>
    </Layout>
  );
}
