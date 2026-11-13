import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { brandAssetsApi } from '../../api/resources.js';
import { apiErrorMessage as errMsg, resolveAssetUrl } from '../../api/client.js';
import { fontBoxId, languageCode } from '../../constants/brandLanguages.js';
import { TABS, BOX, uid } from './brandSpec.js';
import { useBrandUi } from './BrandUi.jsx';

// One place that loads everything the Brand Assets screen shows (the profile boxes, the uploaded files, languages, sub-brands)
// and saves every change. Boxes are stored on the brand profile; uploaded files stay BrandAsset records; languages stay on the customer.
const Ctx = createContext(null);
export const useBrand = () => useContext(Ctx);

// Which uploaded files belong in which file list (main brand only; sub-brand files live under Languages & Fonts -> Sub-brands).
const STORE_TEST = {
  logoFiles: (a) => a.kind === 'logo',
  imageFiles: (a) => a.kind === 'product',
  graphicFiles: (a) => a.kind === 'texture',
  refFiles: (a) => a.kind === 'reference' && a.styleGroup !== 'illustration',
  illustrationFiles: (a) => a.kind === 'reference' && a.styleGroup === 'illustration',
  layoutFiles: (a) => a.kind === 'layout'
};
const byAge = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
const nameOf = (a) => a.label || String(a.originalName || 'File').replace(/\.[a-z0-9]+$/i, '');
const toItem = (a) => ({
  id: String(a._id), from: 'user', caption: nameOf(a), src: resolveAssetUrl(a.url), bg: a.onDark ? 'Dark background' : 'Light background',
  logoVariant: a.logoVariant || '', notes: a.notes || '', asset: a
});

