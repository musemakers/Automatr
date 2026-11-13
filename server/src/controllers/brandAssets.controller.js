import fs from 'node:fs';
import path from 'node:path';
import BrandAsset from '../models/BrandAsset.js';
import Post from '../models/Post.js';
import Customer from '../models/Customer.js';
import { v4 as uuidv4 } from 'uuid';
import { resolveUploadPath, uploadUrl, uploadDir } from '../utils/storage.js';
import { analyzeBrandAsset, extractJsonObject } from '../services/ai/brandAnalysisService.js';
import { findBrandVoice } from '../services/ai/brandVoiceSearch.js';
import { generateText, analyzeImage } from '../services/ai/router.js';
import sharp from 'sharp';
import { LANGUAGES, DEFAULT_LANGUAGE, isKnownLanguage, languageCode } from '../constants/languages.js';
import { detectByKeyword, findSubBrand, listSubBrands, cleanKeywords } from '../services/subBrandService.js';
import { isAgency } from '../middleware/auth.js';
import { cleanGuide, brandGuidePreview } from '../utils/brandGuide.js';
import { readPastAssets, synthesizeRules } from '../services/ai/pastPostsService.js';
import { buildFontSpecimen, specimenInfo, saveCustomFont, systemFonts } from '../utils/fontSpecimen.js';
import { readPhotographyGuide } from '../services/ai/photographyService.js';
import { cleanProfileItems, cleanDoc, cleanStyleSummary, deriveProfile, legacyPatch, styleText, FONT_BOX } from '../utils/brandProfile.js';
import { readGuidelinesPdf } from '../services/ai/guidelinesPdfService.js';
import { buildStyleSummary } from '../services/ai/styleSummaryService.js';
import { isZipUpload, openPackage, applyCaps, classifyUnknownImages, interpretPackage, hasBrandInfo, mimeOfExt } from '../services/brandPackageService.js';

export const ASSET_KINDS = ['logo', 'product', 'texture', 'template', 'reference', 'layout', 'other'];
// Agency-only material: never listed to a customer and never offered in their asset picker.
const AGENCY_ONLY_KINDS = ['reference', 'layout'];
export const LOGO_VARIANTS = ['primary', 'secondary', 'icon', 'horizontal', 'stacked', 'white', 'black', 'one-colour'];
const cleanVariant = (v) => (LOGO_VARIANTS.includes(String(v || '').trim().toLowerCase()) ? String(v).trim().toLowerCase() : '');
const cleanText = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Does this upload teach us the brand's design language? A layout is only a composition starting point, and a secondary logo says nothing new. */
const shapesDesignLanguage = (a) => a.kind !== 'layout' && !(a.kind === 'logo' && a.logoVariant && a.logoVariant !== 'primary');

function inferKind(mimetype, originalName) {
  const lower = originalName.toLowerCase();
  if (lower.includes('logo')) return 'logo';
  if (lower.includes('texture')) return 'texture';
  if (lower.includes('template') || mimetype === 'application/pdf') return 'template';
  if (mimetype.startsWith('image/')) return 'product';
  return 'other';
}

const AUTO_KINDS = ['logo', 'product', 'texture', 'reference', 'layout', 'other'];
const guessVariant = (name) => {
  const n = String(name || '').toLowerCase();
  if (/white|reverse|negative/.test(n)) return 'white';
  if (/black/.test(n)) return 'black';
  if (/icon|symbol|mark/.test(n)) return 'icon';
  if (/horizontal|landscape/.test(n)) return 'horizontal';
  if (/stack|vertical/.test(n)) return 'stacked';
  if (/secondary/.test(n)) return 'secondary';
  return '';
};

/**
 * Smart upload: the AI looks at one image and says what it is, so the super admin does not have to answer questions.
 * Returns { kind, logoVariant, label, notes, subId } with blanks wherever it is unsure (callers then fall back to the file name).
 * Never throws: with no AI configured or an unreadable file the upload simply uses the old file-name rules.
 */
async function describeUpload(file, subBrands) {
  const out = { kind: '', logoVariant: guessVariant(file.originalname), label: '', notes: '', subId: null };
  if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.mimetype || '')) return out;
  try {
    const buf = fs.readFileSync(resolveUploadPath(file.filename));
    const thumb = await sharp(buf, { density: 96 }).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#808080' }).jpeg({ quality: 72 }).toBuffer();
    const names = (subBrands || []).map((b) => b.name).filter(Boolean);
    const { text } = await analyzeImage({
      base64: thumb.toString('base64'),
      mimeType: 'image/jpeg',
      maxTokens: 300,
      purpose: 'brand upload: what is this file',
      instruction: [
        `A brand team just uploaded this image to its brand library (file name: "${file.originalname}"). Work out what it is.`,
        'Reply with ONLY a JSON object: {"kind":"logo"|"product"|"texture"|"reference"|"layout"|"other","logoVariant":"","label":"","notes":"","brand":""}.',
        'kind: logo = a logo, wordmark or brand mark. product = a photo of the brand\'s product, vehicle, pack, place or service. texture = a pattern or background. reference = a finished ad, social post, moodboard or screenshot used as style inspiration. layout = a blank or sample layout/template showing a composition to start from. other = anything else.',
        `logoVariant (logos only, else ""): one of ${LOGO_VARIANTS.join(', ')}. The grey backdrop is added by us; a logo drawn in white or very light colours is "white", an all-black one is "black", a symbol without text is "icon", text only beside or without a symbol on one line is "horizontal", symbol over text is "stacked". Use "primary" for the main full-colour logo.`,
        'label: a short plain name for the tile, at most 40 characters (e.g. "White logo", "Red SUV front view").',
        'notes: one short sentence on when to use it, at most 110 characters (e.g. "Use on dark or photo backgrounds"). Empty if nothing useful can be said.',
        names.length ? `brand: which of these sub-brands the file belongs to: ${names.map((n) => `"${n}"`).join(', ')}; or "main" if it belongs to none or you cannot tell.` : 'brand: always "main".'
      ].join(' ')
    });
    if (!text) return out;
    const parsed = JSON.parse(extractJsonObject(text.replace(/^```json|```$/gim, '').trim()));
    if (AUTO_KINDS.includes(parsed.kind)) out.kind = parsed.kind;
    if (out.kind === 'logo') out.logoVariant = cleanVariant(parsed.logoVariant) || out.logoVariant;
    else out.logoVariant = '';
    out.label = cleanText(parsed.label, 40);
    out.notes = cleanText(parsed.notes, 110);
    const sb = (subBrands || []).find((b) => String(b.name).trim().toLowerCase() === String(parsed.brand || '').trim().toLowerCase());
    if (sb) out.subId = String(sb._id);
  } catch { /* keep what the file name told us */ }
  return out;
}

