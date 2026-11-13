import path from 'node:path';
import sharp from 'sharp';
import fs from 'node:fs';
import Post from '../models/Post.js';
import BrandAsset from '../models/BrandAsset.js';
import { markAssetsDeleted } from '../services/generationRecordService.js';
import { resolveUploadPath, uploadUrl, uploadDir, storageUsedBytes, DEFAULT_STORAGE_MB } from '../utils/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { deliverSafely } from '../services/deliveryService.js';
import * as captionService from '../services/ai/captionService.js';
import * as designService from '../services/ai/designService.js';
import * as lookAndFeelService from '../services/ai/lookAndFeelService.js';
import * as messageSuggestionService from '../services/ai/messageSuggestionService.js';
import { getFormat, isVideoFormat, isCarouselFormat, modelSizeFor } from '../constants/postFormats.js';
import { generationUsage } from '../services/customerService.js';
import * as router from '../services/ai/router.js';
import * as videoRouter from '../services/ai/videoRouter.js';
import { suggestVideoIdeas, suggestMotionPrompt, composeVideoPrompt } from '../services/ai/videoIdeasService.js';
import { lockVideoText } from '../utils/videoTextLock.js';
import { checkVideoQuality } from '../services/ai/videoQualityService.js';
import { aiLog } from '../utils/aiLog.js';
import { saveGeneratedImage } from '../utils/saveGeneratedImage.js';
import { compositeExactAssets } from '../utils/compositeExactAssets.js';
import { saveGeneratedVideo } from '../utils/saveGeneratedVideo.js';
import { cleanVideoSize, nearestVideoAspect, fitVideoToSize } from '../utils/fitVideoToSize.js';
import { deployToPlatform, SUPPORTED_PLATFORMS } from '../services/publishConnectors.js';
import { estimateImageCostUsdByProvider } from '../services/costEstimateService.js';
import { resolveSubBrand, findSubBrand, userWithSubBrand } from '../services/subBrandService.js';
import { logUsageSafely, logVideoUsage, attachVideoUrl, markVideoFailed } from '../services/aiUsageLogService.js';
import { editTextRules } from '../utils/textVerify.js';

// Members work on their own posts. A customer's admin (and agency admins inside a customer)
// can open, edit, approve and deliver any post in that customer's workspace. The customer
// itself is always enforced by the tenant plugin, never by this filter.
const ownerFilter = (req) => (req.user.role === 'member' ? { user: req.user._id } : {});

async function loadOwnedPost(req) {
  const post = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) });
  return post;
}

/**
 * Builds the attribution object router.js needs to record an AI usage log
 * entry - who triggered it, what feature ("action"), and which post (if
 * any) it belongs to. Passed straight through the service-layer functions
 * down to router.generateText/generateImage; see AiUsageLog.js.
 */
function buildUsageContext(req, action, postId = null) {
  return { userId: req.user._id, userName: req.user.name, userEmail: req.user.email, action, postId };
}

// gpt-image-1's edit endpoint and Gemini's inline-data input both expect
// rasterized images - SVG/PDF selected as brand assets can't be used as
// direct reference images (no rasterization step wired up), so those are
// silently skipped here. They just won't ground the generation visually;
// nothing errors.
const REFERENCEABLE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

/**
 * Resolves both reference sources into the actual files the image model
 * will see: brand assets selected on Step 01 (always "grounding" - the
 * real product/logo that must appear), and post-scoped ad-hoc reference
 * creatives uploaded on Step 02 (either "include" - grounding too - or
 * "style" - match mood/treatment only, not literal subject).
 *
 * Either source can additionally be flagged "exact" by the user (brand
 * assets via exactAssetIds, reference creatives via their own `exact`
 * field) - meaning it must appear completely unmodified, not reinterpreted
 * by the AI model at all. Since a generation prompt can only ever ask a
 * model to *try* to reproduce something exactly (never guarantee it),
 * exact-flagged images are routed to their own bucket and are never sent
 * to the AI as a reference image - designService composites them onto the
 * finished image afterward instead (see compositeExactAssets.js).
 *
 * Returns { groundingImages, styleImages, exactAssets } so callers can
 * word the prompt differently for each and composite exactAssets in
 * post-processing; groundingImages + styleImages are combined into one
 * flat list for the AI call since the image APIs don't distinguish roles.
 */
// One switch for everything brand-guideline related (brand assets, colours, imagery style,
// mood tags, voice, brand name). Off when the person unticked "Follow Brand Assets & Guidelines"
// OR removed every brand asset in Step 02 - then none of it may reach any AI prompt.
function brandFollowed(req, selectedAssets, post) {
  // The creative's own "Follow my brand's design language" tick (New Creative -> Brand assets) comes first.
  if (post?.creativeBrief?.followBrand === false || req?.body?.creativeBrief?.followBrand === false) return false;
  return req?.body?.followBrand !== false && Array.isArray(selectedAssets) && selectedAssets.length > 0;
}

// How many design options this customer's creatives show (Admin -> Customers -> create / edit): 1, 2 or 3.
const customerOptionCount = (req) => designService.clampOptionCount(req?.customer?.features?.designOptions);

// A stand-in for req.user with the brand kit blanked, for creatives that don't follow the brand: caption/copy
// prompts then get no brand voice, mood or imagery style.
function brandOff(post, req) {
  return post?.creativeBrief?.followBrand === false || req?.body?.creativeBrief?.followBrand === false;
}
function brandUser(req, post) {
  if (!brandOff(post, req)) {
    // A creative made for a sub-brand reads that sub-brand's guideline laid over the main brand's.
    const sub = post?.subBrand ? findSubBrand(req.customer, post.subBrand) : null;
    return sub ? userWithSubBrand(req.user, sub) : req.user;
  }
  const u = req.user;
  // Only the photography guide and the brand's font names survive: neither carries a brand name or colour, and both apply to every new image.
  const photography = u.brandKit?.guide?.photography;
  const f = u.brandKit?.fonts;
  const fonts = { display: f?.display || '', body: f?.body || '' };
  return { _id: u._id, name: u.name, email: u.email, role: u.role, company: u.company, brandKit: { colors: [], fonts, designLanguage: {}, ...(photography ? { guide: { photography } } : {}) } };
}

// Which sub-brand a brief is for. choice: 'main' | a sub-brand id | 'auto' (detect from the brief text).
const briefText = (b = {}) => [b.purpose, b.briefNote, b.primaryMessage || b.creativeBrief?.primaryMessage].filter(Boolean).join(' . ');

// Super-admin brand material sent automatically whenever the brand is followed: images used only to read the brand's
// look and feel, and preferred layouts to start a composition from. Capped so the image request stays small.
const AUTO_BRAND_REFS = { reference: 3, layout: 2 };

