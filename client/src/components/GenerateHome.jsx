import React, { useEffect, useMemo, useState } from 'react';
import { resolveAssetUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { sceneReelApi } from '../api/resources.js';
import { SCENE_TEMPLATES } from '../constants/sceneTemplates.js';
import { getFormat } from '../constants/postFormats.js';

import hero1 from '../assets/generate-home/hero1.webp';
import hero2 from '../assets/generate-home/hero2.webp';
import hero3 from '../assets/generate-home/hero3.webp';
import hero4 from '../assets/generate-home/hero4.webp';
import finishUpImg from '../assets/generate-home/finish-up.webp';
import iconResize from '../assets/generate-home/resize.svg';
import iconSwap from '../assets/generate-home/replace.webp';
import iconText from '../assets/generate-home/text-select.svg';
import iconAdapt from '../assets/generate-home/creative-adapt.svg';
import iconConvert from '../assets/generate-home/icon-convert-video.svg';
import iconSparkle from '../assets/generate-home/sparkle.svg';
import iconClock from '../assets/generate-home/icon-clock.svg';
import iconArrow from '../assets/generate-home/arrow-right.svg';
import iconChevron from '../assets/generate-home/icon-chevron-right.svg';

/* ------------------------------------------------------------------ */
/* Active task (what the "Finish Up" card resumes)                      */
/* ------------------------------------------------------------------ */

// Same step sets the Stepper shows for each flow.
const STEP_SETS = {
  new: [['generate', 'Brief'], ['designs', 'Generate designs'], ['refine', 'Refine options'], ['modify', 'Modify asset'], ['publish', 'Publish']],
  adaptation: [['generate', 'Upload'], ['generate', 'Review'], ['generate', 'Choose size'], ['generate', 'Download']],
  resize: [['generate', 'Upload'], ['generate', 'Select size'], ['generate', 'Download']],
  hero: [['generate', 'Upload'], ['generate', 'Review'], ['generate', 'Choose size'], ['generate', 'Download']],
  headline: [['generate', 'Upload'], ['generate', 'Review'], ['generate', 'Choose size'], ['generate', 'Download']],
  convert: [['generate', 'Upload'], ['generate', 'Motion'], ['generate', 'Video size'], ['generate', 'Download video']]
};
const STEP_ROUTES = { generate: '/generate', designs: '/designs', refine: '/refine', modify: '/modify', publish: '/publish' };

export const FLOW_NAMES = {
  new: 'New Creative',
  adaptation: 'Creative Edit',
  resize: 'Size Adapt',
  hero: 'Subject Swap',
  headline: 'Headline Switch',
  convert: 'Convert to Video',
  multiscene: 'Multi-scene Video'
};

function selectedDesign(post) {
  return post?.designs?.find((d) => d.label === post.selectedVariantLabel);
}

// Has this task already produced its output? Then there is nothing left to "finish up".
function outputGenerated(post, type) {
  const sel = selectedDesign(post);
  if (type === 'resize') return Boolean(sel?.formatVariants?.some((v) => v.imageUrl));
  if (type === 'convert') return Boolean(post?.designs?.some((d) => d.videoJobs?.some((v) => v.videoUrl)));
  return Boolean(sel?.imageUrl);
}

/**
 * The one task the person can pick back up, or null.
 *  - a saved post that is not published yet -> resumes at the furthest step it has reached
 *  - otherwise a New Creative brief that is open but not saved yet -> resumes the brief on /generate
 */
export function getActiveTask({ post, creativeType, stepIndex = 0, customNames = {} }) {
  const type = post?._id && post.creativeType ? post.creativeType : creativeType;
  if (!type) return null;
  if (post?._id && post.status === 'published') return null;

  const custom = typeof type === 'string' && type.startsWith('custom:');
  const name = custom ? customNames[type.slice(7)] || 'Custom creative' : FLOW_NAMES[type] || 'Creative';
  const steps = STEP_SETS[type];

  if (post?._id && steps) {
    if (outputGenerated(post, type)) return null;
    const sel = selectedDesign(post);
    const hasImage = Boolean(sel?.imageUrl || sel?.background);
    if (type === 'convert') {
      // Convert to Video lives entirely on /generate: Upload -> Motion -> Video size -> Download video.
      const idx = hasImage ? 1 : 0;
      if (!idx) return null; // still on step 1 (Upload): nothing to finish up yet
      return {
        type, name, saved: true, stepIndex: idx, stepCount: steps.length, stepLabel: steps[idx][1],
        route: '/generate', thumb: sel?.imageUrl ? resolveAssetUrl(sel.imageUrl) : '', detail: ''
      };
    }
    if (type === 'resize') {
      // Size Adapt lives entirely on /generate: Upload -> Select Size -> Download.
      const idx = !hasImage ? 0 : sel.formatVariants?.some((v) => v.imageUrl) ? 2 : 1;
      if (!idx) return null; // still on step 1 (Upload)
      let fmt = '';
      try { const f = getFormat(post.mediums?.[0]); fmt = f ? `${f.platform} ${f.label}` : ''; } catch { /* unknown */ }
      return {
        type, name, saved: true, stepIndex: idx, stepCount: steps.length, stepLabel: steps[idx][1],
        route: '/generate', thumb: sel?.imageUrl ? resolveAssetUrl(sel.imageUrl) : '', detail: ''
      };
    }
    if (type === 'hero' || type === 'headline' || type === 'adaptation') {
      // These short flows live on /generate: Upload -> Review -> Choose size -> Download.
      const idx = hasImage ? 1 : 0;
      if (!idx) return null; // still on step 1 (Upload)
      return {
        type, name, saved: true, stepIndex: idx, stepCount: steps.length, stepLabel: steps[idx][1],
        route: '/generate', thumb: sel?.imageUrl ? resolveAssetUrl(sel.imageUrl) : '', detail: ''
      };
    }
    const key = type === 'new' ? (hasImage ? 'modify' : 'designs') : hasImage ? 'modify' : 'generate';
    const idx = Math.max(0, steps.findIndex((s) => s[0] === key));
    let format = '';
    try { const f = getFormat(post.mediums?.[0]); format = f ? `${f.platform} ${f.label}` : ''; } catch { /* unknown format id */ }
    return {
      type, name, saved: true,
      stepIndex: idx, stepCount: steps.length, stepLabel: steps[idx][1],
      route: STEP_ROUTES[key],
      thumb: sel?.imageUrl ? resolveAssetUrl(sel.imageUrl) : '',
      detail: [post.purpose, format].filter(Boolean).join(' · ')
    };
  }

  // A brief that was started but not saved as a post yet. (The quick-fix editors and custom features keep nothing
  // until they create a post, so there is nothing to resume for them.)
  if (type !== 'new') return null;
  if (!(stepIndex > 0)) return null; // still on the first brief screen: nothing to finish up yet
  return {
    type, name, saved: false,
    stepIndex: 0, stepCount: steps.length,
    stepLabel: `Brief, step ${stepIndex + 1}`,
    route: '/generate', thumb: '', detail: ''
  };
}

/* ------------------------------------------------------------------ */
/* UI                                                                   */
/* ------------------------------------------------------------------ */

const HEROES = [hero1, hero2, hero3, hero4];

// A different hero on every visit, never the same one twice in a row.
function pickHero() {
  const key = 'automatr:lastHero';
  let last = -1;
  try { last = parseInt(localStorage.getItem(key), 10); } catch { /* storage blocked */ }
  const pool = HEROES.map((_, i) => i).filter((i) => i !== last);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem(key, String(pick)); } catch { /* storage blocked */ }
  return HEROES[pick];
}