export function BrandDataProvider({ customerId, setUser, children }) {
  const { toast } = useBrandUi();
  const [profile, setProfile] = useState({ items: {}, doc: null, styleSummary: null, illSummary: null });
  const [assets, setAssets] = useState([]);
  const [subBrands, setSubBrands] = useState([]);
  const [langData, setLangData] = useState({ languages: [], defaultLanguage: 'English', available: [] });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [uploading, setUploading] = useState({});
  const [tick, setTick] = useState(0); // bumps whenever the saved boxes change, so the "what the AI is told" review refreshes
  const seq = useRef(0);

  const reloadAssets = useCallback(() => brandAssetsApi.list().then(({ assets: a }) => setAssets(a || [])), []);
  const reloadProfile = useCallback(() => brandAssetsApi.getProfile().then((p) => { setProfile(p); setTick((n) => n + 1); }), []);
  const reloadSubBrands = useCallback(() => brandAssetsApi.listSubBrands().then(({ subBrands: s }) => setSubBrands(s || [])), []);
  const reloadAll = useCallback(async () => {
    try {
      const [p, a, l, s] = await Promise.all([brandAssetsApi.getProfile(), brandAssetsApi.list(), brandAssetsApi.getLanguages(), brandAssetsApi.listSubBrands()]);
      setProfile(p); setAssets(a.assets || []); setLangData(l); setSubBrands(s.subBrands || []); setLoadError(''); setTick((n) => n + 1);
    } catch (e) { setLoadError(errMsg(e)); } finally { setReady(true); }
  }, []);
  useEffect(() => { setReady(false); reloadAll(); }, [customerId, reloadAll]);

  // ---------- derived lists ----------
  const defName = langData.defaultLanguage || 'English';
  const langItems = useMemo(() => {
    const notes = {};
    (profile.items.languageNotes || []).forEach((n) => { notes[String(n.name).toLowerCase()] = n.note; });
    return ['English', ...(langData.languages || [])].map((name) => ({
      id: `lang-${languageCode(name)}`, name, def: name === defName, from: name === 'English' ? 'system' : 'user', note: notes[name.toLowerCase()] || ''
    }));
  }, [langData, profile.items.languageNotes, defName]);

  const fontBoxes = useMemo(() => langItems.slice().sort((a, b) => (b.def ? 1 : 0) - (a.def ? 1 : 0)).map((l) => ({
    id: fontBoxId(l.name), tab: 'languages', lang: l.name, kind: 'font', add: 'Add a font', title: `${l.name} fonts`,
    desc: `Fonts used for ${l.name} text.${l.def ? ' This is the default language.' : ''}`, isDef: l.def
  })), [langItems]);

  const assetStores = useMemo(() => {
    const sorted = assets.slice().sort(byAge);
    const out = {};
    Object.entries(STORE_TEST).forEach(([id, test]) => { out[id] = sorted.filter((a) => !a.subBrand && test(a)).map(toItem); });
    return out;
  }, [assets]);

  const items = useCallback((id) => (id === 'languages' ? langItems : assetStores[id] || profile.items[id] || []), [langItems, assetStores, profile.items]);
  const boxesOf = useCallback((tab) => (tab.id === 'languages' ? [...tab.boxes, ...fontBoxes] : tab.boxes), [fontBoxes]);
  const storeIds = useCallback((tab) => { const ids = []; boxesOf(tab).forEach((b) => { ids.push(b.id); if (b.files) ids.push(b.files); }); return ids; }, [boxesOf]);
  const tabCount = useCallback((tab) => storeIds(tab).reduce((n, id) => n + items(id).length, 0), [storeIds, items]);
  const pdfCount = useCallback((tab) => {
    const tabs = tab ? [tab] : TABS;
    return tabs.reduce((n, t) => n + storeIds(t).reduce((m, id) => m + items(id).filter((it) => it.from === 'pdf').length, 0), 0);
  }, [storeIds, items]);

  const mentionItems = useCallback((box) => (box.mention || []).flatMap((id) => items(id)).map((f) => (f.hex ? { caption: f.name, swatch: f.hex } : { caption: f.caption, src: f.src })), [items]);
  const taken = useCallback((storeId, name, exceptId) => items(storeId).some((x) => x.id !== exceptId && String(x.caption || x.name || '').toLowerCase() === String(name).toLowerCase()), [items]);

  // ---------- saving boxes ----------
  async function saveBox(id, arr) {
    setProfile((p) => ({ ...p, items: { ...p.items, [id]: arr } }));
    const mine = ++seq.current;
    try {
      const r = await brandAssetsApi.updateProfile({ items: { [id]: arr } });
      if (mine === seq.current) { setProfile(r); setTick((n) => n + 1); }
    } catch (e) { toast(errMsg(e)); reloadProfile().catch(() => {}); }
  }
  const resync = async (itemsPatch = {}) => { try { setProfile(await brandAssetsApi.updateProfile({ items: itemsPatch })); setTick((n) => n + 1); } catch (e) { toast(errMsg(e)); } };

  async function addItem(box, out) {
    if (box.id === 'languages') return addLanguage(out);
    return saveBox(box.id, [...items(box.id), { ...out, id: uid(), from: 'user' }]);
  }
  async function editItem(box, it, out) {
    if (box.id === 'languages') return editLanguage(it, out);
    return saveBox(box.id, items(box.id).map((x) => (x.id === it.id ? { ...x, ...out, ...(x.from !== 'user' && x.from !== 'system' ? { edited: true } : {}) } : x)));
  }
  async function deleteItem(box, it) {
    if (box.id === 'languages') return deleteLanguage(it);
    return saveBox(box.id, items(box.id).filter((x) => x.id !== it.id));
  }

  // ---------- languages ----------
  async function addLanguage(out) {
    try {
      setLangData(await brandAssetsApi.updateLanguages({ languages: [...langData.languages, out.name], ...(out.def ? { defaultLanguage: out.name } : {}) }));
      const patch = {};
      if (out.note) patch.languageNotes = [...items('languageNotes'), { id: uid(), from: 'user', name: out.name, note: out.note }];
      await resync(patch);
    } catch (e) { toast(errMsg(e)); }
  }
  async function editLanguage(it, out) {
    if (it.name === 'English' && out.name !== 'English') { toast("English can't be renamed. Add the language you want and make it the default."); return; }
    const renamed = out.name !== it.name;
    try {
      const body = {};
      if (renamed) body.languages = langData.languages.map((n) => (n === it.name ? out.name : n));
      if ((out.def && !it.def) || (renamed && it.def)) body.defaultLanguage = out.name;
      if (Object.keys(body).length) setLangData(await brandAssetsApi.updateLanguages(body));
      const patch = {};
      if (renamed || (out.note || '') !== (it.note || '')) {
        const rest = items('languageNotes').filter((n) => String(n.name).toLowerCase() !== it.name.toLowerCase());
        patch.languageNotes = out.note ? [...rest, { id: uid(), from: 'user', name: out.name, note: out.note }] : rest;
      }
      if (renamed && fontBoxId(it.name) !== fontBoxId(out.name)) {
        const fonts = items(fontBoxId(it.name));
        if (fonts.length) { patch[fontBoxId(out.name)] = fonts; patch[fontBoxId(it.name)] = []; }
      }
      await resync(patch);
    } catch (e) { toast(errMsg(e)); }
  }
  async function deleteLanguage(it) {
    if (it.name === 'English') { toast("English is always available, so it can't be deleted."); return; }
    if (it.def) { toast('Make another language the default before deleting this one.'); return; }
    try {
      setLangData(await brandAssetsApi.updateLanguages({ languages: langData.languages.filter((n) => n !== it.name) }));
      await resync({ languageNotes: items('languageNotes').filter((n) => String(n.name).toLowerCase() !== it.name.toLowerCase()), [fontBoxId(it.name)]: [] });
      toast('Deleted');
    } catch (e) { toast(errMsg(e)); }
  }

  // ---------- uploaded files ----------
  const busyOn = (id, n) => setUploading((u) => ({ ...u, [id]: Math.max(0, (u[id] || 0) + n) }));
  async function addFiles(storeId, drafts) {
    let ok = 0; let fail = '';
    drafts.forEach((d) => busyOn(d.group || storeId, 1));
    for (const d of drafts) {
      const sid = d.group || storeId; const sp = BOX[sid];
      try {
        const r = await brandAssetsApi.upload([d.file], sp.assetKind, null, {
          label: d.name, logoVariant: sp.logo ? d.logoVariant : '', notes: d.notes || '', onDark: sp.noBg ? false : d.bg === 'Dark background', styleGroup: sp.styleGroup || ''
        });
        ok += 1;
        if (r.brandKit && setUser) setUser((prev) => (prev ? { ...prev, brandKit: r.brandKit } : prev));
        if (r.assets?.length) setAssets((prev) => [...prev, ...r.assets]);
      } catch (e) { fail = errMsg(e); } finally { busyOn(sid, -1); }
    }
    await Promise.all([reloadAssets(), reloadProfile()]).catch(() => {});
    const noun = (BOX[drafts[0]?.group || storeId]?.noun || 'file');
    if (fail) toast(ok ? `Added ${ok} of ${drafts.length}. ${fail}` : fail);
    else toast(`Added ${ok} ${noun}${ok > 1 ? 's' : ''}`);
  }
  async function editFile(storeId, it, d) {
    const sp = BOX[storeId];
    try {
      const { asset } = await brandAssetsApi.updateAsset(it.id, {
        label: d.name, notes: d.notes || '', ...(sp.noBg ? {} : { onDark: d.bg === 'Dark background' }), ...(sp.logo ? { logoVariant: d.logoVariant || '' } : {})
      });
      setAssets((prev) => prev.map((a) => (String(a._id) === it.id ? { ...a, ...asset } : a)));
      setTick((n) => n + 1);
      toast('Changes saved');
    } catch (e) { toast(errMsg(e)); }
  }
  async function deleteFile(storeId, it) {
    try {
      await brandAssetsApi.remove(it.id);
      setAssets((prev) => prev.filter((a) => String(a._id) !== it.id));
      setTick((n) => n + 1);
      toast(BOX[storeId]?.swatch ? 'Color deleted' : 'File deleted');
    } catch (e) { toast(errMsg(e)); }
  }
  const patchAsset = (a) => { setAssets((prev) => prev.map((x) => (String(x._id) === String(a._id) ? a : x))); setTick((n) => n + 1); };

  // ---------- reset everything ----------
  async function resetAll() {
    const r = await brandAssetsApi.resetAll();
    setProfile(r.profile); setLangData((d) => ({ ...d, ...r.languages })); setAssets([]); setSubBrands([]); setTick((n) => n + 1);
    if (r.brandKit && setUser) setUser((prev) => (prev ? { ...prev, brandKit: r.brandKit } : prev));
    await reloadAll();
    return r;
  }

  // ---------- colours ----------
  const addSwatch = (out) => saveBox('colourSwatches', [...items('colourSwatches'), { ...out, id: uid(), from: 'user' }]);
  const editSwatch = (it, out) => saveBox('colourSwatches', items('colourSwatches').map((x) => (x.id === it.id ? { ...x, ...out, ...(x.from !== 'user' ? { edited: true } : {}) } : x)));
  const deleteSwatch = (it) => { saveBox('colourSwatches', items('colourSwatches').filter((x) => x.id !== it.id)); toast('Color deleted'); };

  const value = {
    ready, loadError, profile, setProfile, assets, setAssets, subBrands, setSubBrands, langData, defaultLang: defName, uploading, tick,
    items, boxesOf, storeIds, tabCount, pdfCount, mentionItems, taken,
    addItem, editItem, deleteItem, addFiles, editFile, deleteFile, patchAsset, addSwatch, editSwatch, deleteSwatch, resetAll,
    reloadAll, reloadAssets, reloadProfile, reloadSubBrands, bump: () => setTick((n) => n + 1), setUser
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