async function resolveReferenceImages(selectedAssetIds, referenceCreatives = [], exactAssetIds = [], followBrand = true, subBrandId = null) {
  // followBrand=false (Step 02 checkbox): selected brand assets are not sent to the model at all.
  const brandAssets = followBrand !== false && selectedAssetIds?.length ? await BrandAsset.find({ _id: { $in: selectedAssetIds } }).lean() : [];
  const exactIdSet = new Set((exactAssetIds || []).map((id) => String(id)));

  const groundingImages = [];
  const exactAssets = [];
  for (const a of brandAssets) {
    if (!REFERENCEABLE_MIME.has(a.mimeType)) continue;
    const resolved = { filePath: resolveUploadPath(a.url || a.filename), mimeType: a.mimeType, filename: a.originalName };
    // Product packshots marked "keep exact" are pasted in unchanged at the centre (product lock);
    // logos/other assets keep going to a corner.
    if (exactIdSet.has(String(a._id))) exactAssets.push(a.kind === 'product' ? { ...resolved, anchor: 'center' } : resolved);
    else groundingImages.push(resolved);
  }

  const styleImages = [];
  // Same switch as the picked assets above: off (or every brand asset removed) means none of this is sent.
  if (followBrand !== false && selectedAssetIds?.length) {
    const extra = await BrandAsset.find({
      kind: { $in: Object.keys(AUTO_BRAND_REFS) },
      $or: [{ subBrand: null }, ...(subBrandId ? [{ subBrand: subBrandId }] : [])]
    }).sort({ createdAt: -1 }).limit(24).lean();
    const taken = { reference: 0, layout: 0 };
    for (const a of extra) {
      if (!REFERENCEABLE_MIME.has(a.mimeType) || taken[a.kind] >= AUTO_BRAND_REFS[a.kind]) continue;
      taken[a.kind] += 1;
      styleImages.push({ filePath: resolveUploadPath(a.url || a.filename), mimeType: a.mimeType, filename: a.originalName, role: a.kind === 'layout' ? 'layout' : 'brand-reference' });
    }
  }
  for (const ref of referenceCreatives) {
    if (!REFERENCEABLE_MIME.has(ref.mimeType)) continue;
    const resolved = { filePath: resolveUploadPath(ref.url || ref.filename), mimeType: ref.mimeType, filename: ref.originalName || ref.filename };
    if (ref.mode === 'style') styleImages.push(resolved);
    else if (ref.exact) exactAssets.push({ ...resolved, anchor: ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'].includes(ref.anchor) ? ref.anchor : 'bottom-right' });
    // Template images still need to reach the model as real pixel input
    // (same as any other grounding image), so they go in the same array -
    // only tagged differently so designService.js can word the prompt as
    // "preserve this creative" rather than "use this as the subject in a
    // new scene". See referenceInstructionText in designService.js.
    else if (ref.mode === 'template') groundingImages.push({ ...resolved, role: 'template' });
    else groundingImages.push(resolved);
  }

  return { groundingImages, styleImages, exactAssets };
}

/**
 * Uploads a one-off reference creative for this post only - either a style
 * reference (match mood/treatment, e.g. a competitor ad or inspiration
 * image) or something that should actually appear in the final design
 * (e.g. a specific graphic not already in the Brand Assets library).
 */
export async function uploadReferenceCreative(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { mode = 'include' } = req.body;
    if (!['include', 'style', 'template'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "include", "style", or "template".' });
    }
    // "exact" only means anything for mode:'include' - a style reference
    // is never composited as-is, so silently ignore the flag otherwise.
    const exact = mode === 'include' && (req.body.exact === true || req.body.exact === 'true');
    const ANCHORS = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'];
    const anchor = exact && ANCHORS.includes(req.body.anchor) ? req.body.anchor : 'bottom-right';

    post.referenceCreatives.push({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      url: uploadUrl(req.file.filename, req.tenant),
      mode,
      exact,
      anchor
    });
    await post.save();

    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
}

export async function removeReferenceCreative(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const { filename } = req.params;
    post.referenceCreatives = post.referenceCreatives.filter((r) => r.filename !== filename);
    await post.save();

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Updates an existing post's Step 01 fields (purpose, mediums, brief,
 * creative direction, selected assets) WITHOUT touching its generated
 * designs - this is what lets someone go back to Step 01 to tweak the
 * brief and continue, rather than every visit to Step 01 creating a new
 * post and discarding whatever was already generated.
 *
 * Pass resetDesigns:true to explicitly wipe designs back to empty (the
 * deliberate "start over" action) - this is opt-in only, never automatic,
 * so existing copy/images are never silently discarded.
 */
export async function updatePost(req, res, next) {
  try {
    const existing = await loadOwnedPost(req);
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const { purpose, mediums, briefNote, selectedAssets, exactAssetIds, creativeBrief, resetDesigns, creativeType } = req.body;

    if (creativeType !== undefined) existing.creativeType = ['adaptation', 'headline', 'hero', 'resize', 'convert'].includes(creativeType) ? creativeType : 'new';
    if (purpose !== undefined) existing.purpose = purpose;
    if (mediums !== undefined) existing.mediums = mediums.length ? mediums : ['instagram_feed'];
    if (briefNote !== undefined) existing.briefNote = briefNote;
    if (selectedAssets !== undefined) existing.selectedAssets = selectedAssets;
    // Keep exactAssetIds consistent with selectedAssets - never let a
    // "keep exact" flag survive an asset being deselected.
    if (exactAssetIds !== undefined) {
      const allowed = new Set((selectedAssets !== undefined ? selectedAssets : existing.selectedAssets).map((id) => String(id)));
      existing.exactAssetIds = exactAssetIds.filter((id) => allowed.has(String(id)));
    } else if (selectedAssets !== undefined) {
      const allowed = new Set(selectedAssets.map((id) => String(id)));
      existing.exactAssetIds = (existing.exactAssetIds || []).filter((id) => allowed.has(String(id)));
    }
    if (creativeBrief !== undefined) existing.creativeBrief = { ...existing.creativeBrief?.toObject?.(), ...creativeBrief };

    if (req.body.subBrandId !== undefined && existing.creativeType === 'new') {
      const subBrand = await resolveSubBrand(req.customer, { choice: req.body.subBrandId, text: briefText({ purpose: existing.purpose, briefNote: existing.briefNote, creativeBrief: existing.creativeBrief }) });
      existing.subBrand = subBrand?._id || null;
      existing.subBrandName = subBrand?.name || '';
    }

    if (resetDesigns) {
      existing.designs = [];
      existing.selectedVariantLabel = '';
    }

    await existing.save();
    res.json({ post: existing });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// STEP 01 - Generate Media (brief in, first caption + preview out)
// ---------------------------------------------------------------------------

/**
 * AI-suggests the "Look & feel" step's picks (mood, style reference,
 * lighting, composition) from whatever's been entered so far. Stateless -
 * called before a post exists (the brief isn't saved until Step 01 is
 * submitted), so this doesn't touch the database at all; the client applies
 * the returned picks directly to its local wizard state.
 */
export async function suggestLookAndFeel(req, res, next) {
  try {
    const { purpose, briefNote, mediums, model } = req.body;
    if (!purpose) return res.status(400).json({ error: 'purpose is required.' });

    const subBrand = await resolveSubBrand(req.customer, { choice: req.body.subBrandId, text: briefText(req.body) });
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : []);
    const suggestion = await lookAndFeelService.suggestLookAndFeel({
      purpose,
      briefNote: briefNote || '',
      mediums: mediums || [],
      // Everything already chosen on the screen, so the suggestion fits this brief (see lookAndFeelService.js).
      section: ['people', 'mood', 'style'].includes(req.body.section) ? req.body.section : '',
      primaryMessage: typeof req.body.primaryMessage === 'string' ? req.body.primaryMessage.slice(0, 300) : '',
      moodTags: list(req.body.moodTags),
      styleReferences: list(req.body.styleReferences),
      people: req.body.people && typeof req.body.people === 'object' ? req.body.people : null,
      user: userWithSubBrand(req.user, subBrand),
      followBrand: req.body.followBrand !== false,
      model,
      usageContext: buildUsageContext(req, 'suggestion_look_and_feel')
    });

    res.json(suggestion);
  } catch (err) {
    next(err);
  }
}

/**
 * AI-suggests the "Message & constraints" step's fields (primary message,
 * must include, must avoid) from whatever's been entered so far, including
 * the Look & feel picks if the marketer already made them. Same stateless
 * shape as suggestLookAndFeel - no post exists yet at this wizard step.
 */
export async function suggestMessage(req, res, next) {
  try {
    const { purpose, briefNote, mediums, moodTags, styleReferences, model } = req.body;
    if (!purpose) return res.status(400).json({ error: 'purpose is required.' });

    const subBrand = await resolveSubBrand(req.customer, { choice: req.body.subBrandId, text: briefText(req.body) });
    const suggestion = await messageSuggestionService.suggestMessage({
      purpose,
      briefNote: briefNote || '',
      mediums: mediums || [],
      moodTags: moodTags || [],
      styleReferences: styleReferences || [],
      user: userWithSubBrand(req.user, subBrand),
      followBrand: req.body.followBrand !== false,
      improve: req.body.improve && typeof req.body.improve === 'object' ? { field: String(req.body.improve.field || ''), text: String(req.body.improve.text || '') } : null,
      model,
      usageContext: buildUsageContext(req, 'suggestion_message')
    });

    res.json(suggestion);
  } catch (err) {
    next(err);
  }
}

export async function createPost(req, res, next) {
  try {
    const { purpose, mediums, briefNote, selectedAssets, exactAssetIds, masterDesignUrl, model, creativeBrief, creativeType } = req.body;

    // exactAssetIds must be a subset of selectedAssets - a "keep exact"
    // flag on an asset that was never actually selected doesn't mean anything.
    const allowedAssetIds = new Set((selectedAssets || []).map((id) => String(id)));
    const cleanExactAssetIds = (exactAssetIds || []).filter((id) => allowedAssetIds.has(String(id)));

    // New Creative only: pick the sub-brand from the brief (keywords first, then a small model check).
    const subBrand = (creativeType || 'new') === 'new' ? await resolveSubBrand(req.customer, { choice: req.body.subBrandId, text: briefText(req.body), useAi: true }) : null;

    const post = await Post.create({
      user: req.user._id,
      subBrand: subBrand?._id || null,
      subBrandName: subBrand?.name || '',
      creativeType: ['adaptation', 'headline', 'hero', 'resize', 'convert'].includes(creativeType) ? creativeType : 'new',
      purpose,
      mediums: mediums?.length ? mediums : ['instagram_feed'],
      briefNote: briefNote || '',
      creativeBrief: creativeBrief || {},
      selectedAssets: selectedAssets || [],
      exactAssetIds: cleanExactAssetIds,
      masterDesignUrl: masterDesignUrl || ''
    });

    // "Edit Headline Only" / "Change Hero Image Only" have no brief to write a caption from - skip the AI call.
    const { caption, modelUsed, note } =
      ['headline', 'hero', 'resize', 'convert'].includes(post.creativeType)
        ? { caption: '', modelUsed: '', note: '' }
        : await captionService.generateCaption({
            purpose: post.purpose,
            mediums: post.mediums,
            briefNote: post.briefNote,
            user: brandUser(req, post),
            model,
            followBrand: brandFollowed(req, post.selectedAssets, post),
            usageContext: buildUsageContext(req, 'caption', post._id)
          });

    // Seed a single preview "variant" so Step 01's live preview has something
    // real to show before the full 6-way generation in Step 02.
    post.designs = [
      {
        label: 'Preview',
        caption,
        imageUrl: '',
        background: 'linear-gradient(160deg,#0F2A5C 0%,#2E5EFF 55%,#8FA9FF 100%)',
        textModel: modelUsed,
        imageModel: ''
      }
    ];
    post.selectedVariantLabel = 'Preview';
    await post.save();

    res.status(201).json({ post, aiNote: note });
  } catch (err) {
    next(err);
  }
}

export async function listPosts(req, res, next) {
  try {
    const { status } = req.query;
    const filter = { ...ownerFilter(req) };
    if (status) filter.status = status;

    const posts = await Post.find(filter).sort({ updatedAt: -1 });
    res.json({ posts });
  } catch (err) {
    next(err);
  }
}

// Storage used by the current customer's files vs. their quota (1 GB by default).
export async function getStorageUsage(req, res, next) {
  try {
    if (!req.tenant?.customer) return res.json({ unscoped: true }); // agency admin with no customer selected
    const mb = req.tenant.customer.limits?.storageMb;
    const limitBytes = (Number.isFinite(mb) ? mb : DEFAULT_STORAGE_MB) * 1024 * 1024;
    const usedBytes = storageUsedBytes(req.tenant, { fresh: req.query.fresh === '1' });
    res.json({ usedBytes, limitBytes, percent: limitBytes ? Math.min(100, (usedBytes / limitBytes) * 100) : 0 });
  } catch (err) {
    next(err);
  }
}

export async function getPost(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Collects every locally-generated file path a post references (variant
 * images, image options, reference creatives) so they can be cleaned up
 * alongside the DB document - otherwise deleting a post leaves its
 * generated images orphaned on disk forever.
 */
function collectPostFilePaths(post) {
  const urls = [];
  for (const d of post.designs || []) {
    if (d.imageUrl) urls.push(d.imageUrl);
    for (const opt of d.imageOptions || []) {
      if (opt.imageUrl) urls.push(opt.imageUrl);
    }
    for (const fv of d.formatVariants || []) {
      if (fv.imageUrl) urls.push(fv.imageUrl);
    }
    for (const vj of d.videoJobs || []) {
      if (vj.videoUrl) urls.push(vj.videoUrl);
    }
  }
  for (const ref of post.referenceCreatives || []) {
    if (ref.url) urls.push(ref.url);
  }
  return urls
    .filter((u) => u.startsWith('/uploads/'))
    .map((u) => resolveUploadPath(u));
}

function deleteFilesQuietly(filePaths) {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.warn('[posts] failed to delete file during post cleanup:', filePath, err.message);
    }
  }
}

export async function deletePost(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    await markAssetsDeleted([post]); // the generations stay counted on the Usage page
    deleteFilesQuietly(collectPostFilePaths(post));
    await Post.deleteOne({ _id: post._id });

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function deleteAllPosts(req, res, next) {
  try {
    const posts = await Post.find({ user: req.user._id });
    await markAssetsDeleted(posts);
    for (const post of posts) {
      deleteFilesQuietly(collectPostFilePaths(post));
    }
    const result = await Post.deleteMany({ user: req.user._id });

    res.json({ deleted: true, count: result.deletedCount });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// STEP 02 - Generate Designs (fan out into N variants)
// ---------------------------------------------------------------------------
export async function generateDesigns(req, res, next) {
  try {
    // Read-only lookup up front - we deliberately don't hold on to this
    // document across the (potentially 30-60s+) generation call below.
    // Saving it afterwards with .save() would compare against a stale
    // in-memory version and throw a VersionError if anything else touched
    // the post in the meantime (a duplicate request, a double-click, React
    // StrictMode's double-effect in dev, etc). findOneAndUpdate is atomic
    // and sidesteps that entirely.
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const { textModel = 'auto', imageModel = 'auto', withImages = false } = req.body;
    const { groundingImages, styleImages, exactAssets } = await resolveReferenceImages(existing.selectedAssets, existing.referenceCreatives, existing.exactAssetIds, brandFollowed(req, existing.selectedAssets, existing), existing.subBrand);

    const genArgs = {
      purpose: existing.purpose,
      mediums: existing.mediums,
      briefNote: existing.briefNote,
      user: brandUser(req, existing),
      textModel,
      followBrand: brandFollowed(req, existing.selectedAssets, existing),
      creativeBrief: existing.creativeBrief || {},
      groundingImages,
      styleImages,
      exactAssets,
      // Adaptation is reworking one already-approved creative, not
      // exploring a new campaign angle from scratch - one direction is
      // the point, not a limitation. See Stepper.jsx for the matching
      // shortened Step 01 -> 02 -> Publish path this enables.
      // Adaptation still skips Refine/Modify and goes straight to Publish
      // once a direction is chosen and imaged (see Stepper.jsx / handleContinue
      // in GenerateDesigns.jsx) - but that's about not comparing generated
      // *images* across variants, not about limiting copy choice. Copy
      // directions are cheap/text-only until one is picked for imaging, so
      // there's no reason to reduce the count here.
      variantCount: undefined,
      usageContext: buildUsageContext(req, withImages ? 'design_variants' : 'copy_directions', existing._id)
    };

    // Default: copy-only, fast (agency-style - lock the copy direction
    // before spending time/cost on images). withImages:true opts into the
    // old "generate everything at once" bulk behavior for anyone who wants it.
    const variants = withImages
      ? await designService.generateDesignVariants({ ...genArgs, imageModel })
      : await designService.generateCopyDirections(genArgs);

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req) },
      { $set: { designs: variants, selectedVariantLabel: variants[0]?.label || '' } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found (it may have been deleted mid-generation).' });

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

export async function regenerateVariant(req, res, next) {
  try {
    const { label } = req.params;

    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });
    const existingVariant = existing.designs.find((d) => d.label === label);
    if (!existingVariant) {
      return res.status(404).json({ error: `Variant "${label}" not found.` });
    }

    // Copy-only by default (fast, no image cost) - matches Step 02's
    // copy-first flow. withImages:true is a full restart of this direction
    // (copy + a fresh image), used by Step 03's "Regenerate this variant".
    const { textModel = 'auto', imageModel = 'auto', withImages = false } = req.body;
    const { groundingImages, styleImages, exactAssets } = await resolveReferenceImages(existing.selectedAssets, existing.referenceCreatives, existing.exactAssetIds, brandFollowed(req, existing.selectedAssets, existing), existing.subBrand);

    const genArgs = {
      purpose: existing.purpose,
      mediums: existing.mediums,
      briefNote: existing.briefNote,
      user: brandUser(req, existing),
      textModel,
      followBrand: brandFollowed(req, existing.selectedAssets, existing),
      creativeBrief: existing.creativeBrief || {},
      groundingImages,
      styleImages,
      exactAssets,
      // regenerate THIS card's slot with a concept different from the other cards already on screen
      onlyIndex: ['Variant A', 'Variant B', 'Variant C', 'Variant D', 'Variant E', 'Variant F'].indexOf(label),
      avoidConcepts: existing.designs.filter((d) => d.label !== label).map((d) => d.directionTitle || d.angle).filter(Boolean),
      usageContext: buildUsageContext(req, withImages ? 'design_variants' : 'copy_directions', existing._id)
    };

    const fresh = withImages
      ? (await designService.generateDesignVariants({ ...genArgs, imageModel }))[0]
      : await (async () => {
          const [copyOnly] = await designService.generateCopyDirections(genArgs);
          // Copy-only: keep the existing image rather than wiping it, since
          // it's still a perfectly valid image the user may want to keep
          // paired with fresh copy (they can regenerate the image
          // separately and deliberately if they want a new one too).
          return { ...copyOnly, imageUrl: existingVariant.imageUrl, background: existingVariant.background, imageModel: existingVariant.imageModel, imageNote: existingVariant.imageNote };
        })();

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $set: { 'designs.$': { ...fresh, label } } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found (it may have changed mid-generation).' });

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Generates (or regenerates) the image for ONE variant - the deliberate
 * "commission the art" step after copy is locked in. Accepts an optional
 * imagePrompt override (the "art director" edited the brief before
 * generating) and imageModel override; falls back to the variant's stored
 * imagePrompt if none is given.
 */
export async function generateVariantImage(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const index = existing.designs.findIndex((d) => d.label === label);
    if (index === -1) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const variant = existing.designs[index];
    const { imageModel = 'auto', imagePrompt } = req.body;
    const finalPrompt = (imagePrompt && imagePrompt.trim()) || variant.imagePrompt;
    if (!finalPrompt) {
      return res.status(400).json({ error: 'No image prompt available for this variant. Generate copy directions first.' });
    }

    const { groundingImages, styleImages, exactAssets } = await resolveReferenceImages(existing.selectedAssets, existing.referenceCreatives, existing.exactAssetIds, brandFollowed(req, existing.selectedAssets, existing), existing.subBrand);
    const medium = existing.mediums?.[0] || 'instagram_feed';

    const imageResult = await designService.generateImageForVariant({
      imagePrompt: designService.applyBrandPreference(finalPrompt, brandFollowed(req, existing.selectedAssets, existing)),
      medium,
      imageModel,
      qualityTier: existing.creativeBrief?.qualityTier,
      groundingImages,
      styleImages,
      exactAssets,
      includeTypography: existing.creativeBrief?.includeTypography,
      headlineText: existing.creativeBrief?.headlineText,
      subHeadlineText: existing.creativeBrief?.subHeadlineText,
      templatePreservation: existing.creativeBrief?.templatePreservation,
      variantIndex: index,
      usageContext: buildUsageContext(req, 'image_generate', existing._id),
      fonts: brandUser(req, existing).brandKit?.fonts
    });

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $set: {
          'designs.$.imagePrompt': finalPrompt,
          'designs.$.imageUrl': imageResult.imageUrl,
          'designs.$.background': imageResult.background,
          'designs.$.imageModel': imageResult.imageModel,
          'designs.$.imageNote': imageResult.imageNote,
          'designs.$.imageBillingUrl': imageResult.imageBillingUrl || '',
          'designs.$.imageBillingProviderLabel': imageResult.imageBillingProviderLabel || ''
        } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found (it may have changed mid-generation).' });

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Generates 3 distinct image options for one CHOSEN copy direction - the
 * "now commission the art" step after copy is locked in. Accepts an
 * optional imagePrompt override (edited image brief) and imageModel.
 */
/**
 * Step 1 of progressive image-option generation: immediately writes 3
 * "generating…" placeholders into imageOptions so the grid can render
 * right away, before any actual (multi-second) generation call happens.
 * The client then fires generateVariantImageOptionSingle 3 times in
 * parallel - each overwrites its own slot the moment it finishes, so the
 * grid fills in as each option completes rather than staying blank until
 * all 3 happen to land together.
 */
export async function initVariantImageOptions(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const { imagePrompt } = req.body;
    const finalPrompt = (imagePrompt && imagePrompt.trim()) || variant.imagePrompt;
    if (!finalPrompt) {
      return res.status(400).json({ error: 'No image prompt available for this variant. Generate copy directions first.' });
    }

    const placeholders = designService.pendingImageOptionsPlaceholder(customerOptionCount(req));
    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $set: { 'designs.$.imagePrompt': finalPrompt, 'designs.$.imageOptions': placeholders } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    res.json({ post, count: placeholders.length, imagePrompt: finalPrompt });
  } catch (err) {
    next(err);
  }
}

/**
 * Step 2: generates exactly one of the 3 options (by index) and writes it
 * straight into that array slot - see initVariantImageOptions above for
 * why this is split out from the old all-3-at-once endpoint.
 */
export async function generateVariantImageOptionSingle(req, res, next) {
  try {
    const { label, index } = req.params;
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= customerOptionCount(req)) {
      return res.status(400).json({ error: `index must be an integer between 0 and ${customerOptionCount(req) - 1}.` });
    }

    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const { imageModel = 'auto', imagePrompt } = req.body;
    const round = Number.isInteger(req.body.round) && req.body.round > 0 ? Math.min(req.body.round, 100000) : 0; // > 0 = "Regenerate designs": a different approach and framing from the earlier sets
    const finalPrompt = (imagePrompt && imagePrompt.trim()) || variant.imagePrompt;
    if (!finalPrompt) {
      return res.status(400).json({ error: 'No image prompt available for this variant. Generate copy directions first.' });
    }

    const { groundingImages, styleImages, exactAssets } = await resolveReferenceImages(existing.selectedAssets, existing.referenceCreatives, existing.exactAssetIds, brandFollowed(req, existing.selectedAssets, existing), existing.subBrand);
    const medium = existing.mediums?.[0] || 'instagram_feed';

    const option = await designService.generateSingleImageOption({
      round,
      imagePrompt: designService.applyBrandPreference(finalPrompt, brandFollowed(req, existing.selectedAssets, existing)),
      medium,
      styleIndex: idx,
      imageModel,
      qualityTier: existing.creativeBrief?.qualityTier,
      groundingImages,
      styleImages,
      exactAssets,
      includeTypography: existing.creativeBrief?.includeTypography,
      headlineText: existing.creativeBrief?.headlineText,
      subHeadlineText: existing.creativeBrief?.subHeadlineText,
      templatePreservation: existing.creativeBrief?.templatePreservation,
      usageContext: buildUsageContext(req, 'image_options', existing._id),
      fonts: brandUser(req, existing).brandKit?.fonts
    });

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $set: { [`designs.$.imageOptions.${idx}`]: option } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found (it may have changed mid-generation).' });

    res.json({ post, option, index: idx });
  } catch (err) {
    next(err);
  }
}

export async function generateVariantImageOptions(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const { imageModel = 'auto', imagePrompt } = req.body;
    const finalPrompt = (imagePrompt && imagePrompt.trim()) || variant.imagePrompt;
    if (!finalPrompt) {
      return res.status(400).json({ error: 'No image prompt available for this variant. Generate copy directions first.' });
    }

    const { groundingImages, styleImages, exactAssets } = await resolveReferenceImages(existing.selectedAssets, existing.referenceCreatives, existing.exactAssetIds, brandFollowed(req, existing.selectedAssets, existing), existing.subBrand);
    const medium = existing.mediums?.[0] || 'instagram_feed';

    const options = await designService.generateImageOptionsForVariant({
      count: customerOptionCount(req),
      imagePrompt: designService.applyBrandPreference(finalPrompt, brandFollowed(req, existing.selectedAssets, existing)),
      medium,
      imageModel,
      qualityTier: existing.creativeBrief?.qualityTier,
      groundingImages,
      styleImages,
      exactAssets,
      includeTypography: existing.creativeBrief?.includeTypography,
      headlineText: existing.creativeBrief?.headlineText,
      subHeadlineText: existing.creativeBrief?.subHeadlineText,
      templatePreservation: existing.creativeBrief?.templatePreservation,
      usageContext: buildUsageContext(req, 'image_options', existing._id),
      fonts: brandUser(req, existing).brandKit?.fonts
    });

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $set: { 'designs.$.imagePrompt': finalPrompt, 'designs.$.imageOptions': options } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found (it may have changed mid-generation).' });

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Generates the full set of carousel slides for this variant - only valid
 * when the post's medium is a carousel-type format (Instagram/Facebook/
 * LinkedIn carousel, or an X multi-image post). Replaces any existing
 * carouselSlides on this variant entirely rather than appending, same as
 * how generateVariantImage replaces the single imageUrl.
 */
export async function generateVariantCarousel(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const index = existing.designs.findIndex((d) => d.label === label);
    if (index === -1) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const variant = existing.designs[index];
    const medium = existing.mediums?.[0] || 'instagram_feed';
    const format = getFormat(medium);
    if (!format.isCarousel) {
      return res.status(400).json({ error: `"${format.label}" is not a carousel format - switch the post's format to a carousel type first.` });
    }

    const { imageModel = 'auto', imagePrompt, slideCount } = req.body;
    const finalPrompt = (imagePrompt && imagePrompt.trim()) || variant.imagePrompt;
    if (!finalPrompt) {
      return res.status(400).json({ error: 'No image prompt available for this variant. Generate copy directions first.' });
    }

    const { groundingImages, styleImages, exactAssets } = await resolveReferenceImages(existing.selectedAssets, existing.referenceCreatives, existing.exactAssetIds, brandFollowed(req, existing.selectedAssets, existing), existing.subBrand);

    const slides = await designService.generateCarouselForVariant({
      imagePrompt: designService.applyBrandPreference(finalPrompt, brandFollowed(req, existing.selectedAssets, existing)),
      medium,
      imageModel,
      qualityTier: existing.creativeBrief?.qualityTier,
      groundingImages,
      styleImages,
      exactAssets,
      slideCount: slideCount || existing.creativeBrief?.slideCount || 5,
      templatePreservation: existing.creativeBrief?.templatePreservation,
      usageContext: buildUsageContext(req, 'carousel_generate', existing._id)
    });

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $set: { 'designs.$.imagePrompt': finalPrompt, 'designs.$.carouselSlides': slides } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found (it may have changed mid-generation).' });

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Picks one of the 3 generated image options as this variant's canonical
 * image - copies it into the main imageUrl/background/etc fields that the
 * rest of the workflow (Refine, Modify, Publish) reads.
 */
export async function selectImageOption(req, res, next) {
  try {
    const { label } = req.params;
    const { optionIndex } = req.body;

    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const option = variant.imageOptions?.[optionIndex];
    if (!option) return res.status(400).json({ error: 'That image option was not found.' });

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $set: {
          'designs.$.imageUrl': option.imageUrl,
          'designs.$.imagePrompt': option.imagePrompt,
          'designs.$.background': option.background,
          'designs.$.imageModel': option.imageModel,
          'designs.$.imageNote': option.imageNote
        } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Ports the variant's master creative to the post's OTHER selected formats
 * (every entry in mediums beyond the first, which is what the master was
 * actually generated for) - so selecting multiple platforms/formats on
 * Step 01 actually produces a matching creative for each one, not just
 * one image reused/mislabeled across all of them.
 *
 * Image-type target formats get an AI-adapted still (see
 * designService.portImageToFormat). Video-type target formats (Reels,
 * Shorts, TikTok, etc - see isVideo in constants/postFormats.js) can't be
 * "adapted" the same way an image can - there's no image-to-video edit
 * wired up for any configured provider - so these instead kick off a
 * proper video generation job, themed to match the same campaign concept,
 * sized/timed for that exact platform. Those jobs land in the variant's
 * existing videoJobs array (tagged with which format they're for) and are
 * polled the same way a directly-requested video is.
 */
export async function portVariantToFormats(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const allFormats = existing.mediums?.length ? existing.mediums : ['instagram_feed'];
    const otherFormats = req.body.formatIds?.length ? req.body.formatIds : allFormats.slice(1);

    if (otherFormats.length === 0) {
      return res.status(400).json({ error: 'No other formats to port to - select more than one format on Step 01 first.' });
    }

    const videoTargets = otherFormats.filter((id) => isVideoFormat(id));
    const imageTargets = otherFormats.filter((id) => !isVideoFormat(id));

    if (imageTargets.length > 0) {
      if (!variant.imageUrl) {
        return res.status(400).json({ error: 'This variant has no master creative yet - generate/select an image first.' });
      }
      if (!variant.imageUrl.startsWith('/uploads/')) {
        return res.status(400).json({ error: 'The master creative is not a locally generated file, so it cannot be used as a reference for porting.' });
      }
    }

    const imagePromises = imageTargets.length
      ? (() => {
          const masterImage = {
            filePath: resolveUploadPath(variant.imageUrl),
            mimeType: 'image/png',
            filename: `${label}-master.png`
          };
          return imageTargets.map((formatId) =>
            designService.portImageToFormat({
              masterImage,
              targetFormatId: formatId,
              imageModel: req.body.imageModel || 'auto',
              qualityTier: existing.creativeBrief?.qualityTier,
              // "Edit Headline Only" creatives are finished artwork with text on them - keep it.
              preserveText: ['headline', 'hero', 'resize'].includes(existing.creativeType),
              usageContext: buildUsageContext(req, 'image_port_format', existing._id)
            })
          );
        })()
      : [];

    let videoJobResults = [];
    if (videoTargets.length > 0) {
      const basePrompt = variant.imagePrompt || variant.caption;
      if (!basePrompt) {
        return res.status(400).json({ error: 'No prompt available for this variant - generate copy directions first.' });
      }
      const hasImage = Boolean(variant.imageUrl);
      const mode = req.body.mode === 'new_scene' || !hasImage ? 'new_scene' : 'animate_kv';
      const motionStyle = req.body.motionStyle || 'ambient';
      const imagePath = mode === 'animate_kv' ? resolveUploadPath(variant.imageUrl) : undefined;
      videoJobResults = await Promise.all(
        videoTargets.map(async (formatId) => {
          const format = getFormat(formatId);
          const platformNote = `This is the same campaign/creative concept adapted for ${format.platform} ${format.label} - keep the same subject, mood, and visual style consistent with the rest of the set.`;
          const prompt = designService.buildVideoPrompt({ mode, basePrompt, motionStyle, platformNote });
          aiLog('video', 'info', { msg: `new video request - ${mode === 'animate_kv' ? 'animating the approved image' : 'new scene from text'}`, extra: `${selectedIdeas.length} idea(s)${promptOverride ? ' · hand-edited prompt' : ''}${feedback ? ' · with feedback' : ''}` });
    const result = await videoRouter.submitVideoJob({
            provider: req.body.provider || 'auto',
            prompt,
            aspectRatio: format.videoAspectRatio,
            durationSeconds: format.recommendedDurationSeconds,
            imagePath
          });
          if (result.submitted) {
            await logVideoUsage(buildUsageContext(req, 'video_port_format', existing._id), {
              provider: result.provider,
              externalJobId: result.externalJobId,
              requestedSeconds: format.recommendedDurationSeconds
            });
          }
          return { formatId, format, prompt, result, mode, motionStyle };
        })
      );
    }

    // Merge image ports into formatVariants: replace any existing entry for
    // the same formatId (re-porting), keep the rest untouched.
    const imageResults = await Promise.all(imagePromises);
    const existingVariants = (variant.formatVariants || []).filter((v) => !imageTargets.includes(v.formatId));
    const mergedVariants = [...existingVariants, ...imageResults];

    // Video ports become new videoJobs entries, tagged with their target
    // format so the client can tell them apart from the primary medium's job.
    const newVideoJobs = videoJobResults
      .filter((r) => r.result.submitted)
      .map((r) => ({
        provider: r.result.provider,
        externalJobId: r.result.externalJobId,
        providerMeta: r.result.providerMeta,
        status: 'processing',
        prompt: r.prompt,
        videoUrl: '',
        note: '',
        formatId: r.formatId,
        sourceMode: r.mode,
        motionStyle: r.mode === 'animate_kv' ? r.motionStyle : '',
        createdAt: new Date()
      }));
    const videoFailures = videoJobResults
      .filter((r) => !r.result.submitted)
      .map((r) => ({ formatId: r.formatId, label: r.format.label, error: r.result.note || 'Could not start video generation.' }));

    const updateOps = { $set: { 'designs.$.formatVariants': mergedVariants } };
    if (newVideoJobs.length) updateOps.$push = { 'designs.$.videoJobs': { $each: newVideoJobs } };

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      updateOps,
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    res.json({ post, videoJobs: newVideoJobs, videoFailures });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Size Adapt - batch
// ---------------------------------------------------------------------------
const ADAPT_BATCH_MAX = 8; // sizes per request
const ADAPT_CONCURRENCY = 3; // sizes being made at the same time
const ADAPT_STALE_MS = 10 * 60 * 1000; // a size "pending" for longer than this is treated as lost (e.g. server restart)

/**
 * Adapts the variant's master creative to several still-image sizes in ONE request (Size Adapt).
 * Returns 202 straight away with each size marked `status: 'pending'`; the sizes are then made
 * ADAPT_CONCURRENCY at a time in the background and each is saved the moment it finishes, so the
 * client just polls GET /posts/:id. One size failing never affects the others.
 *
 * body: { formatIds: string[] (max 8), imageModel? }
 * Image placements only - video and carousel formats are ignored (they need a motion brief / several slides).
 * The monthly image allowance is checked once by restrictGeneration; because this request can make
 * several images, the number of sizes is also clamped to what is left of the allowance here.
 */
export async function adaptVariantSizes(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });
    if (!variant.imageUrl) return res.status(400).json({ error: 'This variant has no master creative yet - upload or generate one first.' });
    if (!variant.imageUrl.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'The master creative is not a locally generated file, so it cannot be used as a reference for adapting.' });
    }

    const wanted = [...new Set(Array.isArray(req.body.formatIds) ? req.body.formatIds : [])].filter(
      (id) => typeof id === 'string' && getFormat(id).id === id && !isVideoFormat(id) && !isCarouselFormat(id)
    );
    if (wanted.length === 0) return res.status(400).json({ error: 'Pick at least one image size to adapt to.' });
    if (wanted.length > ADAPT_BATCH_MAX) return res.status(400).json({ error: `You can adapt to at most ${ADAPT_BATCH_MAX} sizes at a time.` });

    // Sizes already being made (and not stale) are left alone, so a double click can't pay for them twice.
    const now = Date.now();
    const running = new Set(
      (variant.formatVariants || [])
        .filter((v) => v.status === 'pending' && v.startedAt && now - new Date(v.startedAt).getTime() < ADAPT_STALE_MS)
        .map((v) => v.formatId)
    );
    let ids = wanted.filter((id) => !running.has(id));

    // Clamp to what is left of the monthly image allowance (agency admins are never limited).
    let skipped = [];
    if (req.user?.role !== 'admin' && ids.length > 0) {
      const base = req.customer?.limits?.imagesPerMonth;
      if (base !== null && base !== undefined) {
        const usage = await generationUsage(req.customer);
        const remaining = Math.max(0, usage.images.limit - usage.images.used);
        if (ids.length > remaining) {
          skipped = ids.slice(remaining);
          ids = ids.slice(0, remaining);
        }
      }
    }

    const filter = { _id: existing._id, ...ownerFilter(req), 'designs.label': label };
    const touched = [...ids, ...skipped];
    let post = existing;
    if (touched.length > 0) {
      await Post.findOneAndUpdate(filter, { $pull: { 'designs.$.formatVariants': { formatId: { $in: touched } } } });
      post = await Post.findOneAndUpdate(
        filter,
        {
          $push: {
            'designs.$.formatVariants': {
              $each: [
                ...ids.map((formatId) => ({ formatId, status: 'pending', startedAt: new Date(), imageUrl: '', imageNote: '' })),
                ...skipped.map((formatId) => ({ formatId, status: 'failed', imageUrl: '', imageNote: 'Not made - this workspace has used its monthly image allowance.' }))
              ]
            }
          }
        },
        { new: true }
      );
    }

    res.status(202).json({ post, queued: ids, skipped, alreadyRunning: wanted.filter((id) => running.has(id)) });

    if (ids.length === 0) return;
    // Continues after the response; every result is written to the post as it lands.
    runAdaptQueue({
      req,
      filter,
      label,
      ids,
      postId: existing._id,
      masterImage: { filePath: resolveUploadPath(variant.imageUrl), mimeType: 'image/png', filename: `${label}-master.png` },
      qualityTier: existing.creativeBrief?.qualityTier,
      preserveText: ['headline', 'hero', 'resize'].includes(existing.creativeType),
      imageModel: req.body.imageModel || 'auto'
    }).catch((err) => console.error('[adapt-sizes] queue failed:', err?.message || err));
  } catch (err) {
    next(err);
  }
}

async function runAdaptQueue({ req, filter, label, ids, postId, masterImage, qualityTier, preserveText, imageModel }) {
  const queue = [...ids];
  const arrayFilters = (formatId) => [{ 'd.label': label }, { 'f.formatId': formatId }];

  async function worker() {
    while (queue.length) {
      const formatId = queue.shift();
      let result;
      try {
        const r = await designService.portImageToFormat({
          masterImage,
          targetFormatId: formatId,
          imageModel,
          qualityTier,
          preserveText,
          usageContext: buildUsageContext(req, 'image_port_format', postId)
        });
        result = { ...r, formatId, status: r?.imageUrl ? 'done' : 'failed' };
        if (!r?.imageUrl && !r?.imageNote) result.imageNote = 'Could not be generated.';
      } catch (err) {
        result = { formatId, imageUrl: '', imageNote: `Could not be generated: ${String(err?.message || 'unknown error').slice(0, 240)}`, status: 'failed' };
      }
      try {
        await Post.findOneAndUpdate(filter, { $set: { 'designs.$[d].formatVariants.$[f]': result } }, { arrayFilters: arrayFilters(formatId) });
      } catch (err) {
        console.error('[adapt-sizes] could not save', formatId, err?.message || err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ADAPT_CONCURRENCY, ids.length) }, worker));

  // Anything still "pending" after the workers stopped was lost - say so instead of spinning forever.
  await Post.findOneAndUpdate(
    filter,
    { $set: { 'designs.$[d].formatVariants.$[f].status': 'failed', 'designs.$[d].formatVariants.$[f].imageNote': 'Interrupted - try again.' } },
    { arrayFilters: [{ 'd.label': label }, { 'f.formatId': { $in: ids }, 'f.status': 'pending' }] }
  ).catch(() => {});
}

/**
 * Starts a video generation job for this variant. Returns immediately with
 * the job in "pending"/"processing" state - the client polls
 * getVideoJobStatus separately, since generation typically takes 1-3+
 * minutes and this endpoint would otherwise time out waiting.
 *
 * mode defaults to "animate_kv" whenever the variant already has an
 * approved image (the common, agency-friendly case: the video should be a
 * moving version of the exact creative that got signed off, not a fresh
 * AI reinterpretation of the brief). "new_scene" is the older behavior -
 * generating purely from the text prompt - and is what's used when there's
 * no image yet, or when the person explicitly asks for a different scene.
 */
export async function generateVariantVideo(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    // "Convert to Video" starts from an uploaded image with no brief - animate the image as it is.
    const basePrompt = (req.body.prompt && req.body.prompt.trim()) || variant.imagePrompt || variant.caption
      || (existing.creativeType === 'convert' && variant.imageUrl ? 'Bring this creative to life with natural, tasteful motion. Keep every element of the image exactly as it is.' : '');
    if (!basePrompt) {
      return res.status(400).json({ error: 'No prompt available for this variant - generate copy/an image brief first.' });
    }

    const hasImage = Boolean(variant.imageUrl);
    const mode = req.body.mode === 'new_scene' || !hasImage ? 'new_scene' : 'animate_kv';
    const motionStyle = req.body.motionStyle || 'ambient';
    // Animation ideas the person ticked (from POST .../video-ideas). Sanitized
    // and capped - at most one camera move, at most 8 ideas overall.
    const rawIdeas = Array.isArray(req.body.selectedIdeas) ? req.body.selectedIdeas : [];
    let cameraTaken = false;
    const selectedIdeas = [];
    for (const i of rawIdeas) {
      const title = typeof i?.title === 'string' ? i.title.trim().slice(0, 80) : '';
      const videoPrompt = typeof i?.videoPrompt === 'string' ? i.videoPrompt.trim().slice(0, 500) : '';
      if (!title || !videoPrompt) continue;
      if (i.category === 'camera') {
        if (cameraTaken) continue;
        cameraTaken = true;
      }
      selectedIdeas.push({ category: typeof i.category === 'string' ? i.category.slice(0, 20) : '', title, videoPrompt });
      if (selectedIdeas.length >= 8) break;
    }
    const customDirection = typeof req.body.customDirection === 'string' ? req.body.customDirection.trim().slice(0, 500) : '';
    // Headline / text animation ticked: the keep-text-still rule and the text lock are narrowed accordingly.
    // Text animation is OFF unless the person explicitly asks for it in their own words
    // (custom direction or feedback), e.g. "animate the headline", "fade in the tagline".
    const textMotionRegex = /\b(animat\w*|fade\w*|reveal\w*|slide\w*|typewriter|type[- ]?on|scale|pop|zoom|move|motion)\b[^.]{0,40}\b(headline|text|tagline|title|caption|cta|call[- ]to[- ]action|super|supers|lettering|words?)\b|\b(headline|text|tagline|title|caption|cta|supers?|lettering)\b[^.]{0,40}\b(animat\w*|fade\w*|reveal\w*|slide\w*|typewriter|appear\w*)\b/i;
    const textMotionRequested = textMotionRegex.test(`${customDirection} ${typeof req.body.feedback === 'string' ? req.body.feedback : ''}`);
    const textAnimated = textMotionRequested || selectedIdeas.some((i) => i.category === 'text');
    // A hand-edited prompt (Step 03 "Tweak the video prompt") replaces the built one; the keep-still rule is always re-added.
    const promptOverride = typeof req.body.promptOverride === 'string' ? req.body.promptOverride.trim().slice(0, 4000) : '';
    let prompt = promptOverride
      ? (mode === 'animate_kv' ? designService.ensureVideoGuardrails(promptOverride, { allowTextMotion: textAnimated }) : promptOverride)
      : designService.buildVideoPrompt({ mode, basePrompt, motionStyle, ideas: selectedIdeas, customDirection, textMotionRequested });
    // Follow-up feedback on the previous video. Earlier notes (same video format) are carried forward so the
    // generator keeps them in mind - unless the prompt was hand-edited, which already contains them.
    const feedback = typeof req.body.feedback === 'string' ? req.body.feedback.trim().slice(0, 500) : '';
    const feedbackFormatId = req.body.formatId || existing.mediums?.[0];
    const earlierFeedback = promptOverride || req.body.carryFeedback === false
      ? []
      : (variant.videoJobs || [])
          .filter((j) => j.feedback && (j.formatId || existing.mediums?.[0]) === feedbackFormatId)
          .map((j) => j.feedback)
          .slice(-3);
    prompt = designService.applyVideoFeedback(prompt, feedback, earlierFeedback);
    const imagePath = mode === 'animate_kv' ? resolveUploadPath(variant.imageUrl) : undefined;

    // Defaults to the post's primary medium, but callers (e.g. porting to a
    // specific video platform) can request a different one explicitly.
    const targetFormatId = req.body.formatId || existing.mediums?.[0];
    const format = getFormat(targetFormatId);
    // A video size picked on the "Video size" screen ({ w, h } in px) wins: the model gets the nearest shape it
    // supports and the finished clip is cropped to the exact size when it lands (see getVariantVideoStatus).
    const requestedSize = cleanVideoSize(req.body.videoSize);
    const aspectRatio = requestedSize
      ? nearestVideoAspect(requestedSize.w, requestedSize.h)
      : format.isVideo
        ? format.videoAspectRatio
        : format.orientation === 'landscape' ? '16:9' : format.orientation === 'square' ? '1:1' : '9:16';
    const durationSeconds = format.isVideo ? format.recommendedDurationSeconds : undefined;

    // Prompt director: one detailed, time-coded prompt built from the picks, notes and feedback.
    // Hand-edited prompts are sent as written. If the director is unavailable the plain prompt above is used.
    if (!promptOverride) {
      const composed = await composeVideoPrompt({
        mode,
        imagePath,
        formatId: targetFormatId,
        durationSeconds,
        ideas: selectedIdeas,
        customDirection,
        feedback,
        earlierFeedback,
        caption: variant.caption,
        imagePrompt: variant.imagePrompt,
        usageContext: buildUsageContext(req, 'video_prompt', existing._id)
      });
      if (composed) {
        prompt = mode === 'animate_kv' ? designService.ensureVideoGuardrails(composed, { allowTextMotion: textAnimated }) : composed;
        if (feedback) prompt = designService.applyVideoFeedback(prompt, feedback, []);
      }
    }

    const result = await videoRouter.submitVideoJob({ provider: req.body.provider || 'auto', prompt, aspectRatio, durationSeconds, imagePath });

    if (!result.submitted) {
      return res.status(400).json({ error: result.note || 'Could not start video generation.' });
    }

    await logVideoUsage(buildUsageContext(req, 'video_generate', existing._id), {
      provider: result.provider,
      externalJobId: result.externalJobId,
      requestedSeconds: durationSeconds
    });

    const job = {
      provider: result.provider,
      externalJobId: result.externalJobId,
      providerMeta: result.providerMeta,
      status: 'processing',
      prompt,
      videoUrl: '',
      note: '',
      formatId: format.isVideo ? targetFormatId : '',
      sourceMode: mode,
      motionStyle: mode === 'animate_kv' && selectedIdeas.length === 0 ? motionStyle : '',
      ideaTitles: selectedIdeas.map((i) => i.title),
      textAnimated,
      feedback,
      requestedSize: requestedSize || { w: 0, h: 0 },
      aspectRatio,
      qualityCheck: req.body.qualityCheck === true,
      createdAt: new Date()
    };

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $push: { 'designs.$.videoJobs': job } },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    res.status(201).json({ post, job });
  } catch (err) {
    next(err);
  }
}

/**
 * Looks at this variant's final image (when it has one) plus its copy
 * direction and returns an exhaustive list of animation possibilities the
 * person can pick from before any video is generated. See
 * videoIdeasService.js. Doesn't write anything.
 */
export async function suggestVariantVideoIdeas(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const imagePath = variant.imageUrl ? resolveUploadPath(variant.imageUrl) : undefined;
    const result = await suggestVideoIdeas({
      imagePath,
      caption: variant.caption || '',
      imagePrompt: variant.imagePrompt || '',
      briefNote: existing.briefNote || '',
      purpose: existing.purpose || '',
      formatId: req.body?.formatId || existing.mediums?.[0],
      usageContext: buildUsageContext(req, 'video_ideas', existing._id)
    });

    if (result.skipped) return res.status(400).json({ error: result.reason });
    res.json({ ideas: result.ideas, bestCombination: result.bestCombination, categories: result.categories, modelUsed: result.modelUsed });
  } catch (err) {
    next(err);
  }
}

/**
 * Suggest / Improve for the "Describe the motion" box on Choose how it moves: one short motion direction for this
 * variant's creative (body.current = what the person typed so far, body.picked = titles of ticked ideas).
 */
export async function suggestVariantMotionPrompt(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });
    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });
    const result = await suggestMotionPrompt({
      imagePath: variant.imageUrl ? resolveUploadPath(variant.imageUrl) : undefined,
      current: String(req.body?.current || ''),
      pickedTitles: (Array.isArray(req.body?.picked) ? req.body.picked : []).filter((t) => typeof t === 'string').map((t) => t.slice(0, 80)).slice(0, 8),
      caption: variant.caption || '',
      imagePrompt: variant.imagePrompt || '',
      briefNote: existing.briefNote || '',
      purpose: existing.purpose || '',
      formatId: req.body?.formatId || existing.mediums?.[0],
      usageContext: buildUsageContext(req, 'video_ideas', existing._id)
    });
    if (result.skipped) return res.status(400).json({ error: result.reason });
    res.json({ text: result.text, modelUsed: result.modelUsed });
  } catch (err) {
    next(err);
  }
}

