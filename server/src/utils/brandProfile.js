// The brand profile: the structured "Brand Assets" screen (Guidelines, Assets, Colors, Imagery, Languages & Fonts).
// Stored on Customer.brandKit.profile as { items: { <boxId>: [item] }, doc, styleSummary, illSummary, migrated }.
//
//   cleanProfileItems()   validates whatever the editor / the PDF reader sends
//   deriveProfile()       first load for an existing customer: builds the boxes from the older brand guide, colours and fonts
//   legacyPatch()         keeps the older fields (guide.*, colors, fonts) in step, so every existing prompt path keeps working
//   profileLines()        extra prompt sentences for what the older fields do not carry (images, graphics, colour use, translation...)
//
// Files (logos, images, graphics, style references) are not in here: they live in BrandAsset records.

const txt = (v) => (typeof v === 'string' ? v.replace(/\r/g, '').trim() : '');
const one = (v) => txt(v).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ');
const HEX = /^#[0-9a-f]{6}$/i;
const normHex = (v) => {
  let h = String(v || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/(.)/g, '$1$1');
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toUpperCase()}` : '';
};

/** box id -> { kind, max items, text limit } */
export const BOXES = {
  essence: { kind: 'fact', max: 12, len: 300 },
  voice: { kind: 'text', max: 20, len: 400, tags: ['Tone', 'Narrative', 'Key Messaging', 'Headlines', 'Sub Headlines', 'Post Copy'] },
  layout: { kind: 'text', max: 20, len: 400 },
  audiences: { kind: 'text', max: 10, len: 400 },
  alwaysDo: { kind: 'text', max: 15, len: 160 },
  neverDo: { kind: 'text', max: 15, len: 160 },
  preferredWords: { kind: 'text', max: 30, len: 40 },
  avoidWords: { kind: 'text', max: 30, len: 40 },
  taglines: { kind: 'text', max: 10, len: 120 },
  mandatory: { kind: 'text', max: 4, len: 400 },
  logo: { kind: 'text', max: 20, len: 400 },
  images: { kind: 'text', max: 20, len: 400 },
  graphic: { kind: 'text', max: 20, len: 400 },
  websites: { kind: 'url', max: 8, len: 200 },
  colourUse: { kind: 'text', max: 20, len: 400 },
  colourSwatches: { kind: 'colour', max: 24, len: 40 },
  refs: { kind: 'text', max: 20, len: 400 },
  illustration: { kind: 'text', max: 20, len: 400 },
  translation: { kind: 'text', max: 10, len: 400 },
  architecture: { kind: 'named', max: 12, len: 300 },
  subRules: { kind: 'text', max: 10, len: 400 },
  languageNotes: { kind: 'named', max: 90, len: 300 }
};
export const FONT_BOX = /^fonts-[a-z0-9-]{1,12}$/;
export const FONT_ROLES = ['Headline', 'Sub headline'];
export const COLOUR_GROUPS = ['Primary', 'Secondary'];
// What a colour is for in a design. Blank = the AI decides.
export const COLOUR_ROLES = ['', 'Background', 'Text', 'Button or call to action', 'Highlight or accent'];
const CASES = ['As written', 'Title case', 'All caps', 'Lowercase'];
const FROM = ['user', 'pdf', 'system', 'migrated'];

const boxSpec = (id) => BOXES[id] || (FONT_BOX.test(id) ? { kind: 'font', max: 4, len: 60 } : null);
const uid = () => `i${Math.random().toString(36).slice(2, 9)}`;

/** One item of one box, or null when it is not usable. */
export function cleanItem(boxId, raw) {
  const spec = boxSpec(boxId);
  if (!spec || !raw || typeof raw !== 'object') return null;
  const it = { id: /^[a-z0-9_-]{3,24}$/i.test(raw.id || '') ? raw.id : uid(), from: FROM.includes(raw.from) ? raw.from : 'user' };
  if (raw.edited) it.edited = true;
  if (Number.isFinite(raw.p)) it.p = Math.max(0, Math.min(9999, Math.round(raw.p)));
  const L = spec.len;
  switch (spec.kind) {
    case 'text': {
      it.text = one(raw.text).slice(0, L);
      if (!it.text) return null;
      if (spec.tags && spec.tags.includes(raw.tag)) it.tag = raw.tag;
      return it;
    }
    case 'fact':
      it.label = one(raw.label).slice(0, 40);
      it.value = one(raw.value).slice(0, L);
      return it.label && it.value ? it : null;
    case 'url': {
      let u = one(raw.url);
      if (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `https://${u}`;
      try { const p = new URL(u); if (!/^https?:$/.test(p.protocol) || !p.hostname.includes('.')) return null; it.url = p.href.replace(/\/$/, ''); } catch { return null; }
      it.name = one(raw.name).slice(0, 80);
      return it;
    }
    case 'colour': {
      it.name = one(raw.name).slice(0, 40);
      it.hex = normHex(raw.hex);
      it.group = COLOUR_GROUPS.includes(raw.group) ? raw.group : 'Primary';
      it.role = COLOUR_ROLES.includes(raw.role) ? raw.role : '';
      it.note = one(raw.note).slice(0, 120);
      return it.name && it.hex ? it : null;
    }
    case 'named':
      it.name = one(raw.name).slice(0, 80);
      it.note = one(raw.note).slice(0, L);
      return it.name ? it : null;
    case 'font': {
      it.family = one(raw.family).replace(/["\\]/g, '').slice(0, 60);
      if (!it.family) return null;
      it.role = FONT_ROLES.includes(raw.role) ? raw.role : 'Headline';
      const w = parseInt(raw.weight, 10);
      it.weight = w >= 100 && w <= 900 ? Math.round(w / 100) * 100 : 0;
      it.ital = Boolean(raw.ital);
      it.tcase = CASES.includes(raw.tcase) ? raw.tcase : 'As written';
      const lh = Number(raw.lh); it.lh = Number.isFinite(lh) ? Math.max(50, Math.min(300, lh)) : 100;
      const ls = Number(raw.ls); it.ls = Number.isFinite(ls) ? Math.max(-20, Math.min(100, ls)) : 0;
      it.note = one(raw.note).slice(0, 300);
      return it;
    }
    default:
      return null;
  }
}