export async function uploadAssets(req, res, next) {
  try {
    const allFiles = req.files || [];
    if (allFiles.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }
    // A ZIP is a brand package (a design-system export or a folder of logos and photos): it is unpacked and read below.
    const zipFiles = allFiles.filter(isZipUpload);
    const files = allFiles.filter((f) => !isZipUpload(f));

    // Which brand these files belong to: the main brand (default) or one of the customer's sub-brands.
    const subId = req.body.subBrandId && req.body.subBrandId !== 'main' ? String(req.body.subBrandId) : null;
    if (subId && !findSubBrand(req.customer, subId)) return res.status(400).json({ error: 'That sub-brand no longer exists.' });

    const reqKind = ASSET_KINDS.includes(req.body.kind) ? req.body.kind : '';
    const reqVariant = cleanVariant(req.body.logoVariant);
    const label = cleanText(req.body.label, 80);
    const notes = cleanText(req.body.notes, 300);
    const onDark = req.body.onDark === 'true' || req.body.onDark === true;
    const styleGroup = ['photo', 'illustration'].includes(req.body.styleGroup) ? req.body.styleGroup : '';

    // No type chosen: the AI works out type, logo version, name, note and (when there are sub-brands) the brand for each image.
    const customerNow = !reqKind && files.length ? await Customer.findById(req.customer._id) : null;
    const guesses = !reqKind ? await Promise.all(files.map((f) => describeUpload(f, customerNow ? listSubBrands(customerNow) : []))) : [];

    const created = await Promise.all(
      files.map((file, i) => {
        const g = guesses[i] || {};
        const kind = reqKind || g.kind || inferKind(file.mimetype, file.originalname);
        const logoVariant = kind === 'logo' ? (reqVariant || g.logoVariant || '') : '';
        return BrandAsset.create({
          user: req.user._id,
          filename: file.filename,
          originalName: file.originalname,
          url: uploadUrl(file.filename, req.tenant),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          subBrand: subId || g.subId || null,
          kind,
          logoVariant,
          // A name typed for a single file wins; otherwise the AI's short name.
          label: files.length === 1 && label ? label : g.label || '',
          notes: notes || g.notes || '',
          onDark,
          styleGroup: kind === 'reference' ? styleGroup : ''
        });
      })
    );

    // Every upload gets AI-analyzed for its design language (colors,
    // typography impression, mood, etc) where the file type supports it.
    // This never blocks or fails the upload itself - if analysis can't run
    // (no provider configured, unsupported file type, parsing failure),
    // the assets are still saved and returned normally.
    let analysisSummary = files.length ? await analyzeAndApplyDesignLanguage(created.filter((a) => String(a.subBrand || '') === String(subId || '')), req.customer, subId) : null;

    if (zipFiles.length) {
      const results = await importBrandPackages(zipFiles, req, subId);
      if (!files.length && results.every((r) => r.error)) return res.status(400).json({ error: results[0].error });
      created.push(...results.flatMap((r) => r.assets || []));
      analysisSummary = mergePackageAnalysis(analysisSummary, results);
    }

    // A package or an analysed PDF can fill the older fields (guide, colours, fonts): boxes still empty on the new screen adopt them.
    if (zipFiles.length || files.length) await adoptLegacyIntoProfile(req.customer._id).catch(() => {});

    const updatedCustomer = await Customer.findById(req.customer._id);

    res.status(201).json({
      assets: created,
      brandKit: updatedCustomer.brandKit,
      subBrands: listSubBrands(updatedCustomer),
      analysis: analysisSummary
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Brand packages (ZIP uploads)
// ---------------------------------------------------------------------------

const PACKAGE_KIND = { logos: 'logo', photos: 'product', textures: 'texture', layouts: 'layout', references: 'reference', pdfs: 'template' };
const PACKAGE_COUNT_LABEL = { logos: ['logo', 'logos'], photos: ['photo', 'photos'], textures: ['texture', 'textures'], layouts: ['layout', 'layouts'], references: ['reference image', 'reference images'], pdfs: ['guideline PDF', 'guideline PDFs'] };
const GUIDE_LABEL = {
  instructions: 'general instructions', copyInstructions: 'writing instructions', designInstructions: 'design instructions', audience: 'audience', positioning: 'what the brand stands for',
  logoRules: 'logo rules', mandatoryText: 'mandatory line', doList: 'always-do list', dontList: 'never-do list', preferredWords: 'preferred words', avoidWords: 'words to avoid', taglines: 'taglines'
};

/** Imports every ZIP in the upload. One bad ZIP never stops the others; the uploaded ZIP itself is always removed afterwards (only its contents are kept). */
async function importBrandPackages(zipFiles, req, subId) {
  const results = [];
  for (const zip of zipFiles) {
    try {
      results.push(await importBrandPackage(zip, req, subId));
    } catch (err) {
      results.push({ name: zip.originalname, error: err.message || 'That ZIP could not be imported.' });
    } finally {
      await fs.promises.unlink(zip.path).catch(() => {});
    }
  }
  return results;
}

async function importBrandPackage(zip, req, subId) {
  const pkg = openPackage(zip.path, zip.originalname);
  const structured = hasBrandInfo(pkg); // tokens or written guidelines: they are read for the brand kit and guide
  await classifyUnknownImages(pkg);
  applyCaps(pkg);
  const count = (k) => pkg[k].length;
  if (!structured && !['logos', 'photos', 'textures', 'layouts', 'references', 'pdfs'].some(count)) {
    throw new Error('That ZIP has no images, PDFs or brand guidelines this page can use.');
  }

  // The AI reads the tokens and guidelines (and tags every logo with its version and when to use it). Falls back to a plain reading.
  const interp = await interpretPackage(pkg);
  const logoMeta = new Map(interp.data.logos.map((l) => [l.file, l]));

  const dir = uploadDir(req.tenant);
  const byBucket = {};
  let failed = 0;
  for (const bucket of Object.keys(PACKAGE_KIND)) {
    byBucket[bucket] = [];
    for (const file of pkg[bucket]) {
      try {
        const buf = file.read(100 * 1024 * 1024);
        if (!buf) { failed++; continue; }
        const filename = `${uuidv4()}${file.ext}`;
        await fs.promises.writeFile(path.join(dir, filename), buf);
        const meta = bucket === 'logos' ? logoMeta.get(file.name) || {} : {};
        byBucket[bucket].push(
          await BrandAsset.create({
            user: req.user._id,
            filename,
            originalName: file.name,
            url: uploadUrl(filename, req.tenant),
            mimeType: mimeOfExt(file.ext),
            sizeBytes: buf.length,
            subBrand: subId,
            kind: PACKAGE_KIND[bucket],
            logoVariant: bucket === 'logos' ? meta.variant || '' : '',
            label: meta.label || '',
            notes: meta.notes || ''
          })
        );
      } catch (err) {
        failed++;
        console.warn(`[brand-package] could not import ${file.path}:`, err.message);
      }
    }
  }
  const assets = Object.values(byBucket).flat();

  let legacy = null;
  let applied = null;
  if (structured) {
    // Tokens and written guidelines are the source of truth for colours, fonts and tone: they go into the kit and the brand guide.
    const primaryLogo = byBucket.logos.find((a) => a.logoVariant === 'primary') || byBucket.logos[0] || null;
    applied = await applyPackageToKit({ customerDoc: req.customer, subId, interp, primaryAssetId: primaryLogo?._id || null });
  } else {
    // Just a folder of files: read the first logo and any guideline PDF the way single uploads are read.
    legacy = await analyzeAndApplyDesignLanguage([...byBucket.pdfs, ...byBucket.logos.slice(0, 1)], req.customer, subId);
  }

  const counts = Object.fromEntries(Object.keys(PACKAGE_KIND).map((k) => [k, byBucket[k].length]));
  const summary = { name: interp.data.brandName || pkg.name, file: zip.originalname, counts, skipped: pkg.skipped, failed, fontFiles: pkg.fontFiles.length, ranAI: interp.ranAI, aiNote: interp.note, applied, structured };
  return { name: zip.originalname, assets, summary, ranAI: interp.ranAI || Boolean(legacy?.ranAI), modelUsed: interp.modelUsed || legacy?.modelUsed || '', note: describePackage(summary, legacy), assetsImported: assets.length };
}

/** Writes what a package says into the customer's brand kit (colours, fonts, design language) and, for the main brand, the brand guide. */
async function applyPackageToKit({ customerDoc, subId, interp, primaryAssetId }) {
  const d = interp.data;
  const customer = await Customer.findById(customerDoc._id);
  const subDoc = subId ? findSubBrand(customer, subId) : null;
  const kit = subDoc ? subDoc.brandKit : customer.brandKit;
  const applied = { colors: 0, fonts: [], designLanguage: [], guide: [], kept: [], guideSkipped: Boolean(subDoc) };

  if (d.colors.length) { kit.colors = d.colors.slice(0, 6); applied.colors = kit.colors.length; }

  // The suggested fonts always follow the package; the working fonts only change while they are still the platform's defaults.
  if (d.fonts.display) {
    kit.fonts.suggestedDisplay = d.fonts.display;
    if (!kit.fonts.display || kit.fonts.display === 'Space Grotesk') kit.fonts.display = d.fonts.display;
    applied.fonts.push(d.fonts.display);
  }
  if (d.fonts.body) {
    kit.fonts.suggestedBody = d.fonts.body;
    if (!kit.fonts.body || kit.fonts.body === 'IBM Plex Sans') kit.fonts.body = d.fonts.body;
    applied.fonts.push(d.fonts.body);
  }

  const prev = kit.designLanguage?.toObject ? kit.designLanguage.toObject() : { ...(kit.designLanguage || {}) };
  const edited = Array.isArray(prev.editedFields) ? prev.editedFields : [];
  const roles = {};
  for (const r of ['primary', 'secondary', 'accent', 'neutral']) roles[r] = d.colorRoles[r] || prev.colorRoles?.[r] || '';
  const next = {
    colorRoles: roles,
    logoType: d.logoType || prev.logoType || '',
    typographyImpression: d.typographyImpression || prev.typographyImpression || '',
    moodTags: d.moodTags.length ? d.moodTags : prev.moodTags || [],
    imageryStyle: d.imageryStyle || prev.imageryStyle || '',
    voiceTone: d.voiceTone || prev.voiceTone || '',
    voiceToneSource: d.voiceTone ? 'guideline' : prev.voiceToneSource || '',
    editedFields: edited,
    summary: d.summary || prev.summary || '',
    lastAnalyzedAsset: primaryAssetId || prev.lastAnalyzedAsset || null,
    lastAnalyzedAt: new Date(),
    modelUsed: interp.modelUsed || prev.modelUsed || ''
  };
  // Anything the team edited by hand survives, exactly as with a re-read of a single file.
  for (const f of edited) {
    if (f === 'voiceTone') { next.voiceTone = prev.voiceTone || ''; next.voiceToneSource = prev.voiceToneSource || 'manual'; }
    else if (prev[f] !== undefined) next[f] = prev[f];
  }
  // The package says nothing about tone of voice: look the brand up, as a guideline upload does.
  if (!next.voiceTone && !subDoc) {
    try {
      const found = await findBrandVoice({ brandName: customer.name, industry: customer.industry });
      if (found.voiceTone) { next.voiceTone = found.voiceTone; next.voiceToneSource = 'web'; applied.designLanguage.push('tone of voice (from the web)'); }
    } catch (err) {
      console.warn('[brand-voice] web search failed:', err.message);
    }
  }
  for (const [label, key] of [['summary', 'summary'], ['mood', 'moodTags'], ['imagery style', 'imageryStyle'], ['typography', 'typographyImpression'], ['tone of voice', 'voiceTone'], ['logo type', 'logoType']]) {
    if (d[key] && (Array.isArray(d[key]) ? d[key].length : true) && !edited.includes(key)) applied.designLanguage.push(label);
  }
  kit.designLanguage = next;

  // The brand guide: only the main brand has one (sub-brands inherit it). Writing the person typed stays; empty fields fill; lists add what is new.
  if (!subDoc) {
    const guide = customer.brandKit.guide;
    for (const [key, val] of Object.entries(d.guide || {})) {
      if (Array.isArray(val)) {
        if (!val.length) continue;
        const have = [...(guide[key] || [])];
        const merged = cleanGuide({ [key]: [...have, ...val] })[key] || [];
        if (merged.length > have.length) { guide[key] = merged; applied.guide.push(key); }
      } else if (val) {
        if (String(guide[key] || '').trim()) applied.kept.push(key);
        else { guide[key] = val; applied.guide.push(key); }
      }
    }
    // The guide changed since anyone looked at it, so the "reviewed" stamp no longer applies.
    if (applied.guide.length) { guide.reviewedAt = null; guide.reviewedByName = ''; }
  }

  await customer.save();
  if (customerDoc.set) customerDoc.set(subDoc ? 'subBrands' : 'brandKit', subDoc ? customer.toObject().subBrands : customer.toObject().brandKit);
  return applied;
}

const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

/** One plain-English paragraph for the upload screen: what was imported, what was read from it, and what to check. */
function describePackage(s, legacy) {
  const parts = Object.keys(PACKAGE_KIND).filter((k) => s.counts[k]).map((k) => plural(s.counts[k], PACKAGE_COUNT_LABEL[k]));
  const out = [`Imported ${s.name ? `“${s.name}”` : s.file}: ${parts.join(', ') || 'no files'}.`];
  if (s.structured) {
    const a = s.applied || {};
    const read = [];
    if (a.colors) read.push(`${a.colors} brand colours`);
    if (a.fonts?.length) read.push(`fonts (${[...new Set(a.fonts)].join(', ')})`);
    if (a.designLanguage?.length) read.push([...new Set(a.designLanguage)].join(', '));
    if (a.guide?.length) read.push(`${plural(a.guide.length, ['brand guide field', 'brand guide fields'])} (${a.guide.map((k) => GUIDE_LABEL[k] || k).join(', ')})`);
    if (read.length) out.push(`Read from the package: ${read.join('; ')}.`);
    if (!s.ranAI) out.push('The AI was not available to read the written guidelines, so only the colours, fonts and logos came across. Upload the ZIP again once it is set up, or fill in the brand guide by hand.');
    if (a.kept?.length) out.push(`Kept what the team already wrote for: ${a.kept.map((k) => GUIDE_LABEL[k] || k).join(', ')}.`);
    if (a.guideSkipped) out.push('Sub-brands share the main brand’s guide, so the guide was not changed.');
    if (s.fontFiles) out.push('Font files are not stored; only the font names were saved.');
    out.push('Please review the brand guide and design language below.');
  } else if (legacy?.note) {
    out.push(legacy.note);
  }
  const left = Object.entries(s.skipped).filter(([k, n]) => n && ['logos', 'photos', 'textures', 'layouts', 'references', 'pdfs'].includes(k)).map(([k, n]) => plural(n, PACKAGE_COUNT_LABEL[k]));
  if (left.length) out.push(`Left out (over the per-package limit): ${left.join(', ')}.`);
  if (s.skipped.tooBig) out.push(`${plural(s.skipped.tooBig, ['image was', 'images were'])} over 25 MB and skipped.`);
  if (s.failed) out.push(`${plural(s.failed, ['file', 'files'])} could not be saved.`);
  return out.join(' ');
}

/** Folds the package results into the same shape the single-file analysis returns, plus the package details. */
function mergePackageAnalysis(legacy, results) {
  const ok = results.filter((r) => !r.error);
  const notes = [...ok.map((r) => r.note), ...results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`)];
  if (legacy?.note) notes.push(legacy.note);
  return {
    ranAI: Boolean(legacy?.ranAI) || ok.some((r) => r.ranAI),
    assetsAnalyzed: (legacy?.assetsAnalyzed || 0) + ok.reduce((n, r) => n + r.assetsImported, 0),
    assetsSkipped: legacy?.assetsSkipped || 0,
    modelUsed: ok.map((r) => r.modelUsed).find(Boolean) || legacy?.modelUsed || '',
    note: notes.join(' '),
    packages: ok.map((r) => r.summary)
  };
}

/**
 * Runs AI analysis on every analyzable asset in this upload batch and folds
 * the results into the customer's brandKit (shared by the whole customer team). Colors/typography/logo type/etc take
 * the most recently analyzed asset's values (the point is to reflect what
 * was just uploaded); mood tags are unioned across the whole batch since
 * several small signals compounding is more useful there than overwriting.
 */
async function analyzeAndApplyDesignLanguage(createdAssets, customerDoc, subId = null) {
  const results = await Promise.all(
    createdAssets.map(async (asset) => {
      if (!shapesDesignLanguage(asset)) return { asset, skipped: true, reason: '', quiet: true };
      try {
        const filePath = resolveUploadPath(asset.url || asset.filename);
        const outcome = await analyzeBrandAsset({
          filePath,
          mimeType: asset.mimeType,
          originalName: asset.originalName,
          kind: asset.kind
        });
        return { asset, ...outcome };
      } catch (err) {
        return { asset, skipped: true, reason: err.message };
      }
    })
  );

  const successful = results.filter((r) => !r.skipped);
  const skippedReasons = [...new Set(results.filter((r) => r.skipped).map((r) => r.reason))].filter(Boolean);
  const onlyQuiet = results.length > 0 && results.every((r) => r.quiet);

  if (onlyQuiet) {
    return { ranAI: false, assetsAnalyzed: 0, assetsSkipped: results.length, note: 'Saved. This kind of file is kept as it is and does not change the design language.' };
  }
  if (successful.length === 0) {
    return {
      ranAI: false,
      assetsAnalyzed: 0,
      assetsSkipped: results.length,
      note: skippedReasons[0] || 'No assets in this upload could be analyzed.'
    };
  }

  // Reference images only describe the brand's look (mood, imagery). Their photo colours must never replace the palette.
  const fullReads = successful.filter((r) => r.asset.kind !== 'reference');
  if (fullReads.length === 0) {
    const refUser = await Customer.findById(customerDoc._id);
    const refSub = subId ? findSubBrand(refUser, subId) : null;
    const refKit = refSub ? refSub.brandKit : refUser.brandKit;
    const dlRef = refKit.designLanguage;
    const editedRef = new Set(dlRef.editedFields || []);
    const lastRef = successful[successful.length - 1];
    if (!editedRef.has('moodTags')) {
      dlRef.moodTags = [...new Set([...(dlRef.moodTags || []), ...successful.flatMap((r) => r.analysis?.moodTags || [])])].slice(0, 8);
    }
    const imagery = lastRef.analysis?.imageryStyle;
    if (!editedRef.has('imageryStyle') && imagery && !/^(not applicable|n\/?a|none)$/i.test(String(imagery).trim())) dlRef.imageryStyle = String(imagery).slice(0, 300);
    dlRef.lastAnalyzedAt = new Date();
    dlRef.modelUsed = lastRef.modelUsed || dlRef.modelUsed;
    await refUser.save();
    if (customerDoc.set) customerDoc.set(refSub ? 'subBrands' : 'brandKit', refSub ? refUser.toObject().subBrands : refUser.toObject().brandKit);
    return { ranAI: true, assetsAnalyzed: successful.length, assetsSkipped: results.length - successful.length, modelUsed: lastRef.modelUsed, note: skippedReasons[0] || null, referenceOnly: true };
  }

  const latest = fullReads[fullReads.length - 1];
  const allMoodTags = [...new Set(successful.flatMap((r) => r.analysis?.moodTags || []))].slice(0, 8);

  const user = await Customer.findById(customerDoc._id); // the customer owns the brand kit (var kept named "user" below)
  const a = latest.analysis;
  // A sub-brand's upload feeds that sub-brand's own kit; the main brand's kit is left alone.
  const subDoc = subId ? findSubBrand(user, subId) : null;
  const kit = subDoc ? subDoc.brandKit : user.brandKit;

  if (Array.isArray(a.colors) && a.colors.length) {
    kit.colors = a.colors.slice(0, 6);
  }
  if (a.typography?.suggestedDisplayFont) kit.fonts.suggestedDisplay = a.typography.suggestedDisplayFont;
  if (a.typography?.suggestedBodyFont) kit.fonts.suggestedBody = a.typography.suggestedBodyFont;

  const prev = kit.designLanguage?.toObject ? kit.designLanguage.toObject() : { ...(kit.designLanguage || {}) };
  const edited = Array.isArray(prev.editedFields) ? prev.editedFields : [];
  const next = {
    colorRoles: {
      primary: a.colorRoles?.primary || '',
      secondary: a.colorRoles?.secondary || '',
      accent: a.colorRoles?.accent || '',
      neutral: a.colorRoles?.neutral || ''
    },
    logoType: a.logoType || '',
    typographyImpression: a.typography?.impression || '',
    moodTags: allMoodTags,
    imageryStyle: a.imageryStyle || '',
    voiceTone: a.voiceTone || '',
    voiceToneSource: a.voiceTone ? 'guideline' : '',
    editedFields: edited,
    summary: a.summary || '',
    lastAnalyzedAsset: latest.asset._id,
    lastAnalyzedAt: new Date(),
    modelUsed: latest.modelUsed
  };
  // Anything the team edited by hand survives a re-analysis.
  for (const f of edited) {
    if (f === 'voiceTone') { next.voiceTone = prev.voiceTone || ''; next.voiceToneSource = prev.voiceToneSource || 'manual'; }
    else if (prev[f] !== undefined) next[f] = prev[f];
  }
  // No tone of voice in the guideline: keep what we already have, otherwise look the brand up on the web.
  if (!next.voiceTone) {
    if (prev.voiceTone) { next.voiceTone = prev.voiceTone; next.voiceToneSource = prev.voiceToneSource || ''; }
    else if (!subDoc) {
      try {
        const found = await findBrandVoice({ brandName: user.name, industry: user.industry });
        if (found.voiceTone) { next.voiceTone = found.voiceTone; next.voiceToneSource = 'web'; }
      } catch (err) {
        console.warn('[brand-voice] web search failed:', err.message);
      }
    }
  }
  kit.designLanguage = next;

  await user.save();
  if (customerDoc.set) customerDoc.set(subDoc ? 'subBrands' : 'brandKit', subDoc ? user.toObject().subBrands : user.toObject().brandKit); // keep this request's in-memory view current

  return {
    ranAI: true,
    assetsAnalyzed: successful.length,
    assetsSkipped: results.length - successful.length,
    modelUsed: latest.modelUsed,
    note: skippedReasons[0] || null
  };
}

export async function listAssets(req, res, next) {
  try {
    const filter = isAgency(req.user) ? {} : { kind: { $nin: AGENCY_ONLY_KINDS } };
    const assets = await BrandAsset.find(filter).sort({ createdAt: -1 });
    res.json({ assets });
  } catch (err) {
    next(err);
  }
}

export async function deleteAsset(req, res, next) {
  try {
    const asset = await BrandAsset.findOne({ _id: req.params.id });
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });

    const filePath = resolveUploadPath(asset.url || asset.filename);
    fs.existsSync(filePath) && fs.unlinkSync(filePath);
    await asset.deleteOne();

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function updateBrandKit(req, res, next) {
  try {
    const { colors, displayFont, bodyFont, subBrandId } = req.body;
    if (subBrandId && subBrandId !== 'main') {
      const doc = await Customer.findById(req.customer._id);
      const sub = findSubBrand(doc, subBrandId);
      if (!sub) return res.status(404).json({ error: 'Sub-brand not found.' });
      if (colors) sub.brandKit.colors = colors;
      if (displayFont) sub.brandKit.fonts.display = displayFont;
      if (bodyFont) sub.brandKit.fonts.body = bodyFont;
      await doc.save();
      if (displayFont || bodyFont) buildFontSpecimen(sub.brandKit.fonts).catch(() => {});
      return res.json({ subBrands: listSubBrands(doc) });
    }
    const update = {};
    if (colors) update['brandKit.colors'] = colors;
    if (displayFont) update['brandKit.fonts.display'] = displayFont;
    if (bodyFont) update['brandKit.fonts.body'] = bodyFont;

    const customer = await Customer.findByIdAndUpdate(req.customer._id, { $set: update }, { new: true });
    // The font reference image is made as soon as the fonts change, so the next image never waits for it.
    if (displayFont || bodyFont) buildFontSpecimen(customer.brandKit?.fonts).catch(() => {});
    res.json({ user: req.user.toSafeJSON(customer) });
  } catch (err) {
    next(err);
  }
}

function specimenFonts(req) {
  const id = req.query?.subBrandId || req.body?.subBrandId;
  if (id && id !== 'main') return findSubBrand(req.customer, id)?.brandKit?.fonts;
  return req.customer?.brandKit?.fonts;
}
const specimenPayload = (r) => ({ display: r?.display || '', body: r?.body || '', exists: Boolean(r?.exists), url: r?.url || '', missing: r?.missing || [] });

/** Fonts installed on the server, for the font dropdowns. */
export async function listSystemFonts(_req, res, next) {
  try { res.json({ fonts: await systemFonts() }); } catch (err) { next(err); }
}

/** A .ttf / .otf uploaded for a font. Answers with the family name to set as the headline or body font. */
export async function uploadFontFileHandler(req, res, next) {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'Choose a .ttf or .otf font file.' });
    let meta;
    try { meta = saveCustomFont(req.file.buffer); } catch (e) { return res.status(400).json({ error: e.message }); }
    res.json({ family: meta.family, weight: meta.weight, variable: meta.variable });
  } catch (err) { next(err); }
}

/** The brand's font reference image: whether it exists yet and where it is. Never generates. */
export async function getFontSpecimen(req, res, next) {
  try {
    res.json(specimenPayload(specimenInfo(specimenFonts(req))));
  } catch (err) { next(err); }
}

/** Makes (or, with force, remakes) the brand's font reference image. */
export async function generateFontSpecimen(req, res, next) {
  try {
    const fonts = specimenFonts(req);
    if (!fonts?.display && !fonts?.body) return res.status(400).json({ error: 'Set a headline or body font first.' });
    const r = await buildFontSpecimen(fonts, { force: Boolean(req.body?.force) });
    if (!r?.exists) return res.status(422).json({ error: `Could not build the font reference. ${r?.missing?.length ? `${r.missing.join(' and ')} ${r.missing.length > 1 ? 'were' : 'was'} not found on Google Fonts.` : 'Try again in a little while.'}`, ...specimenPayload(r) });
    res.json(specimenPayload(r));
  } catch (err) { next(err); }
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const LOGO_TYPES = ['wordmark', 'lettermark', 'symbol', 'combination', 'emblem', 'not-a-logo'];
const DL_TEXT = { summary: 600, imageryStyle: 300, voiceTone: 500, typographyImpression: 300 };

/** The team edits the design language (and tone of voice) by hand. Edited fields are remembered so a later upload does not overwrite them. */
export async function updateDesignLanguage(req, res, next) {
  try {
    const body = req.body || {};
    const customer = await Customer.findById(req.customer._id);
    const dl = customer.brandKit.designLanguage;
    const edited = new Set(dl.editedFields || []);
    for (const [f, max] of Object.entries(DL_TEXT)) {
      if (typeof body[f] !== 'string') continue;
      dl[f] = body[f].trim().slice(0, max);
      edited.add(f);
      if (f === 'voiceTone') dl.voiceToneSource = dl.voiceTone ? 'manual' : '';
    }
    if (Array.isArray(body.moodTags)) {
      dl.moodTags = [...new Set(body.moodTags.map((t) => String(t).trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 8);
      edited.add('moodTags');
    }
    if (typeof body.logoType === 'string' && LOGO_TYPES.includes(body.logoType)) {
      dl.logoType = body.logoType;
      edited.add('logoType');
    }
    if (body.colorRoles && typeof body.colorRoles === 'object') {
      for (const role of ['primary', 'secondary', 'accent', 'neutral']) {
        const v = body.colorRoles[role];
        if (typeof v === 'string' && (v === '' || HEX6.test(v.trim()))) dl.colorRoles[role] = v.trim();
      }
      edited.add('colorRoles');
    }
    dl.editedFields = [...edited];
    await customer.save();
    res.json({ user: req.user.toSafeJSON(customer) });
  } catch (err) {
    next(err);
  }
}

/** "Find it on the web": searches for how the brand speaks and fills in the tone of voice (still editable afterwards). */
export async function researchToneOfVoice(req, res, next) {
  try {
    const customer = await Customer.findById(req.customer._id);
    const found = await findBrandVoice({ brandName: req.user?.company?.name || customer.name, industry: req.user?.company?.industry || customer.industry });
    if (!found.voiceTone) return res.status(404).json({ error: 'Could not find enough about this brand online to describe its tone of voice. You can write it in yourself.' });
    const dl = customer.brandKit.designLanguage;
    dl.voiceTone = found.voiceTone;
    dl.voiceToneSource = 'web';
    dl.editedFields = (dl.editedFields || []).filter((f) => f !== 'voiceTone');
    await customer.save();
    res.json({ user: req.user.toSafeJSON(customer) });
  } catch (err) {
    next(err);
  }
}

/** Edit one file's details: its name on the tile, when to use it, what kind it is, which logo version, which brand it belongs to. */
export async function updateAsset(req, res, next) {
  try {
    const asset = await BrandAsset.findOne({ _id: req.params.id });
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    const body = req.body || {};
    if (body.label !== undefined) asset.label = cleanText(body.label, 80);
    if (body.notes !== undefined) asset.notes = cleanText(body.notes, 300);
    if (body.kind !== undefined) {
      if (!ASSET_KINDS.includes(body.kind)) return res.status(400).json({ error: 'Unknown file type.' });
      asset.kind = body.kind;
    }
    if (body.onDark !== undefined) asset.onDark = Boolean(body.onDark);
    if (body.styleGroup !== undefined) asset.styleGroup = asset.kind === 'reference' && ['photo', 'illustration'].includes(body.styleGroup) ? body.styleGroup : '';
    if (body.logoVariant !== undefined) asset.logoVariant = asset.kind === 'logo' ? cleanVariant(body.logoVariant) : '';
    if (asset.kind !== 'logo') asset.logoVariant = '';
    if (body.subBrandId !== undefined) {
      const sid = body.subBrandId && body.subBrandId !== 'main' ? String(body.subBrandId) : null;
      if (sid && !findSubBrand(req.customer, sid)) return res.status(400).json({ error: 'That sub-brand no longer exists.' });
      asset.subBrand = sid;
    }
    await asset.save();
    res.json({ asset });
  } catch (err) {
    next(err);
  }
}

/** Read this file again (after changing its type, or to refresh what the AI understood from it). */
export async function reanalyzeAsset(req, res, next) {
  try {
    const asset = await BrandAsset.findOne({ _id: req.params.id });
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    const analysis = await analyzeAndApplyDesignLanguage([asset], req.customer, asset.subBrand ? String(asset.subBrand) : null);
    const customer = await Customer.findById(req.customer._id);
    res.json({ analysis, user: req.user.toSafeJSON(customer), subBrands: listSubBrands(customer) });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Brand guide (super admin): customer-specific instructions + a review of what the AI is told
// ---------------------------------------------------------------------------

async function guidePayload(customerId, company = {}) {
  const customer = await Customer.findById(customerId);
  const kit = customer.toObject().brandKit || {};
  const files = await BrandAsset.find({}, 'kind logoVariant').lean();
  const count = (k) => files.filter((f) => f.kind === k).length;
  return {
    // The uploaded .md itself can be large and the editor never shows it: send only whether one is stored.
    guide: kit.guide ? { ...kit.guide, photography: { ...(kit.guide.photography || {}), source: undefined, hasSource: Boolean(kit.guide.photography?.source) } } : {},
    preview: brandGuidePreview(kit, { name: company.name || customer.name, industry: company.industry || customer.industry }),
    counts: { logos: count('logo'), references: count('reference'), layouts: count('layout') }
  };
}

export async function getGuide(req, res, next) {
  try {
    res.json(await guidePayload(req.customer._id, req.user?.company));
  } catch (err) {
    next(err);
  }
}

/** POST (multipart, a few images at a time): reads past published assets and returns a short note for each. Nothing is saved. */
export async function readPastAssetsHandler(req, res, next) {
  try {
    const files = (req.files || []).filter((f) => f?.buffer?.length);
    if (!files.length) return res.status(400).json({ error: 'Add at least one image of a past asset.' });
    res.json(await readPastAssets(files));
  } catch (err) {
    if (err.noAI) return res.status(503).json({ error: err.message, isBillingError: Boolean(err.isBillingError) });
    next(err);
  }
}

/** POST { notes } -> proposed style rules for the editor to review. Nothing is saved. */
export async function synthesizePastAssetsHandler(req, res, next) {
  try {
    const customer = await Customer.findById(req.customer._id);
    res.json(await synthesizeRules({ notes: req.body?.notes, brandName: req.user?.company?.name || customer?.name || '' }));
  } catch (err) {
    if (err.noAI) return res.status(503).json({ error: err.message });
    next(err);
  }
}

/**
 * POST { name, text } - the super admin uploaded a photography guide (.md). The AI condenses it into photography-only
 * fields for the editor to review. Nothing is saved here; "Save brand guide" stores it (see updateGuide).
 */
export async function readPhotographyHandler(req, res, next) {
  try {
    const name = String(req.body?.name || '').slice(0, 120);
    const customer = await Customer.findById(req.customer._id);
    // { reuse: true } reads the file stored with the guide again instead of a new upload.
    const stored = customer?.brandKit?.guide?.photography;
    const text = req.body?.reuse ? stored?.source || '' : typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) return res.status(400).json({ error: req.body?.reuse ? 'There is no stored photography guide to read again.' : 'Add a .md file with your photography guidance.' });
    const r = await readPhotographyGuide({ text, brandName: req.user?.company?.name || customer?.name || '' });
    res.json({ fileName: req.body?.reuse ? stored?.fileName || '' : name, ...r });
  } catch (err) {
    if (err.noAI) return res.status(503).json({ error: err.message });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/** PATCH a partial guide. { reviewed: true } stamps "reviewed by <name> on <date>" for the understanding of the guidelines. */
export async function updateGuide(req, res, next) {
  try {
    const body = req.body || {};
    const customer = await Customer.findById(req.customer._id);
    const guide = customer.brandKit.guide;
    const clean = cleanGuide(body);
    for (const [k, v] of Object.entries(clean)) {
      // The photography guide is a nested object: set only the keys that were sent so a save without `source` keeps the stored file.
      if (k === 'photography') {
        for (const [pk, pv] of Object.entries(v)) guide.photography[pk] = pv;
        if (typeof v.source === 'string') guide.photography.uploadedAt = v.source ? new Date() : null;
        continue;
      }
      guide[k] = v;
    }
    if (body.reviewed === true) {
      guide.reviewedAt = new Date();
      guide.reviewedByName = req.user?.name || '';
    }
    await customer.save();
    res.json(await guidePayload(req.customer._id, req.user?.company));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Sub-brands (each with its own uploads + brand guideline)
// ---------------------------------------------------------------------------

const publicSub = (s) => (s.toObject ? s.toObject() : s);

export async function listSubBrandsHandler(req, res, next) {
  try {
    const customer = await Customer.findById(req.customer._id);
    res.json({ subBrands: listSubBrands(customer) });
  } catch (err) {
    next(err);
  }
}

export async function createSubBrand(req, res, next) {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Give the sub-brand a name.' });
    const customer = await Customer.findById(req.customer._id);
    if (customer.subBrands.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'A sub-brand with that name already exists.' });
    }
    customer.subBrands.push({ name, description: String(req.body.description || '').trim().slice(0, 300), keywords: cleanKeywords(req.body.keywords) });
    await customer.save();
    res.status(201).json({ subBrands: listSubBrands(customer), subBrand: publicSub(customer.subBrands[customer.subBrands.length - 1]) });
  } catch (err) {
    next(err);
  }
}

export async function updateSubBrand(req, res, next) {
  try {
    const customer = await Customer.findById(req.customer._id);
    const sub = findSubBrand(customer, req.params.id);
    if (!sub) return res.status(404).json({ error: 'Sub-brand not found.' });
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Give the sub-brand a name.' });
      sub.name = name;
    }
    if (req.body.description !== undefined) sub.description = String(req.body.description).trim().slice(0, 300);
    if (req.body.keywords !== undefined) sub.keywords = cleanKeywords(req.body.keywords);
    await customer.save();
    res.json({ subBrands: listSubBrands(customer) });
  } catch (err) {
    next(err);
  }
}

/** ?assets=delete removes the sub-brand's uploads too; the default keeps them and moves them to the main brand. */
export async function deleteSubBrand(req, res, next) {
  try {
    const customer = await Customer.findById(req.customer._id);
    const sub = findSubBrand(customer, req.params.id);
    if (!sub) return res.status(404).json({ error: 'Sub-brand not found.' });
    const own = await BrandAsset.find({ subBrand: sub._id });
    if (req.query.assets === 'delete') {
      for (const asset of own) {
        const filePath = resolveUploadPath(asset.url || asset.filename);
        fs.existsSync(filePath) && fs.unlinkSync(filePath);
        await asset.deleteOne();
      }
    } else if (own.length) {
      await BrandAsset.updateMany({ subBrand: sub._id }, { $set: { subBrand: null } });
    }
    sub.deleteOne();
    await customer.save();
    res.json({ subBrands: listSubBrands(customer), assetsDeleted: req.query.assets === 'delete' ? own.length : 0, assetsMoved: req.query.assets === 'delete' ? 0 : own.length });
  } catch (err) {
    next(err);
  }
}

/** Free keyword-only match, used live while the brief is typed. The model fallback only runs when a post is created. */
export async function detectSubBrandHandler(req, res, next) {
  try {
    const customer = await Customer.findById(req.customer._id);
    const text = [req.body.purpose, req.body.briefNote, req.body.primaryMessage].filter(Boolean).join(' . ');
    const hit = detectByKeyword(customer.subBrands, text);
    res.json({ subBrand: hit ? { id: hit.sub._id, name: hit.sub.name, matched: hit.matched } : null });
  } catch (err) {
    next(err);
  }
}

// ---- Languages: what post copy, headlines and sub-headlines are written in -------------------------------------
const languagePayload = (c) => ({
  available: LANGUAGES,
  languages: c?.languages || [],
  defaultLanguage: c?.defaultLanguage || DEFAULT_LANGUAGE
});

export async function getLanguages(req, res, next) {
  try {
    res.json(languagePayload(await Customer.findById(req.customer._id).lean()));
  } catch (err) {
    next(err);
  }
}

/** PATCH { languages?: string[], defaultLanguage?: string }. English is always allowed and is the default when nothing is set. */
export async function updateLanguages(req, res, next) {
  try {
    const customer = await Customer.findById(req.customer._id);
    const body = req.body || {};
    if (Array.isArray(body.languages)) {
      const list = [...new Set(body.languages.map((l) => String(l).trim()))].filter((l) => l !== DEFAULT_LANGUAGE);
      const bad = list.find((l) => !isKnownLanguage(l));
      if (bad) return res.status(400).json({ error: `"${bad}" is not in the language list.` });
      customer.languages = list.slice(0, 30);
    }
    if (typeof body.defaultLanguage === 'string') {
      const d = body.defaultLanguage.trim();
      if (d && d !== DEFAULT_LANGUAGE && !customer.languages.includes(d)) return res.status(400).json({ error: 'Add that language first, then make it the default.' });
      customer.defaultLanguage = d === DEFAULT_LANGUAGE ? '' : d;
    }
    // removing the default language falls back to English
    if (customer.defaultLanguage && !customer.languages.includes(customer.defaultLanguage)) customer.defaultLanguage = '';
    await customer.save();
    res.json(languagePayload(customer));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Asset gallery (super admin): every image and video generated in this customer's workspace
// ---------------------------------------------------------------------------

const SOURCE_LABEL = { new: 'New Creative', adaptation: 'Creative Edit', headline: 'Headline Switch', hero: 'Subject Swap', resize: 'Size Adapt', convert: 'Convert to Video', multiscene: 'Multi-scene video' };

/** GET -> { items: [{ id, postId, type: 'image'|'video', url, title, source, at }], total } newest first (up to 600). */
export async function galleryHandler(req, res, next) {
  try {
    const posts = await Post.find({}, 'designs creativeType createdAt updatedAt').sort({ updatedAt: -1 }).limit(400).lean();
    const seen = new Set();
    const items = [];
    for (const post of posts) {
      const source = SOURCE_LABEL[post.creativeType] || 'Creative';
      const at = post.updatedAt || post.createdAt;
      const add = (type, url, title, d, extra = '') => {
        if (!url || seen.has(url)) return;
        seen.add(url);
        items.push({ id: `${post._id}:${items.length}`, postId: String(post._id), type, url, title: (title || d?.directionTitle || d?.label || source).slice(0, 80), source: extra ? `${source} · ${extra}` : source, at });
      };
      for (const d of post.designs || []) {
        const title = d.headlineText || d.directionTitle || '';
        add('image', d.imageUrl, title, d);
        for (const s of d.carouselSlides || []) add('image', s.imageUrl, title, d, `slide ${Number(s.index) + 1 || ''}`.trim());
        for (const v of d.formatVariants || []) if (v.status !== 'pending' && v.status !== 'failed') add('image', v.imageUrl, title, d, v.formatId);
        for (const j of d.videoJobs || []) if (j.status === 'completed') add('video', j.videoUrl, title, d, j.formatId);
      }
    }
    res.json({ items: items.slice(0, 600), total: items.length });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// AI search (super admin): "the white logo for dark banners", "festive layouts", "photos of the SUV"
// ---------------------------------------------------------------------------

const searchWords = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/** Plain keyword match over names, notes, type and logo version. Used when no AI model is configured or the AI reply is unusable. */
function keywordMatches(rows, query) {
  const words = searchWords(query);
  if (!words.length) return [];
  return rows
    .map((r) => {
      const hay = searchWords(`${r.name} ${r.file} ${r.type} ${r.version} ${r.note} ${r.brand}`);
      const score = words.reduce((n, w) => n + (hay.some((h) => h.includes(w)) ? 1 : 0), 0);
      return { id: r.id, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.id);
}

/** POST { query } -> { ids: [asset ids, best first], explanation, usedAI }. */
export async function searchAssets(req, res, next) {
  try {
    const query = String(req.body?.query || '').trim().slice(0, 300);
    if (!query) return res.json({ ids: [], explanation: '', usedAI: false });

    const customer = await Customer.findById(req.customer._id);
    const subs = listSubBrands(customer) || [];
    const brandOf = (id) => (id ? subs.find((b) => String(b._id) === String(id))?.name || 'Sub-brand' : 'Main brand');
    const assets = await BrandAsset.find({}).sort({ createdAt: -1 }).limit(400).lean();
    const rows = assets.map((a) => ({
      id: String(a._id),
      name: a.label || a.originalName,
      file: a.originalName,
      type: a.kind,
      version: a.logoVariant || '',
      note: a.notes || '',
      brand: brandOf(a.subBrand)
    }));
    if (!rows.length) return res.json({ ids: [], explanation: 'There are no files yet.', usedAI: false });

    let ids = [];
    let explanation = '';
    let usedAI = false;
    try {
      const r = await generateText({
        model: 'auto',
        maxTokens: 700,
        purpose: 'brand asset search',
        system: 'You help an agency find files in a brand library. You only use the file list you are given. Reply with ONLY a JSON object, no markdown.',
        prompt: [
          `The super admin is looking for: "${query}"`,
          'Files (one JSON object per line: id, name, original file name, type, logo version, note on when to use it, brand):',
          rows.map((x) => JSON.stringify(x)).join('\n'),
          'Pick the files that best match what they are looking for, best match first (at most 24). Judge by meaning, not only exact words: a "dark background logo" matches a white logo version; "festive" matches names or notes about festivals or offers.',
          'Reply as: {"ids":["<id>", ...],"explanation":"one short sentence saying what you matched on, or why nothing matches"}'
        ].join('\n')
      });
      if (r?.text && r.modelUsed !== 'placeholder' && r.modelUsed !== 'none') {
        const m = String(r.text).match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : null;
        const valid = new Set(rows.map((x) => x.id));
        if (parsed && Array.isArray(parsed.ids)) {
          ids = [...new Set(parsed.ids.map(String).filter((id) => valid.has(id)))].slice(0, 24);
          explanation = String(parsed.explanation || '').slice(0, 240);
          usedAI = true;
        }
      }
    } catch (err) {
      console.warn('[brand-assets] AI search failed, using keyword match:', err.message);
    }

    if (!usedAI) {
      ids = keywordMatches(rows, query).slice(0, 24);
      explanation = ids.length ? 'AI is not available, so this matched your words against file names and notes.' : 'No file name or note contains those words. (AI search is not available right now.)';
    }
    res.json({ ids, explanation, usedAI });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Brand profile (super admin): the structured Brand Assets screen
// (Guidelines, Assets, Colors, Imagery, Languages & Fonts). See utils/brandProfile.js.
// ---------------------------------------------------------------------------

const defaultCode = (customer) => languageCode(customer?.defaultLanguage || DEFAULT_LANGUAGE).toLowerCase();

/** What the screen needs: every box's items, the guidelines PDF it came from and the two style summaries. */
function profilePayload(customer) {
  const p = customer.toObject().brandKit?.profile || {};
  return {
    items: p.items || {},
    doc: p.doc || null,
    styleSummary: p.styleSummary || null,
    illSummary: p.illSummary || null,
    defaultLanguageCode: defaultCode(customer)
  };
}

/** First time a customer is opened on the new screen: build the boxes from the older guide, colours and fonts. Nothing older is removed. */
async function ensureProfile(customerId) {
  let customer = await Customer.findById(customerId);
  const p = customer.brandKit?.profile;
  if (p && p.migrated) return customer;
  const items = { ...(p?.items || {}), ...deriveProfile(customer.toObject().brandKit, defaultCode(customer)) };
  customer = await Customer.findByIdAndUpdate(customerId, { $set: { 'brandKit.profile': { ...(p || {}), items, migrated: true } } }, { new: true });
  return customer;
}

/** Boxes that are still empty adopt what the older fields now hold (after a ZIP package or an analysed file filled them). */
async function adoptLegacyIntoProfile(customerId) {
  const customer = await ensureProfile(customerId);
  const kit = customer.toObject().brandKit || {};
  const profile = kit.profile || { items: {} };
  profile.items = profile.items || {};
  let changed = false;
  for (const [box, arr] of Object.entries(deriveProfile(kit, defaultCode(customer)))) {
    if (!(profile.items[box] || []).length) { profile.items[box] = arr; changed = true; }
  }
  if (changed) await Customer.findByIdAndUpdate(customerId, { $set: { 'brandKit.profile': profile } });
}

export async function getProfile(req, res, next) {
  try {
    res.json(profilePayload(await ensureProfile(req.customer._id)));
  } catch (err) {
    next(err);
  }
}

/** Writes the older fields (guide, colours, fonts) from the profile, so every existing prompt path keeps working. */
async function saveProfile(customerId, mutate) {
  const customer = await ensureProfile(customerId);
  const profile = JSON.parse(JSON.stringify(customer.toObject().brandKit?.profile || {}));
  profile.items = profile.items || {};
  mutate(profile);
  const set = { 'brandKit.profile': profile, ...legacyPatch(profile, { defaultLanguageCode: defaultCode(customer) }) };
  const before = customer.brandKit?.fonts;
  const updated = await Customer.findByIdAndUpdate(customerId, { $set: set }, { new: true });
  const f = updated.brandKit?.fonts;
  if (f && (f.display !== before?.display || f.body !== before?.body)) buildFontSpecimen(f).catch(() => {});
  return updated;
}

/** PATCH { items: { boxId: [item] } } replaces only the boxes that were sent. { styleEdits: { photo: {sectionId: text}, illustration: {...} } } saves edits to the summaries. */
export async function updateProfile(req, res, next) {
  try {
    const body = req.body || {};
    const cleaned = cleanProfileItems(body.items);
    const updated = await saveProfile(req.customer._id, (profile) => {
      for (const [box, arr] of Object.entries(cleaned)) profile.items[box] = arr;
      // a language removed from the workspace takes its font box with it
      for (const key of Object.keys(profile.items)) if (FONT_BOX.test(key) && !(profile.items[key] || []).length) delete profile.items[key];
      for (const [k, field] of [['photo', 'styleSummary'], ['illustration', 'illSummary']]) {
        const e = body.styleEdits && body.styleEdits[k];
        if (e && typeof e === 'object' && profile[field]) profile[field] = cleanStyleSummary({ ...profile[field], edits: e });
      }
    });
    res.json(profilePayload(updated));
  } catch (err) {
    next(err);
  }
}

const noAI = (err, res) => {
  if (err.noAI) { res.status(503).json({ error: err.message, isBillingError: Boolean(err.isBillingError) }); return true; }
  if (err.status) { res.status(err.status).json({ error: err.message }); return true; }
  return false;
};

/**
 * POST multipart (one PDF): stores the PDF as a Template file, reads it, and sorts what Automatr needs into the boxes.
 * The previous PDF's untouched items are replaced; anything the team added or edited stays.
 */
export async function readGuidelinesHandler(req, res, next) {
  const file = (req.files || [])[0];
  try {
    if (!file || file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Choose a PDF file.' });
    const customer = await ensureProfile(req.customer._id);
    const code = defaultCode(customer);
    let read;
    try {
      read = await readGuidelinesPdf({ filePath: resolveUploadPath(file.filename), brandName: req.user?.company?.name || customer.name || '' });
    } catch (err) {
      fs.existsSync(resolveUploadPath(file.filename)) && fs.unlinkSync(resolveUploadPath(file.filename));
      if (noAI(err, res)) return;
      throw err;
    }
    const oldDocAsset = customer.toObject().brandKit?.profile?.doc?.assetId;
    const asset = await BrandAsset.create({
      user: req.user._id, filename: file.filename, originalName: file.originalname, url: uploadUrl(file.filename, req.tenant),
      mimeType: file.mimetype, sizeBytes: file.size, subBrand: null, kind: 'template', label: 'Brand guidelines PDF', notes: ''
    });
    if (oldDocAsset) {
      const old = await BrandAsset.findOne({ _id: oldDocAsset });
      if (old) { const fp = resolveUploadPath(old.url || old.filename); fs.existsSync(fp) && fs.unlinkSync(fp); await old.deleteOne(); }
    }
    const updated = await saveProfile(req.customer._id, (profile) => {
      const fontId = `fonts-${code}`;
      const fresh = { ...read.items };
      if (read.fonts.length) fresh[fontId] = cleanProfileItems({ [fontId]: read.fonts })[fontId] || [];
      for (const box of new Set([...Object.keys(profile.items), ...Object.keys(fresh)])) {
        const kept = (profile.items[box] || []).filter((it) => it.from !== 'pdf' || it.edited);
        const seen = new Set(kept.map((it) => `${it.text || it.url || it.value || it.name || it.family}|${it.hex || ''}|${it.role || ''}`.toLowerCase()));
        const add = (fresh[box] || []).filter((it) => { const k = `${it.text || it.url || it.value || it.name || it.family}|${it.hex || ''}|${it.role || ''}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        const merged = cleanProfileItems({ [box]: [...kept, ...add] })[box] || [];
        if (merged.length) profile.items[box] = merged; else delete profile.items[box];
      }
      const found = Object.values(profile.items).flat().filter((it) => it.from === 'pdf').length;
      profile.doc = { ...cleanDoc({ name: file.originalname, size: file.size, pages: read.pages, mode: 'ai', at: new Date(), found, skipped: read.skipped }), assetId: String(asset._id) };
    });
    res.status(201).json(profilePayload(updated));
  } catch (err) {
    next(err);
  }
}

/** DELETE: removes what was read from the guidelines PDF (what the team added or edited stays) and the stored PDF itself. */
export async function removeGuidelinesHandler(req, res, next) {
  try {
    const customer = await ensureProfile(req.customer._id);
    const assetId = customer.toObject().brandKit?.profile?.doc?.assetId;
    const updated = await saveProfile(req.customer._id, (profile) => {
      for (const box of Object.keys(profile.items)) {
        const kept = profile.items[box].filter((it) => it.from !== 'pdf' || it.edited);
        if (kept.length) profile.items[box] = kept; else delete profile.items[box];
      }
      profile.doc = null;
    });
    if (assetId) {
      const a = await BrandAsset.findOne({ _id: assetId });
      if (a) { const fp = resolveUploadPath(a.url || a.filename); fs.existsSync(fp) && fs.unlinkSync(fp); await a.deleteOne(); }
    }
    res.json(profilePayload(updated));
  } catch (err) {
    next(err);
  }
}

/**
 * POST { confirm: 'RESET' } (super admin): puts Brand Assets back to a brand-new customer.
 * Removes every uploaded file (and its file on disk), the guidelines PDF, every instruction and colour, both style summaries,
 * the guide, design language, colours and fonts, the added languages and every sub-brand. Nothing is kept.
 */
export async function resetBrandAssetsHandler(req, res, next) {
  try {
    if (req.body?.confirm !== 'RESET') return res.status(400).json({ error: 'Send confirm: "RESET" to reset all brand assets.' });
    const assets = await BrandAsset.find({});
    let files = 0;
    for (const asset of assets) {
      const fp = resolveUploadPath(asset.url || asset.filename);
      try { if (fs.existsSync(fp)) { fs.unlinkSync(fp); files += 1; } } catch { /* the record still goes */ }
    }
    await BrandAsset.deleteMany({ _id: { $in: assets.map((a) => a._id) } });
    // schema defaults give the same colours, fonts and empty guide a new customer starts with
    const fresh = new Customer({}).toObject().brandKit;
    const customer = await Customer.findByIdAndUpdate(
      req.customer._id,
      {
        $set: {
          'brandKit.profile': { items: {}, doc: null, styleSummary: null, illSummary: null, migrated: true },
          'brandKit.guide': fresh.guide,
          'brandKit.designLanguage': fresh.designLanguage,
          'brandKit.colors': fresh.colors,
          'brandKit.fonts': fresh.fonts,
          languages: [],
          defaultLanguage: '',
          subBrands: []
        }
      },
      { new: true }
    );
    res.json({ ok: true, assetsDeleted: assets.length, filesDeleted: files, brandKit: customer.toObject().brandKit, profile: profilePayload(customer), languages: languagePayload(customer) });
  } catch (err) {
    next(err);
  }
}

/** POST { kind: 'photo' | 'illustration', force?: boolean } -> reads the reference images and writes the style summary. Re-reads only when the images or notes changed. */
export async function styleSummaryHandler(req, res, next) {
  try {
    const kind = req.body?.kind === 'illustration' ? 'illustration' : 'photo';
    const field = kind === 'photo' ? 'styleSummary' : 'illSummary';
    const customer = await ensureProfile(req.customer._id);
    const profile = customer.toObject().brandKit?.profile || {};
    const assets = await BrandAsset.find({ kind: 'reference', styleGroup: kind === 'photo' ? { $ne: 'illustration' } : 'illustration', subBrand: null }).sort({ createdAt: 1 });
    if (!assets.length) {
      if (profile[field]) await Customer.findByIdAndUpdate(req.customer._id, { $unset: { [`brandKit.profile.${field}`]: '' } });
      return res.json({ summary: null });
    }
    const instructions = (profile.items?.[kind === 'photo' ? 'refs' : 'illustration'] || []).map((i) => i.text);
    const key = `${assets.map((a) => `${a._id}:${a.label || a.originalName}`).join('|')}#${instructions.join('|')}`.slice(0, 200);
    if (profile[field]?.key === key && !req.body?.force) return res.json({ summary: profile[field] });
    const built = await buildStyleSummary({ assets, kind, instructions, brandName: req.user?.company?.name || customer.name || '' });
    const keepEdits = req.body?.force ? {} : profile[field]?.edits || {};
    const summary = cleanStyleSummary({ ...built, key, edits: keepEdits });
    await Customer.findByIdAndUpdate(req.customer._id, { $set: { [`brandKit.profile.${field}`]: summary } });
    res.json({ summary });
  } catch (err) {
    if (noAI(err, res)) return;
    next(err);
  }
}