/**
 * Downloads a finished clip, puts the approved still's lettering back over it, and fits it to the requested size.
 * Returns the local /uploads/... path. Best-effort for the lock and the fit; throws only if the download fails.
 */
async function finalizeVideoFile(job, variant, remoteUrl) {
  const localUrl = await saveGeneratedVideo(remoteUrl);
  aiLog('video', 'done', { provider: job.provider, msg: 'video downloaded and saved', extra: localUrl });
  // Video models fade and re-draw lettering as gibberish. Put the approved still's
  // exact text back over every frame (best-effort - never blocks the video).
  // Skipped when a headline / text animation was chosen - pasting the still text back would undo it.
  if (job.sourceMode === 'animate_kv' && variant.imageUrl && !job.textAnimated) {
    const lock = await lockVideoText({
      videoPath: resolveUploadPath(localUrl),
      stillPath: resolveUploadPath(variant.imageUrl)
    });
    console.log('[video] text lock:', JSON.stringify(lock));
    aiLog('lock', lock.applied ? 'done' : 'info', { provider: 'ffmpeg', msg: lock.applied ? `text lock applied - original wording pasted over every frame (${lock.lines ?? '?'} line(s))` : `text lock skipped - ${lock.reason || 'nothing to lock'}` });
    job.note = lock.applied ? '' : job.note;
  }
  // The person picked an exact size: crop/scale the finished clip to it (best-effort, the original is kept on failure).
  if (job.requestedSize?.w && job.requestedSize?.h) {
    const fit = await fitVideoToSize(resolveUploadPath(localUrl), job.requestedSize);
    aiLog('video', fit.applied ? 'done' : 'info', { provider: 'ffmpeg', msg: fit.applied ? `video fitted to ${fit.w}x${fit.h}` : `fit to size skipped - ${fit.reason || 'nothing to do'}` });
  }
  return localUrl;
}

