import React, { useEffect, useRef, useState } from 'react';
import SizePicker from './flow/SizePicker.jsx';
import SuggestLink from './SuggestLink.jsx';
import PanelArt from './flow/PanelArt.jsx';
import { AiErrorNotice, CostTag } from './ui.jsx';
import { resolveAssetUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { briefExamples } from '../utils/briefExamples.js';
import { getFormat, isCarouselFormat } from '../constants/postFormats.js';
import iconArrowWhite from '../assets/size-adapt/icon-arrow-right-white.svg';
import iconSparkleWhite from '../assets/size-adapt/icon-sparkle-white.svg';
import '../styles/new-creative-flow.css';

// New Creative, screens 1 and 2 of the seven-step journey:
//   01 Purpose & brief  - purpose, size, context in brief, key message
//   02 Visual & style   - describe the visual, mood, style (+ reference images), lighting, people, brand assets
// Both sit in the same two-column panel: the questions on the left, a live preview of the creative so far on the right.
// Screen 3 (Creative directions) is the copy-directions step on /designs.

const CONTEXT_TAG = 'Context: ';
const VISUAL_TAG = 'Visual: ';

/** The brief the server stores is one text; the two screens each own a part of it. */
export function joinBrief(context, visual) {
  const c = (context || '').trim();
  const v = (visual || '').trim();
  if (c && v) return `${CONTEXT_TAG}${c}\n\n${VISUAL_TAG}${v}`;
  if (v) return `${VISUAL_TAG}${v}`;
  return c;
}

export function splitBrief(text) {
  const t = String(text || '').trim();
  if (!t) return { context: '', visual: '' };
  const vi = t.indexOf(VISUAL_TAG);
  const hasContext = t.startsWith(CONTEXT_TAG);
  if (vi === -1) return { context: hasContext ? t.slice(CONTEXT_TAG.length).trim() : t, visual: '' };
  const before = t.slice(0, vi).trim();
  return { context: hasContext ? before.slice(CONTEXT_TAG.length).trim() : before, visual: t.slice(vi + VISUAL_TAG.length).trim() };
}

const USE_OPTIONS = {
  asset: [
    ['include', 'Reference', 'Used as a visual reference. The AI may still redraw it into the scene.'],
    ['exact', 'As it is', 'Placed exactly as it is, with no AI edits (good for logos and legal text).']
  ],
  ref: [
    ['include', 'Reference', 'Used as the real subject to depict. The AI may still redraw it into the scene.'],
    ['exact', 'As it is', 'Pasted onto the finished design completely unmodified.'],
    ['template', 'Template', 'Treated as a finished creative: layout and branding stay, only the message changes.'],
    ['style', 'Style only', 'Guides mood, palette and treatment only. The subject is not copied.']
  ]
};

/** The small "how is this used" tag on an asset row; opens a menu of choices. */
function UseTag({ value, options, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const cur = options.find((o) => o[0] === value) || options[0];
  return (
    <span className="ncf-usewrap" ref={ref}>
      <button type="button" className="ncf-usetag" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{cur[1]}</span>
        <svg viewBox="0 0 10 6" width="9" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
      </button>
      {open && (
        <div className="ncf-usemenu" role="menu">
          {options.map((o) => (
            <button key={o[0]} type="button" role="menuitemradio" aria-checked={o[0] === cur[0]} className={`ncf-usemenu__item ${o[0] === cur[0] ? 'is-on' : ''}`.trim()} onClick={() => { onPick(o[0]); setOpen(false); }}>
              <span className="ncf-usemenu__txt"><span className="ncf-usemenu__title">{o[1]}</span><span className="ncf-usemenu__desc">{o[2]}</span></span>
              <span className="ncf-usemenu__tick" />
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

const PRODUCT_LED_STYLES = ['Flat lay top-down', 'Studio product photography', 'Architectural / geometric', 'Bold graphic / typographic'];
const MAX_MOODS = 3;

function Pills({ items, isOn, onPick, role = 'group', label }) {
  return (
    <div className="ncf-pills" role={role} aria-label={label}>
      {items.map((x) => {
        const on = isOn(x);
        return (
          <button
            key={x}
            type="button"
            className="ncf-pill"
            {...(role === 'radiogroup' ? { role: 'radio', 'aria-checked': on } : { 'aria-pressed': on })}
            onClick={() => onPick(x)}
          >
            {x}
          </button>
        );
      })}
    </div>
  );
}

function Head({ id, children, optional, tools }) {
  return (
    <div className="ncf-group__head">
      <p className="ncf-label ncf-label--lg" id={id}>{children}{optional ? <> <span className="ncf-optional">{optional}</span></> : null}</p>
      {tools ? <div className="ncf-group__tools">{tools}</div> : null}
    </div>
  );
}

function SuggestNote({ s, section }) {
  return (
    <>
      {s.suggestErr.section === section && <AiErrorNotice error={s.suggestErr.error} />}
      {s.suggestNote.section === section && s.suggestNote.text && !s.suggestErr.error && <p className="ncf-rationale">{s.suggestNote.text}</p>}
    </>
  );
}

/** One suggested option, shown under the box as a card. Clicking it fills the box. */
function IdeaCard({ text, onUse, why }) {
  if (!text) return null;
  return (
    <div className="ncf-ideas">
      <button type="button" className="ncf-idea" onClick={onUse}>{text}</button>
      {why ? <p className="ncf-idea__why">{why}</p> : null}
    </div>
  );
}

function ratioOf(fmt) {
  const m = String(fmt?.ratio || '').split(':').map(Number);
  return m.length === 2 && m[0] > 0 && m[1] > 0 ? m[0] / m[1] : 0;
}
function cut(t, n) {
  const x = String(t || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? `${x.slice(0, n - 1).trim()}…` : x;
}

/** The live preview frame on the dotted stage: a small square until a size is chosen, then that size, collecting a chip per decision. */
function PreviewFrame({ s }) {
  const fmt = s.mediums[0] ? getFormat(s.mediums[0]) : null;
  const ar = ratioOf(fmt);
  const sized = Boolean(fmt && ar);
  const purpose = s.purpose && s.purpose !== '__other' ? s.purpose : '';
  const picked = s.assets.filter((a) => s.selectedAssets.has(a._id) && a.mimeType?.startsWith('image/'));
  const thumbs = [
    ...picked.map((a) => ({ src: resolveAssetUrl(a.url), name: a.originalName })),
    ...s.stagedReferences.map((r) => ({ src: r.previewUrl, name: r.file?.name || 'Reference' }))
  ].filter((t) => t.src);
  const label = [purpose && `Purpose ${purpose}`, sized && `${fmt.platform} ${fmt.label}`, s.primaryMessage.trim() && 'key message', s.visualNote.trim() && 'visual'].filter(Boolean).join(', ');
  return (
    <div className="rail__stage" role="img" aria-label={label ? `Preview of your creative so far: ${label}` : 'Preview of your creative so far (empty)'}>
      <div className={`frame${sized ? '' : ' frame--default'}`} style={{ '--ar': sized ? ar : 1 }}>
        <div className="frame__chips">
          {purpose && <span className="frame__chip frame__chip--blue"><b>Purpose</b> {purpose}</span>}
          {sized && <span className="frame__chip frame__chip--blue">{fmt.platform} · {fmt.label}</span>}
          {s.primaryMessage.trim() && <span className="frame__chip frame__chip--grey"><b>Key message</b> {cut(s.primaryMessage, 48)}</span>}
          {s.visualNote.trim() && <span className="frame__chip frame__chip--grey"><b>Visual</b> {cut(s.visualNote, 48)}</span>}
          {s.moodTags.map((m) => <span key={m} className="frame__chip frame__chip--mood">{m}</span>)}
          {s.styleReferences.map((m) => <span key={m} className="frame__chip frame__chip--mood">{m}</span>)}
        </div>
        {thumbs.length > 0 && (
          <div className="frame__thumbs">
            {thumbs.map((t, i) => <img key={i} src={t.src} alt={t.name || ''} title={t.name || ''} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function useExamples(s) {
  const { user } = useAuth();
  return briefExamples({ industry: user?.company?.industry, brandName: user?.company?.name, followBrand: s.followBrand });
}

function PurposeScreen({ s }) {
  const ex = useExamples(s);
  const fmt = s.mediums[0] ? getFormat(s.mediums[0]) : null;
  const otherSelected = s.purposeIsOther;
  const extraSizes = s.otherFormats.map((f) => ({
    id: f.id,
    platform: f.platform === 'X' ? 'X (Twitter)' : f.platform,
    label: `${f.isVideo ? '🎥 ' : ''}${f.label} (${f.ratio})`
  }));
  return (
    <>
      <p className="sa-kicker">01 / Purpose &amp; brief</p>
      <h2 className="sa-heading">What are we creating?</h2>
      <p className="ncf-lede">Choose what this creative is for, add some context and the key message if you like.</p>

      <section className="ncf-group ncf-group--box" aria-labelledby="ncf-purpose-label">
        <label className="ncf-label ncf-label--lg" id="ncf-purpose-label" htmlFor="ncf-purpose">What is the purpose of this creative?</label>
        <select
          id="ncf-purpose"
          className="sa-select"
          value={otherSelected ? '__other' : s.purpose}
          onChange={(e) => s.pickPurpose(e.target.value)}
        >
          <option value="" disabled>Choose a purpose</option>
          {s.purposes.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="__other">Something else…</option>
        </select>
        {otherSelected && (
          <input
            className="ncf-input"
            type="text"
            maxLength={60}
            placeholder={ex.purposeOther}
            aria-label="Describe the purpose"
            value={s.purposeOther}
            autoFocus
            onChange={(e) => s.setPurposeOther(e.target.value)}
          />
        )}
      </section>

      <section className="ncf-group ncf-group--box" aria-labelledby="ncf-size-label">
        <p className="ncf-label ncf-label--lg" id="ncf-size-label">Size</p>
        <div className="ncf-sizepane">
          {/* One pair of dropdowns: platform, then size. Carousel and video placements sit in the size list under "Carousel and video". */}
          <SizePicker
            mode="image"
            platform={s.pendingPlatform}
            formatId={s.pendingFormatId}
            onChange={s.onSizeChange}
            extraSizes={extraSizes}
            idPrefix="brief-size"
          />
        </div>
        {!fmt && <p className="ncf-note">Choose a platform, then a size. This is your master creative, made at the right size for that spot. You can port it to other sizes later.</p>}
        {fmt?.isVideo && (
          <p className="ncf-note">
            {fmt.platform} {fmt.label} is a video format ({fmt.videoAspectRatio}, up to {fmt.maxDurationSeconds}s, {fmt.recommendedDurationSeconds}s recommended).
            No still image is generated for it: once you have picked a direction, use “Generate video” there.
          </p>
        )}
        {fmt && isCarouselFormat(s.mediums[0]) && (
          <div>
            <label className="ncf-label" htmlFor="ncf-slides">Number of slides</label>
            <input
              id="ncf-slides"
              className="ncf-input"
              type="number"
              min={fmt.minSlides}
              max={fmt.maxSlides}
              value={s.slideCount}
              onChange={(e) => s.setSlideCountClamped(e.target.value)}
            />
            <p className="ncf-note" style={{ marginTop: 6 }}>
              {fmt.notSwipeable
                ? `X shows up to ${fmt.maxSlides} images as a grid, not a swipe-through carousel.`
                : `Between ${fmt.minSlides} and ${fmt.maxSlides} slides. Each gets a distinct role so the set reads as a sequence.`}
            </p>
          </div>
        )}
      </section>

      <section className="ncf-group ncf-group--card" aria-labelledby="ncf-brief-label">
        <div className="ncf-group__head">
          <label className="ncf-label ncf-label--lg" id="ncf-brief-label" htmlFor="ncf-brief">Context in brief <span className="ncf-optional">(optional)</span></label>
          <span className="ncf-count" aria-live="off">{s.contextNote.length} / 600</span>
        </div>
        <textarea
          id="ncf-brief"
          className="ncf-textarea"
          maxLength={600}
          rows={5}
          placeholder={ex.context}
          value={s.contextNote}
          onChange={(e) => s.setContextNote(e.target.value)}
        />
        <div><SuggestLink onClick={() => s.suggestSection('brief')} loading={s.suggestBusy === 'brief'} improve={Boolean(s.contextNote.trim())} label="Suggest a brief" /></div>
        <IdeaCard text={s.briefIdea} onUse={s.applyBriefIdea} why={s.suggestNote.section === 'brief' && !s.suggestErr.error ? s.suggestNote.text : ""} />
        {s.suggestErr.section === 'brief' && <AiErrorNotice error={s.suggestErr.error} />}
      </section>

      <section className="ncf-group ncf-group--card" aria-labelledby="ncf-key-label">
        <div className="ncf-group__head">
          <label className="ncf-label ncf-label--lg" id="ncf-key-label" htmlFor="ncf-key">Key message</label>
          <span className="ncf-count" aria-live="off">{s.primaryMessage.length} / 160</span>
        </div>
        <textarea
          id="ncf-key"
          className="ncf-textarea"
          maxLength={160}
          rows={3}
          style={{ minHeight: 72 }}
          placeholder={ex.key}
          value={s.primaryMessage}
          onChange={(e) => s.setPrimaryMessage(e.target.value)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SuggestLink onClick={s.handleSuggestMessage} loading={s.suggestingMessage} improve={Boolean(s.primaryMessage.trim())} label="Suggest a key message" />
          <CostTag estimate={s.costs?.suggestion} />
        </div>
        <IdeaCard text={s.messageIdea?.primaryMessage} onUse={s.applyMessageIdea} />
        <AiErrorNotice error={s.messageSuggestionError} />
        {s.messageSuggestionRationale && !s.messageSuggestionError && <p className="ncf-rationale">{s.messageSuggestionRationale}</p>}
      </section>

      <p className="ncf-hint" aria-live="polite">
        {s.canContinueFromPurpose ? 'Looking good. Click Continue.' : !s.purpose ? 'Choose a purpose to continue.' : 'Choose a size to continue.'}
      </p>
      <button
        type="button"
        className="sa-btn sa-btn--primary sa-btn--lg"
        disabled={!s.canContinueFromPurpose}
        onClick={s.goNext}
      >
        <span>Continue</span><img src={iconArrowWhite} alt="" />
      </button>
    </>
  );
}

function VisualScreen({ s }) {
  const ex = useExamples(s);
  const { peopleMode } = s;
  const [showPicker, setShowPicker] = useState(false);
  const pickedAssets = s.assets.filter((a) => s.selectedAssets.has(a._id));
  return (
    <>
      <p className="sa-kicker">02 / Visual &amp; style</p>
      <h2 className="sa-heading">How should it look?</h2>
      <p className="ncf-lede">Tell us what the image should show, fine-tune the look, and add any assets or references.</p>

      <section className="ncf-group ncf-group--card" aria-labelledby="ncf-visual-label">
        <div className="ncf-group__head">
          <label className="ncf-label ncf-label--lg" id="ncf-visual-label" htmlFor="ncf-visual">Describe the visual</label>
          <span className="ncf-count" aria-live="off">{s.visualNote.length} / 400</span>
        </div>
        <textarea
          id="ncf-visual"
          className="ncf-textarea"
          maxLength={400}
          rows={4}
          placeholder={ex.visual}
          value={s.visualNote}
          onChange={(e) => s.setVisualNote(e.target.value)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SuggestLink onClick={() => s.suggestSection('visual')} loading={s.suggestBusy === 'visual'} improve={Boolean(s.visualNote.trim())} label="Suggest an image description" />
          <CostTag estimate={s.costs?.suggestion} />
        </div>
        <SuggestNote s={s} section="visual" />
      </section>

      <section className="ncf-group ncf-group--box" aria-labelledby="ncf-mood-label">
        <Head id="ncf-mood-label" optional={`(pick up to ${MAX_MOODS})`} tools={<SuggestLink onClick={() => s.suggestSection('mood')} loading={s.suggestBusy === 'mood'} label="Suggest moods" />}>
          Mood or tone
        </Head>
        <Pills
          items={s.moodOptions}
          label="Mood or tone"
          isOn={(m) => s.moodTags.includes(m)}
          onPick={(m) => s.toggleMood(m, MAX_MOODS)}
        />
        <SuggestNote s={s} section="mood" />
      </section>

      <section className="ncf-group ncf-group--box" aria-labelledby="ncf-style-label">
        <Head id="ncf-style-label" tools={<SuggestLink onClick={() => s.suggestSection('style')} loading={s.suggestBusy === 'style'} label="Suggest visual styles" />}>
          Visual style reference
        </Head>
        <Pills
          items={s.styleOptions}
          role="radiogroup"
          label="Visual style reference"
          isOn={(x) => s.styleReferences.includes(x)}
          onPick={s.pickStyle}
        />
        <SuggestNote s={s} section="style" />

      </section>

      <section className="ncf-group ncf-group--box" aria-labelledby="ncf-use-label">
        <Head id="ncf-use-label" optional="(optional)">Assets or references</Head>
        <p className="ncf-note">Add brand assets, product photos or reference images, then choose how each one is used.</p>
        {s.subBrandsOn && (
          <div className="ncf-subbrand">
            <label className="ncf-label" htmlFor="ncf-subbrand">Brand</label>
            <select id="ncf-subbrand" className="ncf-input" value={s.subBrandChoice} onChange={(e) => s.setSubBrandChoice(e.target.value)}>
              <option value="auto">Auto-detect from my brief</option>
              <option value="main">Main brand</option>
              {s.subBrands.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
            <small className="ncf-note">
              {s.subBrandChoice === 'auto'
                ? (s.activeSub ? `Detected: ${s.activeSub.name}. Its brand guideline and assets are used.` : 'No sub-brand spotted yet. The main brand is used unless your brief names one.')
                : s.subBrandChoice === 'main' ? 'Using the main brand guideline.' : 'Using this sub-brand’s guideline and assets.'}
            </small>
          </div>
        )}

        {(pickedAssets.length > 0 || s.stagedReferences.length > 0) && (
          <div className="ncf-useassets">
            {pickedAssets.map((a) => (
              <div key={a._id} className="ncf-useasset">
                <span className="ncf-useasset__thumb">{a.mimeType?.startsWith('image/') ? <img src={resolveAssetUrl(a.url)} alt="" /> : null}</span>
                <span className="ncf-useasset__name" title={a.originalName}>{a.originalName}</span>
                <UseTag
                  value={s.exactAssets.has(a._id) ? 'exact' : 'include'}
                  options={USE_OPTIONS.asset}
                  onPick={(m) => { if ((m === 'exact') !== s.exactAssets.has(a._id)) s.toggleExactAsset(a._id, { stopPropagation() {} }); }}
                />
                <button type="button" className="ncf-useasset__x" aria-label={`Remove ${a.originalName}`} onClick={() => s.toggleAsset(a._id)}>&times;</button>
              </div>
            ))}
            {s.stagedReferences.map((r, i) => (
              <div key={`ref-${i}`} className="ncf-useasset" title={r.credit || undefined}>
                <span className="ncf-useasset__thumb"><img src={r.previewUrl} alt="" /></span>
                <span className="ncf-useasset__name">{r.file?.name || 'Reference'}</span>
                <UseTag value={r.exact ? 'exact' : r.mode} options={USE_OPTIONS.ref} onPick={(m) => s.setStagedMode(i, m)} />
                <button type="button" className="ncf-useasset__x" aria-label="Remove reference" onClick={() => s.unstageReference(i)}>&times;</button>
              </div>
            ))}
          </div>
        )}

        <div className="ncf-ref__row">
          <button type="button" className="sa-btn sa-btn--white sa-btn--sm" aria-expanded={showPicker} onClick={() => setShowPicker((v) => !v)}>
            <span>{showPicker ? 'Hide brand assets' : 'From brand assets'}</span>
          </button>
          <button type="button" className="sa-btn sa-btn--white sa-btn--sm" onClick={s.openReferencePicker}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
            <span>Upload</span>
          </button>
          {s.stockConfigured && (
            <button type="button" className="sa-btn sa-btn--white sa-btn--sm" onClick={() => s.setShowStockSearch((v) => !v)}>
              <span>{s.showStockSearch ? 'Hide stock photos' : 'Search stock photos'}</span>
            </button>
          )}
        </div>

        {showPicker && (
          <div className="ncf-assets">
            {s.assets.length === 0 && <p className="ncf-empty" style={{ gridColumn: '1 / -1' }}>No brand assets yet. Add some on Brand Assets.</p>}
            {s.assets.map((a) => {
              const on = s.selectedAssets.has(a._id);
              return (
                <div key={a._id} className={`ncf-asset ${on ? 'is-on' : ''}`.trim()}>
                  <button type="button" className="ncf-asset__btn" aria-pressed={on} onClick={() => s.toggleAsset(a._id)}>
                    <span className="ncf-asset__thumb" style={a.mimeType?.startsWith('image/') ? { backgroundImage: `url(${resolveAssetUrl(a.url)})` } : undefined}>
                      <span className="ncf-asset__tick" />
                    </span>
                    <span className="ncf-asset__name" title={a.originalName}>{a.originalName}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {s.showStockSearch && (
          <div className="ncf-stock">
            <form className="ncf-stock__form" onSubmit={s.handleStockSearch}>
              <input className="ncf-input" type="text" placeholder={ex.stock} value={s.stockQuery} onChange={(e) => s.setStockQuery(e.target.value)} />
              <button type="submit" className="sa-btn sa-btn--white sa-btn--sm" disabled={s.stockSearching}><span>{s.stockSearching ? 'Searching…' : 'Search'}</span></button>
            </form>
            {s.stockError && <p className="ncf-note is-error">{s.stockError}</p>}
            {s.stockResults.length > 0 && (
              <>
                <p className="ncf-note">Free stock photos via Pexels. They are added with the option chosen above.</p>
                <div className="ncf-stock__grid">
                  {s.stockResults.map((photo, i) => (
                    <div
                      key={photo.id}
                      className="ncf-stock__tile"
                      role="button"
                      tabIndex={0}
                      title={`Photo by ${photo.photographer}`}
                      style={{ backgroundImage: `url(${photo.previewUrl})` }}
                      onClick={() => s.openStockLightbox(i)}
                      onKeyDown={(e) => e.key === 'Enter' && s.openStockLightbox(i)}
                    >
                      <button
                        type="button"
                        className={`ncf-stock__add ${s.addingStockId === photo.id ? 'is-busy' : ''}`.trim()}
                        aria-label="Quick-add this photo"
                        disabled={s.addingStockId === photo.id}
                        onClick={(e) => { e.stopPropagation(); s.handleAddStockPhoto(photo); }}
                      >
                        {s.addingStockId === photo.id ? '…' : '+'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <label className="ncf-checkrow">
          <input type="checkbox" checked={s.useBrandStyle} onChange={(e) => s.setUseBrandStyle(e.target.checked)} />
          <span>
            Also blend in my brand’s analysed style
            <small>Off by default. This brief then only uses the styling you pick above.</small>
          </span>
        </label>
      </section>

      <section className="ncf-group ncf-group--box" aria-labelledby="ncf-look-label">
        <Head id="ncf-look-label" tools={<SuggestLink onClick={() => s.suggestSection('look')} loading={s.suggestBusy === 'look'} label="Suggest lighting and composition" />}>
          Lighting and composition
        </Head>
        <div className="ncf-pair">
          <div>
            <label className="ncf-label" htmlFor="ncf-lighting">Lighting</label>
            <select id="ncf-lighting" className="sa-select" value={s.lightingStyle} onChange={(e) => s.setLightingStyle(e.target.value)}>
              <option value="">No preference</option>
              {s.lightingOptions.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="ncf-label" htmlFor="ncf-composition">Composition</label>
            <select id="ncf-composition" className="sa-select" value={s.compositionStyle} onChange={(e) => s.setCompositionStyle(e.target.value)}>
              <option value="">No preference</option>
              {s.compositionOptions.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <SuggestNote s={s} section="look" />
      </section>

      <section className="ncf-group ncf-group--box" aria-labelledby="ncf-people-label">
        <Head id="ncf-people-label" tools={<>
          <SuggestLink onClick={() => s.suggestSection('people')} loading={s.suggestBusy === 'people'} label="Suggest people settings" />
          <button type="button" className="ncf-switch" role="switch" aria-checked={peopleMode === 'include'} aria-labelledby="ncf-people-label" onClick={() => s.setPeopleMode(peopleMode === 'include' ? 'auto' : 'include')}>
            <span className="ncf-switch__track"><span className="ncf-switch__knob" /></span>
            <span>{peopleMode === 'include' ? 'On' : 'Off'}</span>
          </button>
        </>}>
          People in the image
        </Head>
        <p className="ncf-note">AI-generated, fictional people only. Never a real or recognisable person.{peopleMode !== 'include' ? ' Off: the AI decides whether people suit the image.' : ''}</p>
        <SuggestNote s={s} section="people" />
        {peopleMode === 'include' && (
          <div className="ncf-people">
            <div className="ncf-people__q">
              <p className="ncf-label">How many people? <span className="ncf-optional">(optional)</span></p>
              <Pills items={s.peopleCounts} role="radiogroup" label="How many people" isOn={(c) => s.peopleCount === c} onPick={(c) => s.setPeopleCount(s.peopleCount === c ? '' : c)} />
            </div>
            <div className="ncf-people__q">
              <p className="ncf-label">Age group <span className="ncf-optional">(select all that apply)</span></p>
              <Pills items={s.peopleAges} label="Age group" isOn={(a) => s.peopleAge.includes(a)} onPick={s.togglePeopleAge} />
            </div>
            <div className="ncf-people__q">
              <p className="ncf-label">Gender <span className="ncf-optional">(tap again to clear)</span></p>
              <Pills items={s.peopleGenders} role="radiogroup" label="Gender" isOn={(g) => s.peopleGender === g} onPick={(g) => s.setPeopleGender(s.peopleGender === g ? '' : g)} />
            </div>
            <div className="ncf-people__q">
              <p className="ncf-label">Ethnicity <span className="ncf-optional">(Indian by default, tap again to clear)</span></p>
              <Pills items={s.peopleEthnicities} role="radiogroup" label="Ethnicity" isOn={(e) => s.peopleEthnicity === e} onPick={(e) => s.setPeopleEthnicity(s.peopleEthnicity === e ? '' : e)} />
            </div>
            <div className="ncf-people__q">
              <p className="ncf-label">How should they appear? <span className="ncf-optional">(optional)</span></p>
              <Pills items={s.peopleStyles} role="radiogroup" label="How people appear" isOn={(p) => s.peopleStyle === p} onPick={(p) => s.setPeopleStyle(s.peopleStyle === p ? '' : p)} />
            </div>
            <div className="ncf-model">
              <p className="ncf-label">Your Model or Brand Ambassador <span className="ncf-optional">(optional)</span></p>
              <p className="ncf-note">Want a particular person, such as your brand ambassador? Choose one photo from your brand assets or upload one.</p>
              <div className="ncf-ref__row">
                <button type="button" className="sa-btn sa-btn--white sa-btn--sm" onClick={() => setShowPicker(true)}>
                  <span>From brand assets</span>
                </button>
                <button type="button" className="sa-btn sa-btn--white sa-btn--sm" onClick={s.openReferencePicker}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
                  <span>Upload</span>
                </button>
              </div>
              <p className="ncf-note">The photo is added to “Assets or references” above, where you can see it and remove it.</p>
            </div>
            <input
              className="ncf-input"
              type="text"
              maxLength={200}
              placeholder={ex.people}
              aria-label="Anything specific about the people"
              value={s.peopleNote}
              onChange={(e) => s.setPeopleNote(e.target.value)}
            />
            {(s.styleReferences.some((x) => PRODUCT_LED_STYLES.includes(x)) || /\b(people|person|human|faces?)\b/i.test(s.mustAvoid)) && (
              <p className="ncf-warn">Heads up: a style you picked or your “avoid” note usually means no people. People will still be added, so you may want to adjust those.</p>
            )}
          </div>
        )}
      </section>

      <section className="ncf-group ncf-group--box" aria-labelledby="ncf-constraints-label">
        <Head id="ncf-constraints-label" optional="(optional)">Anything to include or avoid?</Head>
        <div className="ncf-pair">
          <div>
            <label className="ncf-label" htmlFor="ncf-include">Must include</label>
            <input id="ncf-include" className="ncf-input" type="text" placeholder={ex.include} value={s.mustInclude} onChange={(e) => s.setMustInclude(e.target.value)} />
          </div>
          <div>
            <label className="ncf-label" htmlFor="ncf-avoid">Must avoid</label>
            <input id="ncf-avoid" className="ncf-input" type="text" placeholder={ex.avoid} value={s.mustAvoid} onChange={(e) => s.setMustAvoid(e.target.value)} />
          </div>
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={s.loading} onClick={() => s.handleGenerate()}>
          <img src={iconSparkleWhite} alt="" className="sa-btn__sm" />
          <span>{s.loading ? 'Working…' : s.hasExistingDesigns ? 'Save & continue' : 'Continue'}</span>
          <img src={iconArrowWhite} alt="" />
        </button>
        <button type="button" className="ncf-mini" onClick={s.goBack}>← Back</button>
        {s.costs && !s.hasExistingDesigns && <CostTag estimate={s.costs.caption} />}
      </div>
      <p className="ncf-note">
        {s.hasExistingDesigns
          ? 'Your existing creative directions and images are kept. “Save & continue” only updates the brief.'
          : 'Next you will see creative directions, each with a headline and post copy. Images are only generated once you choose one.'}
      </p>
      {s.hasExistingDesigns && (
        <button type="button" className="ncf-mini" disabled={s.loading} onClick={s.handleStartOver}>⟳ Start over (regenerate creative directions)</button>
      )}
    </>
  );
}

export default function NewCreativeBrief({ s }) {
  const onPurpose = s.step.key === 'purpose';
  return (
    <div className="rail">
      <PreviewFrame s={s} />
      <aside className="rail__panel" aria-label="New creative settings">
        <div className="sa-text" key={s.step.key}>
          {onPurpose ? <PurposeScreen s={s} /> : <VisualScreen s={s} />}
        </div>
        <PanelArt key={`art-${s.step.key}`} />
      </aside>
    </div>
  );
}