/** items: { boxId: [raw] } -> only the boxes that were sent, each cleaned, de-duplicated and capped. */
export function cleanProfileItems(items) {
  const out = {};
  if (!items || typeof items !== 'object') return out;
  for (const [boxId, arr] of Object.entries(items)) {
    const spec = boxSpec(boxId);
    if (!spec || !Array.isArray(arr)) continue;
    const seen = new Set();
    const ids = new Set();
    out[boxId] = [];
    for (const raw of arr) {
      const it = cleanItem(boxId, raw);
      if (!it) continue;
      const key = `${it.text || it.url || it.value || it.name || it.family}|${it.hex || ''}|${it.role || ''}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      while (ids.has(it.id)) it.id = uid();
      ids.add(it.id);
      out[boxId].push(it);
      if (out[boxId].length >= spec.max) break;
    }
  }
  return out;
}

export function cleanDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const o = { name: one(d.name).slice(0, 160), mode: one(d.mode).slice(0, 20), found: Math.max(0, Math.min(999, parseInt(d.found, 10) || 0)) };
  o.size = Math.max(0, parseInt(d.size, 10) || 0);
  o.pages = Math.max(0, Math.min(9999, parseInt(d.pages, 10) || 0));
  o.at = d.at ? new Date(d.at) : new Date();
  o.skipped = (Array.isArray(d.skipped) ? d.skipped : []).map((s) => one(s).slice(0, 160)).filter(Boolean).slice(0, 12);
  return o.name ? o : null;
}

export function cleanStyleSummary(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.sections)) return null;
  const sections = s.sections.slice(0, 8).map((x) => ({
    id: /^[a-z0-9_-]{1,20}$/i.test(x?.id || '') ? x.id : uid(),
    title: one(x?.title).slice(0, 60),
    text: txt(x?.text).slice(0, 1200),
    palette: (Array.isArray(x?.palette) ? x.palette : []).map(normHex).filter(Boolean).slice(0, 6)
  })).filter((x) => x.title && x.text);
  if (!sections.length) return null;
  const edits = {};
  if (s.edits && typeof s.edits === 'object') for (const sec of sections) if (typeof s.edits[sec.id] === 'string' && txt(s.edits[sec.id])) edits[sec.id] = txt(s.edits[sec.id]).slice(0, 1200);
  return { sections, edits, count: Math.max(0, parseInt(s.count, 10) || 0), at: s.at ? new Date(s.at) : new Date(), key: one(s.key).slice(0, 200) };
}

export const styleText = (s) => (s?.sections || []).map((sec) => `${sec.title}: ${(s.edits && s.edits[sec.id]) || sec.text}`).join('\n\n');

// ---------------------------------------------------------------------------
// First load for a customer who only has the older fields
// ---------------------------------------------------------------------------

const lines = (s) => txt(s).split(/\n+/).map(one).filter(Boolean);
const mig = (o) => ({ id: uid(), from: 'migrated', ...o });

/** Builds profile.items from the older guide + colours + fonts. Nothing is removed from the older fields. */
export function deriveProfile(kit = {}, defaultLanguageCode = 'en') {
  const g = kit.guide || {};
  const items = {};
  const text = (boxId, arr, extra) => {
    const cleaned = (arr || []).map((t) => cleanItem(boxId, mig({ text: t, ...(extra || {}) }))).filter(Boolean);
    if (cleaned.length) items[boxId] = cleaned;
  };
  const ess = [];
  if (txt(g.instructions)) ess.push({ label: 'General instructions', value: one(g.instructions) });
  if (txt(g.positioning)) ess.push({ label: 'What the brand stands for', value: one(g.positioning) });
  if (ess.length) items.essence = ess.map((e) => cleanItem('essence', mig(e))).filter(Boolean);
  if (txt(g.copyInstructions)) items.voice = lines(g.copyInstructions).map((t) => cleanItem('voice', mig({ text: t }))).filter(Boolean);
  if (txt(g.designInstructions)) items.layout = lines(g.designInstructions).map((t) => cleanItem('layout', mig({ text: t }))).filter(Boolean);
  text('audiences', lines(g.audience));
  text('alwaysDo', g.doList);
  text('neverDo', g.dontList);
  text('preferredWords', g.preferredWords);
  text('avoidWords', g.avoidWords);
  text('taglines', g.taglines);
  text('mandatory', lines(g.mandatoryText));
  text('logo', lines(g.logoRules));
  const roles = kit.designLanguage?.colorRoles || {};
  const sw = [];
  const seen = new Set();
  (kit.colors || []).forEach((hex, i) => {
    const h = normHex(hex);
    if (!h || seen.has(h)) return;
    seen.add(h);
    const grp = h === normHex(roles.primary) || (i === 0 && !roles.primary) ? 'Primary' : h === normHex(roles.secondary) ? 'Secondary' : i < 2 ? 'Primary' : 'Secondary';
    sw.push(cleanItem('colourSwatches', mig({ name: `Colour ${i + 1}`, hex: h, group: grp })));
  });
  if (sw.filter(Boolean).length) items.colourSwatches = sw.filter(Boolean);
  const f = kit.fonts || {};
  const fid = `fonts-${defaultLanguageCode}`;
  const fonts = [];
  if (f.display) fonts.push(cleanItem(fid, mig({ family: f.display, role: 'Headline', weight: 700 })));
  if (f.body) fonts.push(cleanItem(fid, mig({ family: f.body, role: 'Sub headline', weight: 400 })));
  if (fonts.filter(Boolean).length) items[fid] = fonts.filter(Boolean);
  return items;
}

// ---------------------------------------------------------------------------
// Keep the older fields in step (everything that already reads them keeps working)
// ---------------------------------------------------------------------------

const texts = (items, id) => (items?.[id] || []).map((i) => (i.text || '').replace(/(^|\s)@(?=\S)/g, '$1')).filter(Boolean);
const clip = (s, n) => String(s || '').slice(0, n);

/**
 * Returns a Mongo $set object for the older fields, built from the profile boxes.
 * Only fields a box owns are written; guide.learned / guide.photography / review stamp are never touched here.
 */
export function legacyPatch(profile, { defaultLanguageCode = 'en' } = {}) {
  const items = profile?.items || {};
  const set = {};
  const ess = items.essence || [];
  const general = ess.filter((e) => /^general instructions$/i.test(e.label));
  set['brandKit.guide.instructions'] = clip(general.map((e) => e.value).join(' '), 3000);
  set['brandKit.guide.positioning'] = clip(ess.filter((e) => !/^general instructions$/i.test(e.label)).map((e) => (/^what the brand stands for$/i.test(e.label) ? e.value : `${e.label}: ${e.value}`)).join('. '), 500);
  set['brandKit.guide.copyInstructions'] = clip((items.voice || []).map((v) => (v.tag ? `${v.tag}: ${v.text}` : v.text)).join('\n'), 2000);
  set['brandKit.guide.designInstructions'] = clip(texts(items, 'layout').join('\n'), 2000);
  set['brandKit.guide.audience'] = clip(texts(items, 'audiences').join('; '), 500);
  set['brandKit.guide.logoRules'] = clip(texts(items, 'logo').join(' '), 600);
  set['brandKit.guide.mandatoryText'] = clip(texts(items, 'mandatory').join(' '), 400);
  set['brandKit.guide.doList'] = texts(items, 'alwaysDo').map((t) => clip(t, 160)).slice(0, 15);
  set['brandKit.guide.dontList'] = texts(items, 'neverDo').map((t) => clip(t, 160)).slice(0, 15);
  set['brandKit.guide.preferredWords'] = texts(items, 'preferredWords').map((t) => clip(t, 40)).slice(0, 30);
  set['brandKit.guide.avoidWords'] = texts(items, 'avoidWords').map((t) => clip(t, 40)).slice(0, 30);
  set['brandKit.guide.taglines'] = texts(items, 'taglines').map((t) => clip(t, 120)).slice(0, 10);

  const sw = [...(items.colourSwatches || [])].sort((a, b) => (a.group === 'Primary' ? 0 : 1) - (b.group === 'Primary' ? 0 : 1));
  if (sw.length) {
    set['brandKit.colors'] = sw.map((c) => c.hex).slice(0, 8);
    const first = (group) => sw.find((c) => c.group === group)?.hex;
    const accent = sw.find((c) => c.role === 'Highlight or accent')?.hex;
    if (first('Primary')) set['brandKit.designLanguage.colorRoles.primary'] = first('Primary');
    if (first('Secondary')) set['brandKit.designLanguage.colorRoles.secondary'] = first('Secondary');
    if (accent) set['brandKit.designLanguage.colorRoles.accent'] = accent;
  } else if (Array.isArray(items.colourSwatches)) {
    set['brandKit.colors'] = []; // every swatch was deleted on purpose
  }
  const fonts = items[`fonts-${defaultLanguageCode}`] || [];
  const head = fonts.find((f) => f.role === 'Headline');
  const sub = fonts.find((f) => f.role === 'Sub headline');
  if (head) set['brandKit.fonts.display'] = head.family;
  if (sub) set['brandKit.fonts.body'] = sub.family;
  else if (head) set['brandKit.fonts.body'] = head.family;
  return set;
}

// ---------------------------------------------------------------------------
// Prompt sentences for what the older fields do not carry
// ---------------------------------------------------------------------------

const nameOnly = (s) => one(s).replace(/(^|\s)@(?=\S)/g, '$1').replace(/#[0-9a-f]{3,8}\b/gi, '').replace(/\s{2,}/g, ' ').trim();

/**
 * scope 'design' -> image prompts; scope 'copy' -> captions / headlines.
 * Hex codes and file names are never put in a sentence (they can be drawn as text on an image).
 */
export function profileLines(kit, scope = 'design') {
  const items = kit?.profile?.items;
  if (!items) return [];
  const out = [];
  const add = (s) => { if (s) out.push(s); };
  const join = (arr) => arr.map(nameOnly).filter(Boolean).join('; ');
  if (scope === 'design') {
    add(texts(items, 'images').length && `How this brand uses images: ${join(texts(items, 'images'))}.`);
    add(texts(items, 'graphic').length && `How this brand uses graphics, icons and patterns: ${join(texts(items, 'graphic'))}.`);
    add(texts(items, 'colourUse').length && `How this brand uses colour: ${join(texts(items, 'colourUse'))}.`);
    const roled = (items.colourSwatches || []).filter((c) => c.role);
    add(roled.length && `Colour roles: ${roled.map((c) => `${nameOnly(c.name)} is for ${c.role.toLowerCase()}`).join('; ')}.`);
    add(texts(items, 'refs').length && `Photography styling for this brand (photographed content only): ${join(texts(items, 'refs'))}.`);
    add(texts(items, 'illustration').length && `Illustration styling for this brand (illustrated content only): ${join(texts(items, 'illustration'))}.`);
  } else {
    add(texts(items, 'translation').length && `Translation and localisation rules: ${join(texts(items, 'translation'))}.`);
    const ln = (items.languageNotes || []).filter((n) => n.note);
    add(ln.length && `Notes per language: ${ln.map((n) => `${nameOnly(n.name)} - ${nameOnly(n.note)}`).join('; ')}.`);
  }
  return out.filter(Boolean);
}

/** Display fonts for a language (profile boxes), falling back to the kit's headline / body fonts. */
export function fontsForLanguage(kit, languageCode) {
  const list = kit?.profile?.items?.[`fonts-${String(languageCode || 'en').toLowerCase()}`] || [];
  const head = list.find((f) => f.role === 'Headline');
  const sub = list.find((f) => f.role === 'Sub headline');
  return {
    display: head?.family || kit?.fonts?.display || '',
    body: sub?.family || head?.family || kit?.fonts?.body || '',
    headline: head || null,
    subHeadline: sub || null
  };
}