// How many corrected re-makes the moderator check may use per video (each re-make is a full paid generation). Same for every video provider.
const QC_MAX_FIXES = Math.min(3, Math.max(1, Number(process.env.VIDEO_QC_MAX_FIXES) || 2));

/** Ends the moderator check: the job becomes 'completed' with the given clip, or (keepBest) the best clip found so far. */
async function finishQualityCheck(post, job, { result, keepBest = false, videoUrl } = {}) {
  if (videoUrl) job.videoUrl = videoUrl;
  else if (keepBest) job.videoUrl = job.qcBestUrl || job.qcFirstUrl || job.videoUrl;
  job.qcStage = '';
  job.qcResult = result || '';
  job.status = job.videoUrl ? 'completed' : 'failed';
  if (!job.videoUrl) job.note = 'Video finished but could not be saved.';
  await post.save();
}

/** Starts the next corrected re-make (same video provider as the original job, so Seedance stays Seedance and Veo stays Veo). */
async function startQualityFix(req, post, variant, job, fixNote) {
  const format = getFormat(job.formatId || post.mediums?.[0]);
  job.qcNotes = [...(job.qcNotes || []), fixNote].slice(-4);
  const corrections = job.qcNotes.map((n, i) => `${i + 1}. ${n}`).join(' ');
  const prompt = `${job.prompt}\n\nCORRECTIONS FROM A QUALITY CHECK OF EARLIER ATTEMPTS - follow these carefully: ${corrections}`;
  const imagePath = job.sourceMode === 'animate_kv' && variant.imageUrl ? resolveUploadPath(variant.imageUrl) : undefined;
  const durationSeconds = format.isVideo ? format.recommendedDurationSeconds : undefined;
  const sub = await videoRouter.submitVideoJob({ provider: job.provider || 'auto', prompt, aspectRatio: job.aspectRatio, durationSeconds, imagePath });
  if (!sub.submitted) throw new Error(sub.note || 'could not start');
  await logVideoUsage(buildUsageContext(req, 'video_generate', post._id), { provider: sub.provider, externalJobId: sub.externalJobId, requestedSeconds: durationSeconds });
  job.qcAttempt = (job.qcAttempt || 0) + 1;
  job.fixJobId = sub.externalJobId;
  job.fixProvider = sub.provider;
  job.fixMeta = sub.providerMeta;
  job.qcStage = 'fixing';
  job.qcStartedAt = new Date();
  await post.save();
}