function Cta({ children, muted }) {
  return (
    <span className={`gh-cta ${muted ? 'gh-cta--muted' : ''}`.trim()}>
      <span>{children}</span>
      <img src={iconArrow} alt="" width="24" height="24" />
    </span>
  );
}

function ActionCard({ className = '', onActivate, disabled, label, children }) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={`gh-card ${className} ${disabled ? 'is-disabled' : ''}`.trim()}
      onClick={() => !disabled && onActivate()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onActivate(); }
      }}
    >
      {children}
    </div>
  );
}

const QUICK_FIXES = [
  { type: 'resize', icon: iconResize, title: 'Size Adapt', text: 'Adjust the size but keep the creative intact.', cta: 'Adapt now' },
  { type: 'hero', icon: iconSwap, title: 'Subject Swap', text: 'Swap the subject in the creative without changing the message.', cta: 'Swap now' },
  { type: 'headline', icon: iconText, title: 'Headline Switch', text: 'Switch up the headline and leave everything else as is.', cta: 'Switch now' },
  { type: 'adaptation', icon: iconAdapt, title: 'Creative Edit', text: 'Fine tune a creative in simple steps - Image, size & headline.', cta: 'Edit now' },
  { type: 'convert', icon: iconConvert, title: 'Convert to Video', text: 'Transform an image into a video in a simple 3 step process.', cta: 'Convert now' }
];

