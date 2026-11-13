import React, { useRef } from 'react';
import { SelBadge } from '../ui.jsx';
import { Rail, RailStage, RailPanel } from '../flow/Rail.jsx';
import { BASIC_IDEA_CATEGORIES } from './videoUtils.js';
import iconSparkle from '../../assets/video/sparkle.svg';
import iconArrow from '../../assets/video/icon-arrow-right-white.svg';

/**
 * Motion screen: "Choose how it moves". Presentational - VideoFlowScreens owns the state.
 * AI Suggestion box (blue underlined "Use this" fills in the best combination and scrolls to Continue),
 * Basic / Advanced tabs of motion ideas, an optional note, and the creative on the right.
 */
export default function VideoMotion({
  kicker, imageUrl, ideas, categories, bestCombo, selected, onToggle, onUseBest,
  status, onRetryIdeas, tab, onTab, note, onNote, onContinue, notice
}) {
  const continueRef = useRef(null);
  const loading = status === 'loading' || status === 'idle';
  const ready = status === 'ready';
  const bestTitles = (bestCombo?.ids || []).map((id) => ideas.find((i) => i.id === id)?.title).filter(Boolean);
  const countFor = (basic) => ideas.filter((i) => selected.has(i.id) && BASIC_IDEA_CATEGORIES.includes(i.category) === basic).length;
  const inTab = (cat) => (tab === 'basic') === BASIC_IDEA_CATEGORIES.includes(cat.key);
  const pickedCount = ideas.filter((i) => selected.has(i.id)).length;

  function useBest() {
    onUseBest();
    const el = continueRef.current;
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => { try { el.focus({ preventScroll: true }); } catch { /* ignore */ } }, reduce ? 0 : 500);
  }

  return (
    <Rail>
      <RailStage>
        <div className="sa-preview sa-preview--filled">
          {imageUrl ? <img src={imageUrl} alt="Your selected creative" /> : <p className="vf-canvas__empty">Select a creative on the previous screen to see it here</p>}
        </div>
      </RailStage>
      <RailPanel label="Settings">
        {notice}
        <p className="sa-kicker">{kicker}</p>
        <h2 className="sa-heading">Choose how it moves</h2>
        <p>Pick the motion ideas you like and we’ll bring your creative to life. Not sure? Start with our suggestion.</p>

        <section className="vf-best" aria-labelledby="vf-best-title">
          <div className="vf-best__head">
            <p className="vf-best__title" id="vf-best-title"><img src={iconSparkle} alt="" /><span>AI Suggestion</span></p>
            {status === 'error'
              ? <button type="button" className="vf-link" onClick={onRetryIdeas}>Try again</button>
              : <button type="button" className="vf-link" onClick={useBest} disabled={!ready || bestTitles.length === 0}>Use this</button>}
          </div>
          {loading && <p className="vf-hint" role="status">Studying your creative and thinking about how it could move…</p>}
          {status === 'error' && <p className="vf-err" role="alert">We couldn’t get a suggestion this time. You can still pick ideas below or continue for a subtle, natural motion.</p>}
          {ready && bestTitles.length > 0 && <p className="vf-best__list">{bestTitles.join(' · ')}</p>}
          {ready && bestCombo?.rationale && <p className="vf-best__why">{bestCombo.rationale}</p>}
          {ready && bestTitles.length === 0 && <p className="vf-hint">No single combination stood out. Pick any ideas below.</p>}
        </section>

        {loading && (
          <div className="vf-skel-list" aria-hidden="true">
            <div className="fx-skel vf-skel" /><div className="fx-skel vf-skel" /><div className="fx-skel vf-skel" />
          </div>
        )}

        {ready && (
          <>
            <div className="vf-tabs" role="tablist" aria-label="Motion ideas">
              {[['basic', 'Basic', countFor(true)], ['advanced', 'Advanced', countFor(false)]].map(([k, label, n]) => (
                <button key={k} type="button" role="tab" id={`vf-tab-${k}`} aria-selected={tab === k} aria-controls={`vf-panel-${k}`} className="vf-tab" onClick={() => onTab(k)}>
                  {label}{n > 0 && <span className="vf-tab__n">{n}</span>}
                </button>
              ))}
            </div>
            <div className="vf-wrap" style={{ width: '100%' }} role="tabpanel" id={`vf-panel-${tab}`} aria-labelledby={`vf-tab-${tab}`}>
              {tab === 'advanced' && <p className="vf-hint">Camera movement, depth, focus, reveals and finishing touches. Optional: skip this tab for a natural result.</p>}
              {categories.filter(inTab).map((cat) => {
                const list = ideas.filter((i) => i.category === cat.key);
                if (list.length === 0) return null;
                return (
                  <section className="vf-group" key={cat.key} aria-label={cat.label}>
                    <p className="vf-group__label">
                      {cat.key === 'text' ? 'Headline animation' : cat.label}
                      {cat.single ? <span> (pick one)</span> : null}
                    </p>
                    {cat.text && <p className="vf-hint">Video can distort lettering, so check the result.</p>}
                    <div className="vf-grid" role={cat.single ? 'radiogroup' : 'group'} aria-label={cat.label}>
                      {list.map((idea) => {
                        const on = selected.has(idea.id);
                        return (
                          <button key={idea.id} type="button" role={cat.single ? 'radio' : 'checkbox'} aria-checked={on} className={`vf-card ${on ? 'is-on' : ''}`.trim()} onClick={() => onToggle(idea)}>
                            <span className="vf-card__title">{idea.title}</span>
                            {idea.description && <span className="vf-card__desc">{idea.description}</span>}
                            {idea.intensity && <span className="vf-card__level">{idea.intensity}</span>}
                            {on && <SelBadge />}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {(ready || status === 'error') && (
          <div className="vf-note">
            <label htmlFor="vf-note">Anything else to add? <span>(optional)</span></label>
            <textarea id="vf-note" rows={3} maxLength={300} value={note} onChange={(e) => onNote(e.target.value)} placeholder="For example: Keep it calm and premium, no fast movement." />
          </div>
        )}

        <button ref={continueRef} type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={onContinue}>
          <span>Continue</span><img src={iconArrow} alt="" />
        </button>
        <p className="vf-hint" aria-live="polite">
          {pickedCount > 0
            ? `${pickedCount} idea${pickedCount === 1 ? '' : 's'} selected.`
            : 'Nothing selected yet. The video will use a subtle ambient motion unless you pick some ideas.'}
        </p>
      </RailPanel>
    </Rail>
  );
}