/**
 * One turn of the moderator loop for a clip that is already saved: look at it with the vision model, then
 * pass it, or start another corrected re-make while re-makes remain, or settle on the best clip seen.
 */
async function evaluateClip(req, post, variant, job, clipUrl) {
  const check = await checkVideoQuality({
    videoPath: resolveUploadPath(clipUrl),
    prompt: job.prompt,
    animatedFromStill: job.sourceMode === 'animate_kv',
    usageContext: buildUsageContext(req, 'video_quality_check', post._id)
  });
  const attempt = job.qcAttempt || 0;
  if (!check.checked) {
    aiLog('video', 'info', { provider: 'moderator', msg: `quality check skipped - ${check.reason || 'unavailable'}` });
    // a clip that could not be judged is used as it is (a re-make is newer; the first clip is the original)
    return finishQualityCheck(post, job, { result: attempt ? 'fixed' : 'skipped', videoUrl: clipUrl });
  }
  if (check.ok || !check.fixPrompt) {
    return finishQualityCheck(post, job, { result: attempt ? 'fixed' : 'passed', videoUrl: clipUrl });
  }

  // defective: remember it if it is the best so far (fewest issues; a tie goes to the newer clip)
  const count = Math.max(1, (check.issues || []).length);
  if (!job.qcBestUrl || count <= (job.qcBestIssueCount || 0)) { job.qcBestUrl = clipUrl; job.qcBestIssueCount = count; }
  job.qcIssues = check.issues || [];

  const max = job.qcMax || QC_MAX_FIXES;
  if (attempt >= max) {
    aiLog('video', 'info', { provider: 'moderator', msg: `still not clean after ${attempt} re-make(s); using the best clip` });
    return finishQualityCheck(post, job, { result: job.qcBestUrl === job.qcFirstUrl ? 'kept_original' : 'fixed', keepBest: true });
  }
  try {
    await startQualityFix(req, post, variant, job, check.fixPrompt);
  } catch (err) {
    aiLog('video', 'info', { provider: 'moderator', msg: `re-make could not start (${err.message}); using the best clip` });
    await finishQualityCheck(post, job, { result: job.qcBestUrl === job.qcFirstUrl || !job.qcBestUrl ? 'kept_original' : 'fixed', keepBest: true });
  }
}

/** Entry point: the first clip is saved on job.videoUrl. */
async function runQualityCheck(req, post, variant, job) {
  job.qcFirstUrl = job.videoUrl;
  job.qcMax = QC_MAX_FIXES;
  job.qcAttempt = 0;
  job.qcNotes = [];
  job.qcBestUrl = '';
  job.qcBestIssueCount = 0;
  await evaluateClip(req, post, variant, job, job.videoUrl);
}

/** Polls the current corrected re-make; when it lands it is saved and checked again. If a re-make fails, the best clip so far is kept. */
async function pollQualityFix(req, post, variant, job) {
  try {
    const r = await videoRouter.checkVideoJob({ provider: job.fixProvider || job.provider, externalJobId: job.fixJobId, providerMeta: job.fixMeta });
    if (r.status === 'processing') {
      // a re-make that has run far too long is abandoned
      if (job.qcStartedAt && Date.now() - new Date(job.qcStartedAt).getTime() > 25 * 60 * 1000) {
        await markVideoFailed(job.fixJobId);
        return finishQualityCheck(post, job, { result: 'kept_original', keepBest: true });
      }
      return;
    }
    if (r.status === 'failed') {
      await markVideoFailed(job.fixJobId);
      return finishQualityCheck(post, job, { result: job.qcBestUrl && job.qcBestUrl !== job.qcFirstUrl ? 'fixed' : 'kept_original', keepBest: true });
    }
    // completed: claim, save the clip the same way as the first, then check it
    job.qcStage = 'checking';
    job.qcStartedAt = new Date();
    await post.save();
    const fixedUrl = await finalizeVideoFile(job, variant, r.videoUrl);
    await attachVideoUrl(job.fixJobId, fixedUrl, r.usage);
    await evaluateClip(req, post, variant, job, fixedUrl);
  } catch (err) {
    aiLog('video', 'info', { provider: 'moderator', msg: `re-make could not be finished (${err.message}); using the best clip` });
    await finishQualityCheck(post, job, { result: 'kept_original', keepBest: true });
  }
}

/**
 * Polls a video job's status. When it's newly completed, downloads the
 * video locally (so playback/downloads are always served from this app,
 * not a possibly-temporary provider URL) and persists that.
 */
export async function getVariantVideoStatus(req, res, next) {
  try {
    const { label, jobId } = req.params;
    const post = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) });
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const variant = post.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const job = variant.videoJobs.find((j) => j.externalJobId === jobId);
    if (!job) return res.status(404).json({ error: 'Video job not found.' });

    // Already resolved (completed/failed) - nothing to poll, just return it.
    if (job.status === 'completed' || job.status === 'failed') {
      return res.json({ post, job });
    }

    // Moderator check in progress: the first clip is being inspected, or its corrected re-make is rendering.
    if (job.qcStage === 'checking') {
      // Another request is running the check. If it died (server restart), keep the first clip instead of hanging.
      if (job.qcStartedAt && Date.now() - new Date(job.qcStartedAt).getTime() > 5 * 60 * 1000) {
        await finishQualityCheck(post, job, { result: 'kept_original', keepBest: true });
      }
      return res.json({ post, job });
    }
    if (job.qcStage === 'fixing') {
      await pollQualityFix(req, post, variant, job);
      return res.json({ post, job });
    }

    const result = await videoRouter.checkVideoJob({ provider: job.provider, externalJobId: job.externalJobId, providerMeta: job.providerMeta });

    if (result.status === 'processing') {
      return res.json({ post, job });
    }

    if (result.status === 'failed') {
      await markVideoFailed(job.externalJobId);
      job.status = 'failed';
      job.note = result.note || 'Video generation failed.';
      await post.save();
      return res.json({ post, job });
    }

    // completed - download and persist locally
    // Moderator check on: claim the job first (the later steps take a while and polls keep arriving) - it stays 'processing' until the check is done.
    if (job.qualityCheck) {
      job.qcStage = 'checking';
      job.qcStartedAt = new Date();
      await post.save();
    }
    try {
      job.videoUrl = await finalizeVideoFile(job, variant, result.videoUrl);
      if (!job.qualityCheck) {
        job.status = 'completed';
        await attachVideoUrl(job.externalJobId, job.videoUrl, result.usage);
      } else {
        await attachVideoUrl(job.externalJobId, job.videoUrl, result.usage);
        await runQualityCheck(req, post, variant, job);
      }
    } catch (err) {
      job.qcStage = '';
      job.status = 'failed';
      job.note = `Video finished but could not be saved: ${err.message}`;
    }
    await post.save();

    res.json({ post, job });
  } catch (err) {
    next(err);
  }
}

/**
 * Saves hand-edits to a variant's caption and/or image prompt with no AI
 * call at all - just persistence. Lets the user act as copywriter/art
 * director and directly edit either before (or after) generating.
 */
export async function updateVariant(req, res, next) {
  try {
    const { label } = req.params;
    const { caption, imagePrompt } = req.body;

    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });
    if (!existing.designs.some((d) => d.label === label)) {
      return res.status(404).json({ error: `Variant "${label}" not found.` });
    }

    const setFields = {};
    if (typeof caption === 'string') setFields['designs.$.caption'] = caption;
    if (typeof imagePrompt === 'string') setFields['designs.$.imagePrompt'] = imagePrompt;

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ error: 'Nothing to update - provide caption and/or imagePrompt.' });
    }

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req), 'designs.label': label },
      { $set: setFields },
      { new: true }
    );

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Updates typography settings (whether to bake a headline into the image,
 * and what that headline says) - lives on the post's creativeBrief and gets
 * applied fresh at image-generation time (see designService.js), so
 * changing it after copy is drafted always takes effect on the next
 * generate/regenerate, no re-drafting copy required.
 */
export async function updateCreativeBrief(req, res, next) {
  try {
    const { includeTypography, headlineText, includeSubHeadline, subHeadlineText } = req.body;
    const setFields = {};
    if (typeof includeTypography === 'boolean') setFields['creativeBrief.includeTypography'] = includeTypography;
    if (typeof headlineText === 'string') setFields['creativeBrief.headlineText'] = headlineText;
    if (typeof includeSubHeadline === 'boolean') setFields['creativeBrief.includeSubHeadline'] = includeSubHeadline;
    if (typeof subHeadlineText === 'string') setFields['creativeBrief.subHeadlineText'] = subHeadlineText.slice(0, 160);

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ error: 'Nothing to update - provide includeTypography, headlineText, includeSubHeadline and/or subHeadlineText.' });
    }

    const post = await Post.findOneAndUpdate({ _id: req.params.id, ...ownerFilter(req) }, { $set: setFields }, { new: true });
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Suggests a short headline/CTA distilled from a variant's actual caption -
 * only possible once real copy exists, which is why this lives in Step 02
 * rather than being typed blind at Step 01. Doesn't persist anything;
 * the client applies it via updateCreativeBrief if they like it.
 */
export async function generateVariantHeadline(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });

    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    const caption = (req.body.caption && req.body.caption.trim()) || variant.caption;
    if (!caption) {
      return res.status(400).json({ error: 'This variant has no caption yet to base a headline on.' });
    }

    const { headline, subheadline, modelUsed, note } = await captionService.generateHeadline({
      caption,
      user: brandUser(req, existing),
      model: req.body.model || 'auto',
      withSubheadline: req.body.withSubheadline === true,
      followBrand: brandFollowed(req, existing.selectedAssets, existing),
      usageContext: buildUsageContext(req, 'headline', existing._id)
    });

    res.json({ headline, ...(subheadline !== undefined ? { subheadline } : {}), modelUsed, note });
  } catch (err) {
    next(err);
  }
}

/**
 * Several headline options for the selected creative (see captionService.generateHeadlineOptions).
 * Sends the rendered image along when it is a local upload, so options fit what it shows.
 */
export async function generateVariantHeadlineOptions(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });
    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });

    let image = null;
    if (variant.imageUrl && variant.imageUrl.startsWith('/uploads/')) {
      try {
        const filePath = resolveUploadPath(variant.imageUrl);
        const buf = await sharp(filePath).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        image = { base64: buf.toString('base64'), mimeType: 'image/jpeg' };
      } catch (err) {
        console.warn('[headline-options] could not read the creative image:', err.message);
      }
    }
    const exclude = (Array.isArray(req.body.exclude) ? req.body.exclude : []).filter((v) => typeof v === 'string').map((v) => v.slice(0, 80)).slice(0, 40);
    const format = getFormat(existing.mediums?.[0]);

    const { options, modelUsed, note } = await captionService.generateHeadlineOptions({
      caption: variant.caption,
      imagePrompt: (variant.imagePrompt || '').slice(0, 600),
      purpose: existing.purpose,
      briefNote: existing.briefNote,
      formatLabel: format ? `${format.platform} ${format.label}` : '',
      kind: req.body.kind === 'sub' ? 'sub' : 'headline',
      headline: String(req.body.headline || '').slice(0, 120),
      // Improve sends what the marketer typed (not yet saved) as `current`; Suggest on an empty box falls back to the saved headline.
      currentHeadline: (Boolean(req.body.improve) && String(req.body.current || '').trim())
        ? String(req.body.current).slice(0, 160)
        : req.body.kind === 'sub' ? String(req.body.current || '').slice(0, 160) : existing.creativeBrief?.headlineText || '',
      improve: Boolean(req.body.improve) && Boolean(String(req.body.current || '').trim()),
      exclude,
      image,
      user: brandUser(req, existing),
      usageContext: buildUsageContext(req, 'headline', existing._id)
    });
    res.json({ options, modelUsed, note });
  } catch (err) {
    next(err);
  }
}

