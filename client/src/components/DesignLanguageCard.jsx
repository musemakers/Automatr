import React, { useEffect, useState } from 'react';
import { Card, CardHead, Btn, Chip } from './ui.jsx';
import { brandAssetsApi } from '../api/resources.js';
import { apiErrorMessage } from '../api/client.js';
import { GOOGLE_FONTS } from '../constants/googleFonts.js';

const LOGO_TYPE_LABELS = {
  wordmark: 'Wordmark',
  lettermark: 'Lettermark',
  symbol: 'Symbol / icon',
  combination: 'Combination mark',
  emblem: 'Emblem',
  'not-a-logo': 'Not a logo'
};


const ROLE_KEYS = ['primary', 'secondary', 'accent', 'neutral'];
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, lineHeight: '20px', border: '1px solid #DCDFE8', borderRadius: 10, background: '#fff', fontFamily: 'inherit' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, margin: '14px 0 6px' };
const TONE_SOURCE = { guideline: 'From your brand guideline', web: 'Found on the web', manual: 'Written by your team' };

/** Tone of voice: taken from the brand guideline, found on the web when the guideline does not state one, always editable. */
function ToneOfVoiceCard({ user, setUser }) {
  const dl = user?.brandKit?.designLanguage || {};
  const tone = (dl.voiceTone || '').trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tone);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (!editing) setDraft(tone); }, [tone, editing]);

  async function save() {
    setBusy('save'); setError('');
    try {
      const { user: updated } = await brandAssetsApi.updateDesignLanguage({ voiceTone: draft });
      setUser(updated);
      setEditing(false);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(''); }
  }
  async function research() {
    setBusy('search'); setError('');
    try {
      const { user: updated } = await brandAssetsApi.researchToneOfVoice();
      setUser(updated);
      setEditing(false);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(''); }
  }

  return (
    <Card>
      <CardHead title="Tone of voice" />
      {editing ? (
        <>
          <textarea
            style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }}
            maxLength={500}
            value={draft}
            autoFocus
            placeholder="e.g. Warm and conversational, plain-spoken, a little witty. Never salesy."
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="hint" style={{ margin: '6px 0 12px' }}>{draft.length} / 500. Every caption and headline we write for this brand follows this.</p>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <Btn variant="secondary" type="button" onClick={() => { setEditing(false); setDraft(tone); }}>Cancel</Btn>
            <Btn type="button" loading={busy === 'save'} onClick={save}>Save</Btn>
          </div>
        </>
      ) : tone ? (
        <>
          <p style={{ fontSize: 14, lineHeight: '21px', marginBottom: 8 }}>{tone}</p>
          {TONE_SOURCE[dl.voiceToneSource] && <p className="hint" style={{ marginBottom: 12 }}>{TONE_SOURCE[dl.voiceToneSource]}</p>}
          <div className="btn-row" style={{ marginTop: 0 }}>
            <Btn variant="secondary" type="button" onClick={() => setEditing(true)}>Edit</Btn>
            <Btn variant="secondary" type="button" loading={busy === 'search'} onClick={research}>Search the web again</Btn>
          </div>
        </>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 12 }}>
            {dl.lastAnalyzedAt
              ? 'Your brand guideline does not state a tone of voice. We can look up how your brand speaks on the web, or you can write it yourself.'
              : 'Taken from your brand guideline once you upload one. If it does not state a tone of voice, we look up how your brand speaks on the web. You can also write it yourself.'}
          </p>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <Btn type="button" loading={busy === 'search'} onClick={research}>Find it on the web</Btn>
            <Btn variant="secondary" type="button" onClick={() => setEditing(true)}>Write it myself</Btn>
          </div>
        </>
      )}
      {error && <p className="hint" style={{ color: '#C62828', marginTop: 10 }}>{error}</p>}
    </Card>
  );
}

/** Loads a Google font into the page so the picker can show a live preview of it. */
function useFontPreview(family) {
  useEffect(() => {
    const name = (family || '').trim();
    if (!name || !GOOGLE_FONTS.includes(name)) return undefined;
    const id = `gf-preview-${name.replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) return undefined;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}&display=swap`;
    document.head.appendChild(link);
    return undefined;
  }, [family]);
}