// "Made for You" holds the flows built for this workspace (deployed from Brief Studio) and the Multi-scene Video creator with its templates; "Repeat Flow" stays empty until it ships.
const TABS = [
  { id: 'quick', label: 'Quick Fixes' },
  { id: 'made', label: 'Made for You' },
  { id: 'repeat', label: 'Repeat Flow', soon: true }
];

const when = (iso) => { try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } };

// Made for You: the flows deployed to this workspace from Brief Studio, then (when switched on) multi-scene video from scratch or a template, and earlier reels.
function MadeForYou({ onStart, viewOnly, customFeatures = [], showMultiScene = false }) {
  const [reels, setReels] = useState(null);
  useEffect(() => {
    if (!showMultiScene) return undefined;
    let live = true;
    sceneReelApi.list().then((d) => live && setReels(d.reels || [])).catch(() => live && setReels([]));
    return () => { live = false; };
  }, [showMultiScene]);
  const blank = { id: 'blank', title: 'Multi-scene Video', text: 'Plan a video scene by scene: a brief, a starting image, a length and a transition for each. 15 to 60 seconds.', cta: 'Create now' };
  return (
    <>
      {customFeatures.map((cf) => (
        <ActionCard key={cf.id} className="gh-card--fix" disabled={viewOnly} onActivate={() => onStart(`custom:${cf.id}`)} label={cf.name}>
          <div className="gh-fix">
            <span className="gh-fix__icon gh-fix__icon--glyph" aria-hidden="true">{cf.icon || '✨'}</span>
            <div className="gh-fix__text">
              <h3>{cf.name}</h3>
              <p className="gh-body">{cf.description || 'A custom creative set up for your workspace.'}</p>
            </div>
          </div>
          <Cta>Start now</Cta>
        </ActionCard>
      ))}
      {showMultiScene && (
      <>
      <ActionCard className="gh-card--fix" disabled={viewOnly} onActivate={() => onStart('multiscene')} label="Multi-scene Video, create now">
        <div className="gh-fix">
          <img className="gh-fix__icon" src={iconConvert} alt="" />
          <div className="gh-fix__text"><h3>{blank.title}</h3><p className="gh-body">{blank.text}</p></div>
        </div>
        <Cta>{blank.cta}</Cta>
      </ActionCard>
      {SCENE_TEMPLATES.map((t) => (
        <ActionCard key={t.id} className="gh-card--fix" disabled={viewOnly} onActivate={() => onStart('multiscene', { template: t })} label={`${t.title}, use template`}>
          <div className="gh-fix">
            <img className="gh-fix__icon" src={iconSparkle} alt="" />
            <div className="gh-fix__text">
              <h3>{t.title}</h3>
              <p className="gh-body">{t.text}</p>
              <p className="gh-reel__meta">{t.total}s · {t.scenes.length} scenes · {t.aspect === '16:9' ? 'Horizontal' : 'Vertical'}</p>
            </div>
          </div>
          <Cta>Use template</Cta>
        </ActionCard>
      ))}
      {reels && reels.length > 0 && <p className="gh-made-label">Your earlier multi-scene videos</p>}
      {(reels || []).map((r) => (
        <ActionCard key={r.id} className="gh-card--fix" disabled={viewOnly} onActivate={() => onStart('multiscene', { reel: r })} label={`Open ${r.title}`}>
          <div className="gh-fix">
            <img className="gh-fix__icon" src={iconClock} alt="" />
            <div className="gh-fix__text gh-reel">
              <h3>{r.title}</h3>
              <span className="gh-reel__meta">
                <span className={`gh-reel__badge${r.status === 'failed' ? ' is-failed' : ''}`}>{r.status === 'completed' ? 'Ready' : r.status === 'running' ? 'Being made' : 'Needs another try'}</span>
                {r.scenes.length} scenes · {when(r.updatedAt)}
              </span>
            </div>
          </div>
          <Cta>{r.status === 'completed' ? 'Open' : 'Continue'}</Cta>
        </ActionCard>
      ))}
      </>
      )}
    </>
  );
}