/**
 * Improve for the post copy box: three improved versions of the copy the marketer typed (body.caption), never the same text back.
 */
export async function improveVariantCaptionOptions(req, res, next) {
  try {
    const { label } = req.params;
    const existing = await Post.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!existing) return res.status(404).json({ error: 'Post not found.' });
    const variant = existing.designs.find((d) => d.label === label);
    if (!variant) return res.status(404).json({ error: `Variant "${label}" not found.` });
    const caption = String(req.body?.caption ?? variant.caption ?? '').slice(0, 2200);
    if (!caption.trim()) return res.status(400).json({ error: 'Write some post copy first, then click Improve.' });
    const format = getFormat(existing.mediums?.[0]);
    const { options, modelUsed, note } = await captionService.improveCaptionOptions({
      caption,
      purpose: existing.purpose,
      formatLabel: format ? `${format.platform} ${format.label}` : '',
      user: brandUser(req, existing),
      usageContext: buildUsageContext(req, 'post_copy_options', existing._id)
    });
    res.json({ options, modelUsed, note });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// STEP 03 - Refine Options (select a variant to carry forward)
// ---------------------------------------------------------------------------
export async function selectVariant(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const { label } = req.body;
    if (!post.designs.some((d) => d.label === label)) {
      return res.status(400).json({ error: `Variant "${label}" does not exist on this post.` });
    }

    post.selectedVariantLabel = label;
    await post.save();

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// STEP 04 - Modify Post (image + copy refinement, independently)
// ---------------------------------------------------------------------------
const MIME_BY_EXT_IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// Modify Post edits the variant's main imageUrl. The 3 option cards on the Generate Designs
// step are read from variant.imageOptions, so the option that was the active image (matched by
// its old URL) is pointed at the new image too - otherwise the edit never shows in the options.
function syncActiveImageOption(variant, fromUrl) {
  if (!fromUrl || !variant.imageUrl || variant.imageUrl === fromUrl) return;
  const option = (variant.imageOptions || []).find((o) => o.imageUrl === fromUrl);
  if (!option) return;
  option.imageUrl = variant.imageUrl;
  option.background = '';
  if (variant.imageModel) option.imageModel = variant.imageModel;
  option.imageNote = '';
}

// Fine tune must never change the size of the picture. The current image's own pixel size decides what the model is
// asked for, and whatever comes back is brought to exactly that size again (cover-fit, same aspect ratio).
async function currentImageDims(imageUrl) {
  try {
    const m = await sharp(resolveUploadPath(imageUrl)).metadata();
    return m.width && m.height ? { w: m.width, h: m.height } : null;
  } catch {
    return null;
  }
}
async function restoreImageSize(savedUrl, dims) {
  if (!dims || !savedUrl) return savedUrl;
  try {
    const filePath = resolveUploadPath(savedUrl);
    const m = await sharp(filePath).metadata();
    if (m.width === dims.w && m.height === dims.h) return savedUrl;
    const buf = await sharp(filePath).resize(dims.w, dims.h, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
    const name = `gen-${uuidv4()}.png`;
    fs.writeFileSync(path.join(uploadDir(), name), buf);
    return uploadUrl(name);
  } catch (err) {
    console.warn('[modifyImage] could not restore the original size:', err?.message || err);
    return savedUrl;
  }
}

export async function modifyImage(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const variant = post.designs.find((d) => d.label === post.selectedVariantLabel);
    if (!variant) return res.status(400).json({ error: 'No selected variant to modify.' });
    const originalImageUrl = variant.imageUrl;

    const { method, prompt, model = 'auto' } = req.body;

    if (method === 'upload') {
      if (!req.file) return res.status(400).json({ error: 'No replacement image uploaded.' });
      variant.imageUrl = uploadUrl(req.file.filename, req.tenant);
      variant.background = '';
      variant.previousImageUrl = '';
      post.modifications.push({ target: 'image', method: 'upload', input: req.file.originalname, resultUrl: variant.imageUrl });
    } else if (method === 'prompt') {
      if (!prompt) return res.status(400).json({ error: 'A prompt is required to regenerate the image.' });

      // INCREMENTAL EDIT: when the variant already has an image, the instruction is applied to THAT image
      // (e.g. "change the background to an office") instead of re-generating the whole creative from its brief.
      const currentImagePath = variant.imageUrl ? resolveUploadPath(variant.imageUrl) : '';
      if (currentImagePath && fs.existsSync(currentImagePath)) {
        const ext = path.extname(currentImagePath).toLowerCase();
        const editPrompt = [
          'Edit the attached image. Apply ONLY this requested change:',
          `"${String(prompt).trim()}"`,
          'Everything else must stay exactly as it is in the attached image: the same subject(s) and people (faces, pose, clothing), the same product and packaging with its labels and wording, the same logos, the same on-image text and its exact spelling, the same layout, positions, scale, crop, colours and lighting on the subjects.',
          'Do NOT redraw, restyle, re-compose, move, resize or re-imagine anything that was not named in the change. If the change affects only the background or one element, keep every other pixel as close to identical as possible and blend the edit naturally at the edges. Keep the same aspect ratio and framing. Do not add borders, bars, watermarks or new text.'
        ].join(' ');
        const srcDims = await currentImageDims(variant.imageUrl);
        const size = srcDims ? modelSizeFor(srcDims.w, srcDims.h) : getFormat(post.mediums?.[0]).size;
        const result = await router.generateImage({
          purpose: 'editing the existing image (incremental change)',
          model,
          prompt: editPrompt,
          size,
          quality: 'high',
          inputFidelity: 'high',
          referenceImages: [{ filePath: currentImagePath, mimeType: MIME_BY_EXT_IMG[ext] || 'image/png', filename: path.basename(currentImagePath) }]
        });

        if (!result.placeholder) {
          const savedUrl = await restoreImageSize(await saveGeneratedImage(result, srcDims ? `${srcDims.w}:${srcDims.h}` : getFormat(post.mediums?.[0]).ratio), srcDims);
          variant.previousImageUrl = variant.imageUrl; // lets "undo" bring the old image back
          variant.imageUrl = savedUrl;
          variant.background = '';
          variant.imageModel = result.modelUsed;
          variant.imageNote = '';
          logUsageSafely(buildUsageContext(req, 'image_modify', post._id), {
            type: 'image',
            provider: result.modelUsed,
            estimatedCostUsd: estimateImageCostUsdByProvider(result.modelUsed, 'high'),
            imageUrl: variant.imageUrl
          });
        } else {
          variant.imageNote = result.note || '';
          variant.imageBillingUrl = result.billingUrl || '';
          variant.imageBillingProviderLabel = result.billingProviderLabel || '';
          logUsageSafely(buildUsageContext(req, 'image_modify', post._id), { type: 'image', provider: 'placeholder', estimatedCostUsd: 0 });
        }
        post.modifications.push({ target: 'image', method: 'prompt', input: prompt, resultUrl: variant.imageUrl, model: result.modelUsed });
        syncActiveImageOption(variant, originalImageUrl);
        await post.save();
        return res.json({ post });
      }

      const fullPrompt = designService.applyBrandPreference(`${variant.imagePrompt || ''}\nAdditional direction: ${prompt}`.trim(), brandFollowed(req, post.selectedAssets, post));
      const size = getFormat(post.mediums?.[0]).size;
      const { groundingImages, styleImages, exactAssets } = await resolveReferenceImages(post.selectedAssets, post.referenceCreatives, post.exactAssetIds, brandFollowed(req, post.selectedAssets, post), post.subBrand);
      const layoutCount = styleImages.filter((s) => s.role === 'layout').length;
      const brandRefCount = styleImages.filter((s) => s.role === 'brand-reference').length;
      const referenceNote = designService.referenceInstructionText({ hasGroundingImages: groundingImages.length > 0, hasStyleImages: styleImages.length - layoutCount - brandRefCount > 0, hasLayoutImages: layoutCount > 0, hasBrandReferenceImages: brandRefCount > 0, hasExactAssets: exactAssets.some((a) => a.anchor !== 'center'), hasProductLock: exactAssets.some((a) => a.anchor === 'center') });
      const finalPrompt = referenceNote ? `${fullPrompt} ${referenceNote}` : fullPrompt;
      const result = await router.generateImage({
        purpose: 'applying an edit to the image',
        model,
        prompt: finalPrompt,
        size,
        quality: 'high',
        referenceImages: [...groundingImages, ...styleImages]
      });

      if (!result.placeholder) {
        let modifiedUrl = await saveGeneratedImage(result, getFormat(post.mediums?.[0]).ratio);
        if (exactAssets.length) {
          modifiedUrl = await compositeExactAssets(modifiedUrl, exactAssets);
        }
        variant.imageUrl = modifiedUrl;
        variant.background = '';
        variant.previousImageUrl = '';
        variant.imageModel = result.modelUsed;
        variant.imageNote = '';
        logUsageSafely(buildUsageContext(req, 'image_modify', post._id), {
          type: 'image',
          provider: result.modelUsed,
          estimatedCostUsd: estimateImageCostUsdByProvider(result.modelUsed, 'high'),
          imageUrl: variant.imageUrl
        });
      } else {
        variant.imageNote = result.note || '';
        variant.imageBillingUrl = result.billingUrl || '';
        variant.imageBillingProviderLabel = result.billingProviderLabel || '';
        logUsageSafely(buildUsageContext(req, 'image_modify', post._id), { type: 'image', provider: 'placeholder', estimatedCostUsd: 0 });
      }
      post.modifications.push({ target: 'image', method: 'prompt', input: prompt, resultUrl: variant.imageUrl, model: result.modelUsed });
    } else if (method === 'region') {
      const { maskDataUrl, instruction } = req.body;
      if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'Describe what should change in the marked area.' });
      if (!maskDataUrl) return res.status(400).json({ error: 'No marked area was received - draw over the part that needs fixing first.' });
      if (!variant.imageUrl) return res.status(400).json({ error: 'There\'s no image yet to fix - generate one first.' });

      const imagePath = resolveUploadPath(variant.imageUrl);
      if (!fs.existsSync(imagePath)) return res.status(400).json({ error: 'The current image file could not be found on the server.' });

      const base64Match = /^data:image\/\w+;base64,(.+)$/.exec(maskDataUrl);
      if (!base64Match) return res.status(400).json({ error: 'The marked area was sent in an unexpected format.' });
      const maskBuffer = Buffer.from(base64Match[1], 'base64');

      const regionDims = await currentImageDims(variant.imageUrl);
      const size = regionDims ? modelSizeFor(regionDims.w, regionDims.h) : getFormat(post.mediums?.[0]).size;
      const result = await designService.refineImageRegion({
        imagePath,
        maskBuffer,
        instruction,
        imageModel: model,
        size,
        usageContext: buildUsageContext(req, 'image_refine_region', post._id)
      });

      if (!result.placeholder) {
        // One-level undo: keep the pre-touch-up image so a bad fix can be
        // reverted without spending another generation call. Not chained -
        // this overwrites any previous undo point, since only the most
        // recent edit is ever offered back.
        variant.previousImageUrl = variant.imageUrl;
        variant.imageUrl = await restoreImageSize(result.imageUrl, regionDims);
        variant.background = '';
        variant.imageModel = result.imageModel;
        variant.imageNote = '';
      } else {
        variant.imageNote = result.note || '';
        variant.imageBillingUrl = result.billingUrl || '';
        variant.imageBillingProviderLabel = result.billingProviderLabel || '';
      }
      post.modifications.push({ target: 'image', method: 'region', input: instruction, resultUrl: variant.imageUrl, model: result.imageModel || '' });
    } else {
      return res.status(400).json({ error: 'method must be "upload", "prompt", or "region".' });
    }

    syncActiveImageOption(variant, originalImageUrl);
    await post.save();
    res.json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * Reverts the selected variant's image to whatever it was immediately
 * before the last "Fix an area" touch-up - see previousImageUrl on
 * designVariantSchema in Post.js. A no-op (400) if there's nothing to
 * undo, e.g. the last change was a full regenerate/upload instead, or undo
 * was already used once for this edit.
 */
export async function undoImageEdit(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const variant = post.designs.find((d) => d.label === post.selectedVariantLabel);
    if (!variant) return res.status(400).json({ error: 'No selected variant to undo.' });
    if (!variant.previousImageUrl) return res.status(400).json({ error: 'Nothing to undo.' });

    const imageUrlBeforeUndo = variant.imageUrl;
    variant.imageUrl = variant.previousImageUrl;
    variant.previousImageUrl = '';
    variant.background = '';
    syncActiveImageOption(variant, imageUrlBeforeUndo);

    await post.save();
    res.json({ post });
  } catch (err) {
    next(err);
  }
}

export async function modifyCopy(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const variant = post.designs.find((d) => d.label === post.selectedVariantLabel);
    if (!variant) return res.status(400).json({ error: 'No selected variant to modify.' });

    const { method, instruction, model = 'auto' } = req.body;

    let result;
    if (method === 'sharpen') {
      result = await captionService.sharpenCaption({ caption: variant.caption, user: brandUser(req, post), model, followBrand: brandFollowed(req, post.selectedAssets, post), usageContext: buildUsageContext(req, 'copy_modify', post._id) });
    } else if (method === 'prompt') {
      if (!instruction) return res.status(400).json({ error: 'An instruction is required.' });
      result = await captionService.refineCaption({ caption: variant.caption, instruction, user: brandUser(req, post), model, followBrand: brandFollowed(req, post.selectedAssets, post), usageContext: buildUsageContext(req, 'copy_modify', post._id) });
    } else {
      return res.status(400).json({ error: 'method must be "sharpen" or "prompt".' });
    }

    variant.caption = result.caption;
    variant.textModel = result.modelUsed;
    post.modifications.push({
      target: 'copy',
      method,
      input: instruction || '(sharpen)',
      resultText: result.caption,
      model: result.modelUsed
    });

    await post.save();
    res.json({ post, aiNote: result.note });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// STEP 05 - Publish (approval routing + download / deploy)
// ---------------------------------------------------------------------------
export async function sendForApproval(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const { approverName, note } = req.body;
    post.status = 'in_review';
    post.approval = {
      approverName: approverName || '',
      note: note || '',
      status: 'pending',
      requestedAt: new Date()
    };
    await post.save();

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

export async function respondToApproval(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const { decision } = req.body; // "approved" | "changes_requested"
    if (!['approved', 'changes_requested'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approved" or "changes_requested".' });
    }

    post.approval.status = decision;
    post.approval.respondedAt = new Date();
    post.status = decision === 'approved' ? 'approved' : 'draft';
    await post.save();

    res.json({ post });
  } catch (err) {
    next(err);
  }
}

export async function publishPost(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const { platform, account } = req.body;
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `Unsupported platform. Choose one of: ${SUPPORTED_PLATFORMS.join(', ')}` });
    }

    const variant = post.designs.find((d) => d.label === post.selectedVariantLabel);
    const carouselImageUrls = variant?.carouselSlides?.length
      ? variant.carouselSlides.filter((s) => s.imageUrl).map((s) => s.imageUrl)
      : null;
    const deployment = await deployToPlatform(platform, {
      user: brandUser(req, post),
      account,
      imageUrl: variant?.imageUrl,
      videoUrl: variant?.videoUrl,
      caption: variant?.caption,
      title: post.creativeBrief?.primaryMessage || post.purpose || 'Automatr post',
      carouselImageUrls
    });

    post.publishedTo.push(deployment);
    post.status = 'published';
    await post.save();

    // Customers with "deliver automatically on publish" get the finished creative sent to
    // their folder/webhook. Never fails the publish.
    const delivery = await deliverSafely(post, req.customer);

    res.json({ post, deployment, ...(delivery ? { delivery } : {}) });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// "Edit Headline Only" / "Change Hero Image Only" - single-purpose edits of an
// uploaded, finished creative. Both build a strict edit prompt and hand it to
// runImageEdit below, which keeps the artwork's ORIGINAL pixel size.
// ---------------------------------------------------------------------------

const cleanEditText = (v, max = 240) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim().slice(0, max);

/**
 * Runs one image edit against the uploaded creative (sourceFile) and stores the
 * result as the post's selected variant. The untouched upload is kept as
 * previousImageUrl so Modify Post's undo restores it. `extraRefs` are further
 * reference images sent after the source (e.g. a replacement hero photo).
 */
async function runImageEdit({ req, res, post, sourceFile, prompt, extraRefs = [], purpose, modInput, model = 'auto' }) {
  const sourcePath = resolveUploadPath(sourceFile.filename);
  const meta = await sharp(sourcePath).metadata();
  if (!meta.width || !meta.height) return res.status(400).json({ error: 'That image could not be read.' });

  // The finished file is resized back to the ORIGINAL pixel dimensions below, so
  // generate close to that resolution (clamped to what the image model handles
  // well), snapped to multiples of 16 and kept within a 1:3 ratio.
  const origW = meta.orientation >= 5 ? meta.height : meta.width;
  const origH = meta.orientation >= 5 ? meta.width : meta.height;
  const scale = Math.min(2048, Math.max(1024, Math.max(meta.width, meta.height))) / Math.max(meta.width, meta.height);
  const snap = (n) => Math.max(256, Math.round((n * scale) / 16) * 16);
  let w = snap(meta.width);
  let h = snap(meta.height);
  if (w / h > 3) w = h * 3;
  if (h / w > 3) h = w * 3;
  const size = `${w}x${h}`;
  // Optional "Choose size": the client sends `sizePx` ("1080x1350"); the result is adapted to it (same AI adaptation as Size Adapt).
  // Without it the result keeps the original pixel size. (Subject Swap / Headline Switch.)
  let finalW = origW;
  let finalH = origH;
  const sizeMatch = /^(\d{2,5})x(\d{2,5})$/.exec(String(req.body?.sizePx || '').trim());
  if (sizeMatch) {
    const tw = +sizeMatch[1];
    const th = +sizeMatch[2];
    if (tw >= 16 && tw <= 8000 && th >= 16 && th <= 8000) { finalW = tw; finalH = th; }
  }
  // The edit itself is made at the original's proportions. When another size was chosen it is then adapted to it
  // below with exactly the same AI adaptation Size Adapt uses (nothing important cropped), not by cropping.
  const ratio = `${origW}:${origH}`;

  const variant = post.designs.find((d) => d.label === post.selectedVariantLabel) || post.designs[0];
  if (!variant) return res.status(400).json({ error: 'No design to put the edited image in.' });

  const originalUrl = uploadUrl(sourceFile.filename, req.tenant);
  const result = await router.generateImage({
    purpose,
    model,
    prompt,
    size,
    quality: 'high',
    inputFidelity: 'high',
    referenceImages: [
      { filePath: sourcePath, mimeType: sourceFile.mimetype, filename: sourceFile.filename },
      ...extraRefs
    ]
  });

  if (result.placeholder) {
    variant.imageNote = result.note || '';
    variant.imageBillingUrl = result.billingUrl || '';
    variant.imageBillingProviderLabel = result.billingProviderLabel || '';
    logUsageSafely(buildUsageContext(req, 'image_modify', post._id), { type: 'image', provider: 'placeholder', estimatedCostUsd: 0 });
    await post.save();
    return res.status(502).json({
      error: result.note || 'The image could not be edited right now.',
      isBillingError: Boolean(result.isBillingError),
      billingUrl: result.billingUrl || null,
      billingProviderLabel: result.billingProviderLabel || null,
      post
    });
  }

  let savedUrl = await saveGeneratedImage(result, ratio);
  // Output keeps the artwork's original size: resize the saved file to the
  // uploaded creative's exact pixel dimensions (same format, written in place).
  try {
    const savedPath = resolveUploadPath(savedUrl);
    const resized = await sharp(savedPath).resize(origW, origH, { fit: 'cover' }).toBuffer();
    fs.writeFileSync(savedPath, resized);
  } catch (resizeErr) {
    console.warn('[image-edit] could not resize to the original dimensions:', resizeErr.message);
  }
  // "Choose size": adapt the edited creative to the chosen size with the Size Adapt rules (AI re-composition that keeps
  // every face, the product and all text inside the frame). If that cannot be done, fall back to a plain crop.
  console.log(`[image-edit] original ${origW}x${origH}, chosen size ${req.body?.sizePx || '(none - keep original)'} -> ${finalW !== origW || finalH !== origH ? 'adapting to the chosen size' : 'no adaptation needed'}`);
  if (finalW !== origW || finalH !== origH) {
    const cropTo = async (url) => {
      const fp = resolveUploadPath(url);
      const buf = await sharp(fp).resize(finalW, finalH, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
      const name = `gen-${uuidv4()}.png`;
      fs.writeFileSync(path.join(uploadDir(), name), buf);
      return uploadUrl(name);
    };
    const gap = Math.max((origW / origH) / (finalW / finalH), (finalW / finalH) / (origW / origH));
    try {
      if (gap <= 1.03) {
        savedUrl = await cropTo(savedUrl);
      } else {
        const ext = path.extname(savedUrl).toLowerCase();
        const adapted = await designService.portImageToFormat({
          masterImage: { filePath: resolveUploadPath(savedUrl), mimeType: MIME_BY_EXT_IMG[ext] || 'image/png', filename: path.basename(savedUrl) },
          targetFormatId: `custom_${finalW}x${finalH}`,
          imageModel: model,
          qualityTier: 'high',
          preserveText: true,
          usageContext: buildUsageContext(req, 'image_port_format', post._id)
        });
        savedUrl = adapted?.imageUrl || (await cropTo(savedUrl));
      }
    } catch (adaptErr) {
      console.warn('[image-edit] could not adapt to the chosen size, cropping instead:', adaptErr?.message || adaptErr);
      try { savedUrl = await cropTo(savedUrl); } catch { /* keep the edit at its original size */ }
    }
  }
  variant.formatVariants = []; // sizes ported from an earlier version of this edit are now stale
  variant.previousImageUrl = originalUrl; // Modify Post's undo brings the untouched original back
  variant.originalImageUrl = originalUrl; // kept for good so Saved Documents can open the original
  variant.imageUrl = savedUrl;
  variant.background = '';
  variant.imageModel = result.modelUsed;
  variant.imageNote = '';
  logUsageSafely(buildUsageContext(req, 'image_modify', post._id), {
    type: 'image',
    provider: result.modelUsed,
    estimatedCostUsd: estimateImageCostUsdByProvider(result.modelUsed, 'high'),
    imageUrl: variant.imageUrl
  });
  post.modifications.push({
    target: 'image',
    method: 'prompt',
    input: String(modInput || '').slice(0, 500),
    resultUrl: variant.imageUrl,
    model: result.modelUsed
  });
  post.markModified('designs');
  await post.save();
  return res.json({ post, meta: { width: finalW, height: finalH } });
}

/**
 * "Adapt to Other Sizes": takes a finished creative as uploaded - no edit at all - and
 * stores it as the post's selected variant, so it can go straight to Adapt Creative
 * (port to other sizes) or Download. The untouched upload is also kept as originalImageUrl.
 */
export async function adoptCreativeForAdaptation(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (!req.file) return res.status(400).json({ error: 'Upload the creative to adapt.' });

    const filePath = resolveUploadPath(req.file.filename);
    const meta = await sharp(filePath).metadata();
    if (!meta.width || !meta.height) return res.status(400).json({ error: 'That image could not be read.' });
    const width = meta.orientation >= 5 ? meta.height : meta.width;
    const height = meta.orientation >= 5 ? meta.width : meta.height;

    const variant = post.designs.find((d) => d.label === post.selectedVariantLabel) || post.designs[0];
    if (!variant) return res.status(400).json({ error: 'No design to put the creative in.' });

    const url = uploadUrl(req.file.filename, req.tenant);
    variant.formatVariants = []; // sizes ported from an earlier upload are stale
    variant.imageUrl = url;
    variant.originalImageUrl = url;
    variant.previousImageUrl = '';
    variant.background = '';
    variant.imageModel = '';
    variant.imageNote = '';
    post.markModified('designs');
    await post.save();
    res.json({ post, meta: { width, height } });
  } catch (err) {
    next(err);
  }
}

/**
 * "Edit Headline Only": takes the uploaded creative plus the per-line edits
 * ({ id, label, original, action: 'keep' | 'change' | 'remove', text }) and
 * produces ONE edited image in which only those text lines differ.
 */
export async function editHeadlineText(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (!req.file) return res.status(400).json({ error: 'Upload the creative to edit.' });

    let edits;
    try {
      edits = JSON.parse(req.body.edits || '[]');
    } catch {
      return res.status(400).json({ error: 'The text changes were sent in an unexpected format.' });
    }
    if (!Array.isArray(edits)) return res.status(400).json({ error: 'The text changes were sent in an unexpected format.' });

    const changes = [];
    const kept = [];
    for (const e of edits.slice(0, 6)) {
      const label = cleanEditText(e.label, 40) || 'Text';
      const original = cleanEditText(e.original);
      // Where on the image the line sits (from the box the person drew or the detected one), in words.
      const where = cleanEditText(e.where, 200);
      if (e.action === 'remove') {
        // A box the person drew (no text read from it) can be removed too: whatever sits there is taken out.
        if (original || where) changes.push({ label, original, remove: true, where });
      } else if (e.action === 'change') {
        const text = cleanEditText(e.text);
        if (!text) continue;
        if (text !== original) changes.push({ label, original, text, where });
      } else if (original) {
        kept.push({ label, original });
      }
    }
    if (changes.length === 0) {
      return res.status(400).json({ error: 'Change or remove at least one line first - nothing is different from the original yet.' });
    }

    const changeLines = changes.map((c) =>
      c.remove
        ? `- Remove ${c.original ? `the ${c.label.toLowerCase()} that currently reads "${c.original}"` : 'any text or element'}${c.where ? ` (${c.where})` : ''} completely, and fill the area it occupied by naturally continuing the surrounding background, so it looks as if that text was never there (no empty box, patch, blur or smudge).`
        : c.original
        ? `- Replace the ${c.label.toLowerCase()} that currently reads "${c.original}"${c.where ? ` (${c.where})` : ''} with exactly this text: "${c.text}".`
        : c.where
        ? `- Add new text ${c.where}, reading exactly: "${c.text}". Match the typography and colour of the existing headline text so it looks like part of the original design.`
        : `- Replace the ${c.label.toLowerCase()} with exactly this text: "${c.text}".`
    );
    const keptLine = kept.length
      ? `These text lines stay exactly as they are, word for word: ${kept.map((k) => `"${k.original}"`).join('; ')}.`
      : '';
    const editPrompt = [
      'Edit the attached image. This is a TEXT-ONLY edit: change ONLY the on-image text listed below and nothing else.',
      changeLines.join(' '),
      'Draw any new text in the identical font family, weight, case style, colour, effects (shadow, outline, gradient), letter-spacing, line-height, alignment and position as the text it replaces, so it looks like part of the original design. If the new text is longer, reduce its size slightly or wrap it within the same area and margins so it fits without touching other elements. Spell every new word exactly, character for character, and do not add any other words.',
      keptLine,
      editTextRules(changes.filter((c) => !c.remove).map((c) => c.text)),
      'Everything else must stay exactly as it is in the attached image: all other text and its exact spelling (including small print, URLs, phone numbers and prices), the same logos, the same subject(s) and people (faces, pose, clothing), the same product and packaging with its labels and wording, the same background, layout, positions, scale, colours, lighting, crop and framing.',
      'Do NOT redraw, restyle, re-compose, move, resize or re-imagine anything that was not named above, and do not add any new text, watermark, border or decoration. Keep every other pixel as close to identical as possible.'
    ]
      .filter(Boolean)
      .join(' ');

    await runImageEdit({
      req,
      res,
      post,
      sourceFile: req.file,
      prompt: editPrompt,
      purpose: 'editing headline text on the uploaded image',
      modInput: `Headline edit: ${changes.map((c) => (c.remove ? `removed ${c.label}` : `${c.label} -> ${c.text}`)).join('; ')}`
    });
  } catch (err) {
    next(err);
  }
}