/**
 * A font field: type to search, pick from the full Google Fonts library (and any font installed on the server),
 * or upload a .ttf / .otf file. Any name can still be typed in by hand.
 */
function FontField({ id, label, value, onChange, onError }) {
  const [system, setSystem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const fileRef = React.useRef(null);
  useFontPreview(value);
  async function loadSystem() {
    if (system) return;
    try { setSystem((await brandAssetsApi.systemFonts()).fonts || []); } catch { setSystem([]); }
  }
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setNote(''); onError('');
    try {
      const r = await brandAssetsApi.uploadFontFile(file);
      onChange(r.family);
      setNote(`Uploaded ${r.family}. Save changes to build the font reference.`);
    } catch (err) { onError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  const q = (value || '').trim().toLowerCase();
  const exact = GOOGLE_FONTS.some((n) => n.toLowerCase() === q);
  const matches = (q && !exact) ? GOOGLE_FONTS.filter((n) => n.toLowerCase().includes(q)) : GOOGLE_FONTS;
  const sysMatches = (system || []).filter((n) => !GOOGLE_FONTS.includes(n) && (!q || exact || n.toLowerCase().includes(q)));
  const pick = (n) => { onChange(n); setOpen(false); };
  return (
    <div>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input id={id} style={inputStyle} value={value} autoComplete="off" placeholder="Search all fonts or type a name"
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => { loadSystem(); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)} />
        {open && (
          <div role="listbox" aria-label={`${label}: fonts`} style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%', marginTop: 4, maxHeight: 260, overflowY: 'auto', background: '#fff', border: '1px solid #DCDFE8', borderRadius: 10, boxShadow: '0 8px 24px rgba(20,24,40,.12)' }}>
            {sysMatches.length > 0 && <p className="hint" style={{ margin: 0, padding: '8px 12px 4px' }}>Installed on the server</p>}
            {sysMatches.map((n) => <div key={`s-${n}`} role="option" onMouseDown={(e) => { e.preventDefault(); pick(n); }} style={{ padding: '7px 12px', fontSize: 14, cursor: 'pointer' }}>{n}</div>)}
            <p className="hint" style={{ margin: 0, padding: '8px 12px 4px' }}>Google Fonts ({matches.length.toLocaleString()}{q && !exact ? ' matches' : ''})</p>
            {matches.map((n) => <div key={n} role="option" aria-selected={n === value} onMouseDown={(e) => { e.preventDefault(); pick(n); }} style={{ padding: '7px 12px', fontSize: 14, cursor: 'pointer', background: n === value ? '#EEF1FB' : undefined }}>{n}</div>)}
            {matches.length === 0 && sysMatches.length === 0 && <p className="hint" style={{ margin: 0, padding: '8px 12px 10px' }}>No match. Press away to use &ldquo;{value}&rdquo; as typed, or upload a font file.</p>}
          </div>
        )}
      </div>
      {value && GOOGLE_FONTS.includes(value.trim()) && (
        <p style={{ margin: '8px 0 0', fontSize: 20, lineHeight: '28px', fontFamily: `"${value.trim()}", sans-serif` }}>The quick brown fox jumps over the lazy dog</p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input ref={fileRef} type="file" accept=".ttf,.otf" style={{ display: 'none' }} onChange={upload} />
        <Btn variant="secondary" type="button" loading={busy} onClick={() => fileRef.current?.click()}>Upload font file</Btn>
      </div>
      {note && <p className="hint" style={{ marginTop: 4 }}>{note}</p>}
    </div>
  );
}

/** Change the headline and body fonts straight from the typography section, without opening the full editor. */
export function TypographyFontsEditor({ user, setUser, compact = false }) {
  const fonts = user?.brandKit?.fonts || {};
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState(fonts.display || '');
  const [body, setBody] = useState(fonts.body || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!open) { setDisplay(fonts.display || ''); setBody(fonts.body || ''); } }, [fonts.display, fonts.body, open]);
  async function save() {
    setSaving(true); setError('');
    try {
      const { user: updated } = await brandAssetsApi.updateBrandKit({ displayFont: display.trim() || undefined, bodyFont: body.trim() || undefined });
      setUser(updated);
      setOpen(false);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setSaving(false); }
  }
  if (!open) {
    return (
      <div style={{ marginTop: 10 }}>
        {!compact && <p className="hint" style={{ marginBottom: 6 }}>Active fonts: <strong>{fonts.display || '—'}</strong> (headlines), <strong>{fonts.body || '—'}</strong> (body)</p>}
        <Btn variant="secondary" type="button" onClick={() => setOpen(true)}>Change fonts</Btn>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div className="grid-2">
        <FontField id="typo-dfont" label="Headline font" value={display} onChange={setDisplay} onError={setError} />
        <FontField id="typo-bfont" label="Body font" value={body} onChange={setBody} onError={setError} />
      </div>
      {error && <p className="hint" style={{ color: '#C62828', marginTop: 10 }}>{error}</p>}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <Btn variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Btn>
        <Btn type="button" loading={saving} onClick={save}>Save fonts</Btn>
      </div>
    </div>
  );
}

function DesignLanguageEditor({ user, setUser, onDone }) {
  const dl = user?.brandKit?.designLanguage || {};
  const fonts = user?.brandKit?.fonts || {};
  const [f, setF] = useState({
    summary: dl.summary || '',
    imageryStyle: dl.imageryStyle || '',
    typographyImpression: dl.typographyImpression || '',
    logoType: dl.logoType || '',
    moodTags: dl.moodTags || [],
    colorRoles: { primary: '', secondary: '', accent: '', neutral: '', ...(dl.colorRoles || {}) },
    displayFont: fonts.display || '',
    bodyFont: fonts.body || ''
  });
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  function addTag() {
    const t = tagDraft.trim().toLowerCase();
    if (t && !f.moodTags.includes(t) && f.moodTags.length < 8) set('moodTags', [...f.moodTags, t]);
    setTagDraft('');
  }
  async function save() {
    setSaving(true); setError('');
    try {
      let { user: updated } = await brandAssetsApi.updateDesignLanguage({
        summary: f.summary, imageryStyle: f.imageryStyle, typographyImpression: f.typographyImpression,
        logoType: f.logoType || undefined, moodTags: f.moodTags, colorRoles: f.colorRoles
      });
      const fontChanged = (f.displayFont.trim() && f.displayFont.trim() !== fonts.display) || (f.bodyFont.trim() && f.bodyFont.trim() !== fonts.body);
      if (fontChanged) ({ user: updated } = await brandAssetsApi.updateBrandKit({ displayFont: f.displayFont.trim() || undefined, bodyFont: f.bodyFont.trim() || undefined }));
      setUser(updated);
      onDone();
    } catch (e) { setError(apiErrorMessage(e)); } finally { setSaving(false); }
  }
  return (
    <>
      <label style={{ ...labelStyle, marginTop: 0 }} htmlFor="dl-summary">Summary</label>
      <textarea id="dl-summary" style={{ ...inputStyle, minHeight: 84, resize: 'vertical' }} maxLength={600} value={f.summary} onChange={(e) => set('summary', e.target.value)} placeholder="How the brand looks and feels, in two or three sentences" />

      <span style={labelStyle}>Color roles</span>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {ROLE_KEYS.map((r) => (
          <div key={r} style={{ textAlign: 'center' }}>
            <input type="color" aria-label={`${r} color`} value={/^#[0-9a-f]{6}$/i.test(f.colorRoles[r]) ? f.colorRoles[r] : '#ffffff'} onChange={(e) => set('colorRoles', { ...f.colorRoles, [r]: e.target.value })} className="swatch" style={{ padding: 0, border: '1px solid var(--line)' }} />
            <p className="hint" style={{ margin: '4px 0 0', textTransform: 'capitalize' }}>{r}</p>
          </div>
        ))}
      </div>

      <span style={labelStyle}>Mood</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {f.moodTags.map((t) => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 6px 5px 12px', border: '1px solid #DCDFE8', borderRadius: 999, fontSize: 13 }}>
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => set('moodTags', f.moodTags.filter((x) => x !== t))} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'var(--muted)' }}>&times;</button>
          </span>
        ))}
      </div>
      <input style={inputStyle} value={tagDraft} placeholder="Add a mood, then press Enter" maxLength={30} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} onBlur={addTag} />

      <label style={labelStyle} htmlFor="dl-logo">Logo type</label>
      <select id="dl-logo" style={inputStyle} value={f.logoType} onChange={(e) => set('logoType', e.target.value)}>
        <option value="">Not set</option>
        {Object.entries(LOGO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>

      <label style={labelStyle} htmlFor="dl-imagery">Imagery style</label>
      <textarea id="dl-imagery" style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} maxLength={300} value={f.imageryStyle} onChange={(e) => set('imageryStyle', e.target.value)} placeholder="The photographic or illustrative style" />

      <label style={labelStyle} htmlFor="dl-typo">Typography impression</label>
      <textarea id="dl-typo" style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} maxLength={300} value={f.typographyImpression} onChange={(e) => set('typographyImpression', e.target.value)} placeholder="The feel of the letterforms" />

      <div className="grid-2" style={{ marginTop: 4 }}>
        <FontField id="dl-dfont" label="Headline font" value={f.displayFont} onChange={(v) => set('displayFont', v)} onError={setError} />
        <FontField id="dl-bfont" label="Body font" value={f.bodyFont} onChange={(v) => set('bodyFont', v)} onError={setError} />
      </div>

      {error && <p className="hint" style={{ color: '#C62828', marginTop: 10 }}>{error}</p>}
      <div className="btn-row" style={{ marginTop: 18 }}>
        <Btn variant="secondary" type="button" onClick={onDone}>Cancel</Btn>
        <Btn type="button" loading={saving} onClick={save}>Save changes</Btn>
      </div>
    </>
  );
}