export default function GenerateHome({ activeTask, customFeatures = [], onStart, onResume, viewOnly = false }) {
  const { features } = useAuth();
  const [tab, setTab] = useState('quick');
  // Made for You holds the flows deployed to this workspace and Multi-scene Video (switched on per customer). It shows when either exists.
  const tabs = features.multiSceneVideo || customFeatures.length > 0 ? TABS : TABS.filter((t) => t.id !== 'made');
  const hero = useMemo(pickHero, []);
  const task = activeTask;
  const pct = task ? Math.round(((task.stepIndex + 1) / task.stepCount) * 100) : 0;

  return (
    <div className="gh-wrap">
      {viewOnly && (
        <p className="hint" role="status" style={{ margin: '0 0 14px' }}>
          You are viewing this customer&apos;s workspace as an agency admin. Creatives can only be made by the customer&apos;s own team here.
        </p>
      )}
      <div className="gh">
        <div className="gh__features">
          {/* New Creative: the existing brief-to-publish flow, unchanged */}
          <ActionCard className={`gh-card--feature ${task ? '' : 'gh-card--solo'}`.trim()} disabled={viewOnly} onActivate={() => onStart('new')} label="New Creative, start here">
            <div className="gh-feature">
              <div className="gh-feature__text">
                <p className="gh-body">Start with a fresh idea</p>
                <div className="gh-feature__title">
                  <img src={iconSparkle} alt="" width="28" height="28" />
                  <h2>New Creative</h2>
                </div>
                <p className="gh-body">Automatr helps you whip up different copy ideas and lets you check out, compare, and tweak image options before you hit publish.</p>
                <Cta>Start here</Cta>
              </div>
              <div className="gh-feature__media"><div className="gh-feature__image"><img src={hero} alt="" /></div></div>
            </div>
          </ActionCard>

          {/* Finish Up: resumes the active task. Hidden when nothing is in progress (New Creative then stretches). */}
          {task && (
          <ActionCard
            className="gh-card--feature"
            disabled={!task || viewOnly}
            onActivate={() => onResume(task)}
            label={task ? `Continue ${task.name}` : 'Finish Up, nothing in progress'}
          >
            <div className="gh-feature">
              <div className="gh-feature__text">
                <p className="gh-body">Pick up right where you left</p>
                <div className="gh-feature__title">
                  <img src={iconClock} alt="" width="18" height="18" />
                  <h2>Finish Up</h2>
                </div>
                {task ? (
                  <>
                    <div className="gh-task">
                      <span className="gh-task__name">{task.name}</span>
                      <span className="gh-task__step">
                        {task.saved ? `Step ${task.stepIndex + 1} of ${task.stepCount} · ${task.stepLabel}` : task.stepLabel}
                      </span>
                      {task.detail && <span className="gh-task__detail">{task.detail}</span>}
                      {task.saved && (
                        <span className="gh-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Task progress">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                      )}
                    </div>
                    <Cta>Continue</Cta>
                  </>
                ) : (
                  <>
                    <p className="gh-body">Nothing in progress right now. Start a creative and it will wait for you here.</p>
                    <Cta muted>No active task</Cta>
                  </>
                )}
              </div>
              <div className="gh-feature__media">
                <div className="gh-feature__image">
                  <img src={task?.thumb || finishUpImg} alt="" />
                </div>
              </div>
            </div>
          </ActionCard>
          )}
        </div>

        <section className="gh-quick">
          <div className="gh-tabs" role="tablist" aria-label="Shortcuts">
            {tabs.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`gh-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`gh-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={`gh-tab${t.soon ? ' gh-tab--soon' : ''}`}
                disabled={Boolean(t.soon)}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
                  if (n === null) return;
                  e.preventDefault();
                  const next = tabs[(n + tabs.length) % tabs.length];
                  setTab(next.id);
                  document.getElementById(`gh-tab-${next.id}`)?.focus();
                }}
              >
                <img src={iconChevron} alt="" width="5" height="8" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {tab === 'made' && (
            <div className="gh-panel" role="tabpanel" id="gh-panel-made" aria-labelledby="gh-tab-made">
              <MadeForYou onStart={onStart} viewOnly={viewOnly} customFeatures={customFeatures} showMultiScene={Boolean(features.multiSceneVideo)} />
            </div>
          )}
          {tab !== 'quick' && tab !== 'made' && (
            <div className="gh-panel" role="tabpanel" id={`gh-panel-${tab}`} aria-labelledby={`gh-tab-${tab}`}>
              <p className="gh-empty">Nothing here yet.</p>
            </div>
          )}
          <div className="gh-panel" role="tabpanel" id="gh-panel-quick" aria-labelledby="gh-tab-quick" hidden={tab !== 'quick'}>
            {QUICK_FIXES.map((q) => (
              <ActionCard key={q.type} className="gh-card--fix" disabled={viewOnly} onActivate={() => onStart(q.type)} label={`${q.title}, ${q.cta}`}>
                <div className="gh-fix">
                  <img className="gh-fix__icon" src={q.icon} alt="" />
                  <div className="gh-fix__text">
                    <h3>{q.title}</h3>
                    <p className="gh-body">{q.text}</p>
                  </div>
                </div>
                <Cta>{q.cta}</Cta>
              </ActionCard>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