// Shared wording for "a different but similar subject", used by the single-hero and per-subject paths.
const similarSubjectText = (current) =>
  `Replace ${current} with a DIFFERENT but SIMILAR subject. If it is a person, replace them with a different real-looking person of the same gender and a similar age range, with a clearly different face, hairstyle and features, but in the same pose, body position, expression, gaze direction, gestures and camera angle, wearing clothing of a similar style and colour palette. If it is an object, vehicle or animal, replace it with another of the same kind in the same arrangement, angle and framing but with different specific details. Keep the same framing, scale and position in the layout. The new subject must not be recognisable as the original person or object, must not resemble any real or famous person, and must look natural in the scene.`;

/**
 * Subject Swap with several subjects: instruction.items = [{ current, position, mode, newHero, direction, refIndex }]
 * (mode 'describe' | 'similar' | 'upload'; refIndex points into the uploaded `replacement` files).
 * Only the listed subjects change; instruction.keep names the ones that must stay.
 */
async function editHeroItems({ req, res, post, source, replacements, instruction }) {
  const keep = (Array.isArray(instruction.keep) ? instruction.keep : []).map((k) => cleanEditText(k, 200)).filter(Boolean).slice(0, 6);
  const items = instruction.items.slice(0, 6).map((it) => ({
    current: cleanEditText(it.current, 300) || 'the main hero subject',
    where: cleanEditText(it.position, 200),
    mode: ['upload', 'similar', 'remove'].includes(it.mode) ? it.mode : 'describe',
    newHero: cleanEditText(it.newHero, 300),
    direction: cleanEditText(it.direction, 200),
    refIndex: Number.isInteger(it.refIndex) ? it.refIndex : -1
  }));

  const extraRefs = [];
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const who = `subject ${i + 1} (${it.current}${it.where ? `; ${it.where}` : ''})`;
    if (it.mode === 'remove') {
      lines.push(`- Remove ${who} completely, and fill the area it occupied by naturally continuing the surrounding background and scene, so it looks as if it was never there (no empty box, patch, blur, smudge or leftover outline). Do not replace it with anything else.`);
    } else if (it.mode === 'describe') {
      if (!it.newHero) return res.status(400).json({ error: `Describe what should replace subject ${i + 1} first.` });
      lines.push(`- Replace ${who} with this new subject: ${it.newHero}.`);
    } else if (it.mode === 'upload') {
      const file = replacements[it.refIndex];
      if (!file) return res.status(400).json({ error: `Upload the reference image for subject ${i + 1}.` });
      extraRefs.push({ filePath: resolveUploadPath(file.filename), mimeType: file.mimetype, filename: file.filename });
      lines.push(`- Replace ${who} with the subject shown in attached image ${extraRefs.length + 1}. Reproduce that subject exactly as it appears there - identical shape, proportions, colours and details, and every bit of packaging, label, logo and wording on it exactly as shown, never redrawn, re-lettered or altered. Cut it cleanly away from its own background and do not carry over anything from that image's backdrop.${it.newHero ? ` Context: ${it.newHero}.` : ''}`);
    } else {
      lines.push(`- ${similarSubjectText(who)}${it.direction ? ` Direction: ${it.direction}.` : ''}`);
    }
  }

  const editPrompt = [
    'Edit the FIRST attached image. This is a SUBJECT-ONLY edit: change or remove ONLY the subjects listed below and nothing else.',
    lines.join(' '),
    keep.length ? `These other subjects in the image are NOT part of this edit and must stay completely unchanged - same face, look, pose, clothing, position and size: ${keep.join('; ')}.` : '',
    items.some((it) => it.mode !== 'remove') ? 'Place each new subject in the same position, scale, framing and camera angle as the one it replaces so it occupies the same area of the layout, and make it look naturally photographed in that scene: match the lighting direction, colour temperature, contact shadows, reflections and perspective. Remove every trace of each old subject (no ghosting, outlines or leftover parts) and rebuild any background that was hidden behind it so it continues naturally.' : 'Rebuild any background that was hidden behind a removed subject so it continues naturally, with no ghosting, outlines or leftover parts.',
    'Everything else must stay exactly as it is in the first image: all text and its exact spelling, the same logos and badges, the background/setting, layout, positions, colours, graphic elements, small print, crop and framing.',
    'Do NOT redraw, restyle, re-compose, move or resize anything other than the listed subjects, and do not add any new text, watermark, border or decoration. Keep every other pixel as close to identical as possible.'
  ]
    .filter(Boolean)
    .join(' ');

  return runImageEdit({
    req,
    res,
    post,
    sourceFile: source,
    extraRefs,
    prompt: editPrompt,
    purpose: 'swapping subjects on the uploaded creative',
    modInput: `Subject swap: ${items.map((it, i) => `${i + 1} ${it.mode === 'remove' ? 'removed' : it.mode === 'upload' ? 'own photo' : it.mode === 'similar' ? 'similar' : it.newHero}`).join('; ')}`
  });
}