/** The font reference image sent to the image model with any text it draws: preview, and make it when it does not exist yet. */
function FontSpecimenPreview({ user }) {
  const fonts = user?.brandKit?.fonts || {};
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState(0);
  const key = `${fonts.display || ''}|${fonts.body || ''}`;

  useEffect(() => {
    let live = true;
    setInfo(null); setError('');
    if (!fonts.display && !fonts.body) return undefined;
    brandAssetsApi.getFontSpecimen().then((r) => { if (live) setInfo(r); }).catch(() => { if (live) setInfo({ exists: false, missing: [] }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function make(force) {
    setBusy(true); setError('');
    try {
      const r = await brandAssetsApi.generateFontSpecimen({ force });
      setInfo(r); setStamp(Date.now());
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally { setBusy(false); }
  }

  if (!fonts.display && !fonts.body) return null;
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <p className="hint" style={{ marginBottom: 6 }}>
        Font reference image: sent to the AI with any image that has text, so it copies <strong>{fonts.display || '—'}</strong> (headlines) and <strong>{fonts.body || '—'}</strong> (body).
      </p>
      {info?.exists ? (
        <>
          <img src={`${info.url}${stamp ? `?v=${stamp}` : ''}`} alt="Font reference" style={{ width: '100%', maxWidth: 560, border: '1px solid var(--line)', borderRadius: 10, display: 'block', marginBottom: 8 }} />
          <Btn variant="secondary" type="button" loading={busy} onClick={() => make(true)}>Regenerate</Btn>
        </>
      ) : info ? (
        <Btn variant="secondary" type="button" loading={busy} onClick={() => make(false)}>Generate font reference image</Btn>
      ) : (
        <p className="hint">Checking…</p>
      )}
      {info?.exists && info.missing?.length > 0 && <p className="hint" style={{ marginTop: 6 }}>{info.missing.join(' and ')} {info.missing.length > 1 ? 'are' : 'is'} not on Google Fonts, so {info.missing.length > 1 ? 'they are' : 'it is'} not on the sheet.</p>}
      {error && <p className="hint" style={{ marginTop: 6, color: 'var(--danger, #b3261e)' }}>{error}</p>}
    </div>
  );
}

// hideFonts: the new Brand Assets screen sets headline / body fonts per language in its own Languages & Fonts tab.
export default function DesignLanguageCard({ user, setUser, hideFonts = false }) {
  const [editing, setEditing] = useState(false);
  const dl = user?.brandKit?.designLanguage;

  const hasAnalysis = Boolean(dl?.summary || dl?.lastAnalyzedAt);

  if (editing) {
    return (
      <>
        <Card>
          <CardHead title="Edit design language" />
          <DesignLanguageEditor user={user} setUser={setUser} onDone={() => setEditing(false)} />
        </Card>
        <ToneOfVoiceCard user={user} setUser={setUser} />
      </>
    );
  }

  if (!hasAnalysis) {
    return (
      <>
        <Card>
          <CardHead title="Design language" tag="AI" />
          <div className="empty-state">
            Upload a logo, brand image (PNG/JPG/WEBP), or a brand guideline PDF, and AUTOMATr will analyze it here —
            colors, typography feel, mood, and how it should carry into generated posts.
          </div>
          <div style={{ marginTop: 12 }}><Btn variant="secondary" type="button" onClick={() => setEditing(true)}>Fill in manually</Btn></div>
          {!hideFonts && <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}><TypographyFontsEditor user={user} setUser={setUser} /></div>}
          <FontSpecimenPreview user={user} />
        </Card>
        <ToneOfVoiceCard user={user} setUser={setUser} />
      </>
    );
  }

  const roles = dl.colorRoles || {};
  const roleEntries = Object.entries(roles).filter(([, hex]) => hex);

  return (
    <>
    <Card>
      <CardHead
        title="Design language"
        tag="AI model"
      />

      {dl.summary && <p style={{ marginBottom: 14 }}>{dl.summary}</p>}

      {roleEntries.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p className="hint" style={{ marginBottom: 8 }}>Color roles</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {roleEntries.map(([role, hex]) => (
              <div key={role} style={{ textAlign: 'center' }}>
                <div className="swatch" style={{ background: hex, margin: '0 auto 4px' }} title={hex} />
                <p className="hint" style={{ margin: 0, textTransform: 'capitalize' }}>{role}</p>
                <p className="hint" style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{hex}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {dl.moodTags?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p className="hint" style={{ marginBottom: 8 }}>Mood</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {dl.moodTags.map((tag) => (
              <Chip key={tag} selected={false} onClick={() => {}}>{tag}</Chip>
            ))}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 6 }}>
        {dl.logoType && (
          <div>
            <p className="hint" style={{ marginBottom: 4 }}>Logo type</p>
            <p style={{ fontSize: 13.5 }}>{LOGO_TYPE_LABELS[dl.logoType] || dl.logoType}</p>
          </div>
        )}
        {dl.imageryStyle && !/^(not applicable|n\/?a|none)$/i.test(dl.imageryStyle.trim()) && (
          <div>
            <p className="hint" style={{ marginBottom: 4 }}>Imagery style</p>
            <p style={{ fontSize: 13.5 }}>{dl.imageryStyle}</p>
          </div>
        )}
      </div>

      {(() => {
        const impressionText = (dl.typographyImpression || '').trim();
        const hasImpression = impressionText && !/^(not applicable|n\/?a|none)$/i.test(impressionText);

        return (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            {hasImpression && (
              <>
                <p className="hint" style={{ marginBottom: 4 }}>Typography impression</p>
                <p style={{ fontSize: 13.5, marginBottom: 0 }}>{impressionText}</p>
              </>
            )}

            {!hideFonts && <TypographyFontsEditor user={user} setUser={setUser} />}
          </div>
        );
      })()}
      <FontSpecimenPreview user={user} />
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <Btn variant="secondary" type="button" onClick={() => setEditing(true)}>Edit design language</Btn>
        <p className="hint" style={{ marginTop: 6 }}>Anything you change here is kept, even when you upload new brand files.</p>
      </div>
    </Card>
    <ToneOfVoiceCard user={user} setUser={setUser} />
    </>
  );
}