/**
 * Creative Edit: one uploaded creative, a list of its elements and what to do with each.
 * instruction = { items: [{ label, kind, action: 'redesign'|'rewrite'|'remove', current, where, prompt, refIndex }], keep: [text] }
 * kind is 'logo' | 'text' | 'subject' | 'background' | 'small-print' | 'graphics' | 'area'. Only the listed elements
 * change; everything the person kept stays exactly as it is. Uploaded reference pictures arrive as `replacement` files.
 */
export async function editCreativeElements(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const source = req.files?.file?.[0];
    const replacements = req.files?.replacement || [];
    if (!source) return res.status(400).json({ error: 'Upload the creative to edit.' });

    let instruction;
    try {
      instruction = JSON.parse(req.body.instruction || '{}');
    } catch {
      return res.status(400).json({ error: 'The edits were sent in an unexpected format.' });
    }
    const keep = (Array.isArray(instruction.keep) ? instruction.keep : []).map((k) => cleanEditText(k, 200)).filter(Boolean).slice(0, 10);
    const items = (Array.isArray(instruction.items) ? instruction.items : []).slice(0, 10).map((it) => ({
      label: cleanEditText(it.label, 60) || 'Element',
      kind: ['logo', 'text', 'subject', 'background', 'small-print', 'graphics', 'area'].includes(it.kind) ? it.kind : 'area',
      action: ['redesign', 'rewrite', 'remove'].includes(it.action) ? it.action : '',
      current: cleanEditText(it.current, 300),
      where: cleanEditText(it.where, 200),
      prompt: cleanEditText(it.prompt, 400),
      refIndex: Number.isInteger(it.refIndex) ? it.refIndex : -1
    })).filter((it) => it.action);
    if (items.length === 0) return res.status(400).json({ error: 'Edit or remove at least one element first.' });

    const extraRefs = [];
    const lines = [];
    for (const it of items) {
      const who = `the ${it.label.toLowerCase()}${it.current ? ` (${it.current})` : ''}${it.where ? `, ${it.where}` : ''}`;
      if (it.action === 'remove') {
        lines.push(it.kind === 'background'
          ? `- Replace ${who} with a plain, clean, softly graded backdrop in a colour that suits the existing palette, keeping every other element exactly where it is.`
          : `- Remove ${who} completely and fill the area it occupied by naturally continuing the surrounding background, so it looks as if it was never there (no empty box, patch, blur or smudge).`);
      } else if (it.action === 'rewrite') {
        if (!it.prompt) return res.status(400).json({ error: `Enter the new text for the ${it.label.toLowerCase()} first.` });
        lines.push(`- Replace the text of ${who} with exactly this text: "${it.prompt}". Draw it in the identical font family, weight, case style, colour, effects, letter-spacing, alignment and position as the text it replaces, shrinking it slightly or wrapping it inside the same area if it is longer. Spell it character for character.`);
      } else {
        const ref = replacements[it.refIndex];
        if (!it.prompt && !ref) return res.status(400).json({ error: `Describe what should change for the ${it.label.toLowerCase()} first.` });
        let line = `- Redesign ${who}${it.prompt ? `: ${it.prompt}` : ''}.`;
        if (ref) {
          extraRefs.push({ filePath: resolveUploadPath(ref.filename), mimeType: ref.mimetype, filename: ref.filename });
          line += ` Use attached image ${extraRefs.length + 1} as the reference for it: reproduce what it shows exactly as it appears there (shape, colours, details, any label or wording), cut cleanly away from that image's own background.`;
        }
        lines.push(line);
      }
    }

    const editPrompt = [
      'Edit the FIRST attached image. This is an ELEMENT-ONLY edit: change ONLY the elements listed below and nothing else.',
      lines.join(' '),
      editTextRules(items.filter((it) => it.action === 'rewrite').map((it) => it.prompt)),
      keep.length ? `These elements are NOT part of this edit and must stay completely unchanged - same look, wording, position, size and colour: ${keep.join('; ')}.` : '',
      'Make every change look naturally part of the original design: match the lighting, colour temperature, shadows, perspective and typography already in the image. Rebuild any background that was hidden behind a changed or removed element so it continues naturally, with no ghosting or leftover outlines.',
      'Everything else must stay exactly as it is in the first image: all other text and its exact spelling, the same logos and badges, the same product and packaging with its labels and wording, the subject(s), background/setting, layout, positions, colours, small print, crop and framing.',
      'Do NOT redraw, restyle, re-compose, move or resize anything that was not listed above, and do not add any new text, watermark, border or decoration. Keep every other pixel as close to identical as possible.'
    ].filter(Boolean).join(' ');

    await runImageEdit({
      req, res, post,
      sourceFile: source,
      extraRefs,
      prompt: editPrompt,
      purpose: 'editing elements of the uploaded creative',
      modInput: `Creative edit: ${items.map((it) => `${it.action} ${it.label}`).join('; ')}`
    });
  } catch (err) {
    next(err);
  }
}

/**
 * "Change Hero Image Only": swaps just the main hero subject of an uploaded
 * creative, either for a described new hero (mode 'describe') or for a photo
 * the person supplies (mode 'upload', second file field "replacement"). The
 * body field `instruction` is JSON: { mode, current, newHero }.
 * Modes: 'describe' (a described hero), 'upload' (the person's own photo) and
 * 'similar' (a different person/subject of the same kind in a similar pose).
 * Everything else - text, logos, background, layout - is told to stay as is.
 */
export async function editHeroImage(req, res, next) {
  try {
    const post = await loadOwnedPost(req);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const source = req.files?.file?.[0];
    const replacement = req.files?.replacement?.[0];
    if (!source) return res.status(400).json({ error: 'Upload the creative to edit.' });

    let instruction;
    try {
      instruction = JSON.parse(req.body.instruction || '{}');
    } catch {
      return res.status(400).json({ error: 'The hero change was sent in an unexpected format.' });
    }
    // Subject Swap sends one entry per subject being replaced, each with its own way of describing the
    // new one; the legacy single-hero body (mode / current / newHero) is still accepted below.
    if (Array.isArray(instruction.items) && instruction.items.length) {
      return editHeroItems({ req, res, post, source, replacements: req.files?.replacement || [], instruction });
    }
    const mode = ['upload', 'similar'].includes(instruction.mode) ? instruction.mode : 'describe';
    const current = cleanEditText(instruction.current, 450) || 'the main hero subject (the product, person or vehicle that is the visual focus)';
    const newHero = cleanEditText(instruction.newHero, 300);
    // Other detected subjects the person left unticked - they must stay exactly as they are.
    const keep = (Array.isArray(instruction.keep) ? instruction.keep : []).map((k) => cleanEditText(k, 200)).filter(Boolean).slice(0, 6);

    if (mode === 'describe' && !newHero) return res.status(400).json({ error: 'Describe the new hero image first.' });
    if (mode === 'upload' && !replacement) return res.status(400).json({ error: 'Upload the photo that should become the hero.' });

    if (mode === 'similar' && !cleanEditText(instruction.current, 450)) {
      return res.status(400).json({ error: 'Say which part of the image is the hero first.' });
    }

    const replaceLine =
      mode === 'similar'
        ? `Replace the hero of the image (${current}) with a DIFFERENT but SIMILAR hero. If the hero is a person, replace them with a different real-looking person of the same gender and a similar age range, with a clearly different face, hairstyle and features, but in the same pose, body position, expression, gaze direction, gestures and camera angle, wearing clothing of a similar style and colour palette. If the hero is an object, vehicle or animal, replace it with another of the same kind in the same arrangement, angle and framing but with different specific details. Keep the same framing, scale and position in the layout. The new hero must not be recognisable as the original person or object, must not resemble any real or famous person, and must look natural in the scene.`
        : mode === 'upload'
        ? `The SECOND attached image is the new hero. Replace the hero of the FIRST image (${current}) with the subject shown in the second image. Reproduce that subject exactly as it appears there - identical shape, proportions, colours and details, and every bit of packaging, label, logo and wording on it exactly as shown, never redrawn, re-lettered or altered. Cut it cleanly away from its own background and do not carry over anything from the second image's backdrop.${newHero ? ` Context: ${newHero}.` : ''}`
        : `Replace the hero of the image (${current}) with this new hero: ${newHero}.`;

    const editPrompt = [
      'Edit the attached image. This is a HERO-IMAGE-ONLY edit: change ONLY the main hero subject and nothing else.',
      replaceLine,
      keep.length ? `These other subjects in the image are NOT part of this edit and must stay completely unchanged - same face, look, pose, clothing, position and size: ${keep.join('; ')}.` : '',
      'Place the new hero in the same position, scale, framing and camera angle as the old hero so it occupies the same area of the layout, and make it look naturally photographed in that scene: match the lighting direction, colour temperature, contact shadows, reflections and perspective. Remove every trace of the old hero (no ghosting, outlines or leftover parts) and rebuild any background that was hidden behind it so it continues naturally.',
      'Everything else must stay exactly as it is in the first image: all text and its exact spelling, the same logos and badges, the background/setting, layout, positions, colours, graphic elements, small print, crop and framing.',
      'Do NOT redraw, restyle, re-compose, move or resize anything other than the hero, and do not add any new text, watermark, border or decoration. Keep every other pixel as close to identical as possible.'
    ]
      .filter(Boolean)
      .join(' ');

    await runImageEdit({
      req,
      res,
      post,
      sourceFile: source,
      extraRefs: mode === 'upload' ? [{ filePath: resolveUploadPath(replacement.filename), mimeType: replacement.mimetype, filename: replacement.filename }] : [],
      prompt: editPrompt,
      purpose: 'changing the hero image on the uploaded creative',
      modInput: `Hero image edit (${mode === 'upload' ? 'own photo' : mode === 'similar' ? 'similar hero, different person' : 'described'}): ${mode === 'upload' ? replacement.originalname : mode === 'similar' ? current : newHero}`
    });
  } catch (err) {
    next(err);
  }
}
