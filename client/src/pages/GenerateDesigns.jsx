import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { Card, CardHead, Btn, AiErrorNotice, ModelPill, Chip, CostTag, SelBadge } from '../components/ui.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import BloomLoader from '../components/BloomLoader.jsx';
import Modal from '../components/Modal.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { startNextFlow } from '../utils/handoff.js';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi, aiApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl, downloadFile } from '../api/client.js';

const fileExt = (url) => (/\.(png|jpe?g|webp)(\?|$)/i.exec(url || '')?.[1] || 'png').toLowerCase();
const fileSlug = (t) => (t || 'creative').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'creative';
import { imageOptionCanvasModifier, previewAspectRatio } from '../utils/mediumAspect.js';
import { isCarouselFormat, getFormat, POST_FORMATS, isSocialPlatform } from '../constants/postFormats.js';
import { GenerationError } from '../components/flow/FlowParts.jsx';
import { newFlowProp } from '../utils/newFlow.js';
import SuggestLink, { SuggestRow, useSuggestUndo } from '../components/SuggestLink.jsx';
import { useLeaveGuard } from '../components/LeaveGuard.jsx';
import PanelArt from '../components/flow/PanelArt.jsx';
import { Rail, RailStage, RailBottom } from '../components/flow/Rail.jsx';
import NextStepCards from '../components/flow/NextStepCards.jsx';
import ICON_EYE from '../assets/size-adapt/icon-eye.svg';
import ICON_DOWN_TILE from '../assets/size-adapt/icon-download-tile.svg';
import '../styles/new-creative.css';
import '../styles/new-creative-flow.css';
import iconSparkleWhite from '../assets/size-adapt/icon-sparkle-white.svg';
import iconArrowWhite from '../assets/size-adapt/icon-arrow-right-white.svg';

// Temporarily hidden: the "Video source" picker. videoMode stays on its default,
// 'animate_kv' (animate the approved image).
const SHOW_VIDEO_SOURCE_PICKER = false;

// Animation ideas: the everyday "what moves" ideas (including how the headline animates)
// are shown by default; camera movement and the finer technical controls live under the
// Advanced tab.
const BASIC_IDEA_CATEGORIES = ['subject', 'text', 'environment', 'light'];

// Icons used on the copy directions step.
function RegenIcon({ size = 16, spinning = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: '0 0 auto', ...(spinning ? { animation: 'spin 0.9s linear infinite' } : {}) }}
    >
      <path d="M20 11a8 8 0 0 0-14.3-4.6L4 8" />
      <path d="M4 3.5V8h4.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.6L20 16" />
      <path d="M20 20.5V16h-4.5" />
    </svg>
  );
}

function PencilIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

const ICON_BTN_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: 32,
  height: 32,
  padding: 0,
  borderRadius: 999,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  flex: '0 0 auto'
};

// One headline / sub-headline line on a copy direction: read-only text with a pencil;
// the input only appears after tapping the pencil. `onRegenerate` adds the regenerate icon.
function EditableLine({ title, value, loading, loadingText, emptyText, editing, setEditing, onChange, placeholder, strong, onRegenerate, regenTitle }) {
  return (
    <div style={{ marginTop: 10 }}>
      <p className="hint" style={{ marginBottom: 4 }}>{title}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {editing ? (
          <input
            type="text"
            autoFocus
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <p style={{ flex: 1, minWidth: 0, margin: 0, fontWeight: strong ? 600 : 400, lineHeight: 1.35 }}>
            {loading ? <span className="hint" style={{ fontWeight: 400 }}>{loadingText}</span> : value || <span className="hint" style={{ fontWeight: 400 }}>{emptyText}</span>}
          </p>
        )}
        <button
          type="button"
          style={ICON_BTN_STYLE}
          title={`Edit ${title.toLowerCase()}`}
          aria-label={`Edit ${title.toLowerCase()}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEditing(!editing)}
        >
          <PencilIcon />
        </button>
        {onRegenerate && (
          <button
            type="button"
            style={{ ...ICON_BTN_STYLE, opacity: loading ? 0.7 : 1 }}
            title={regenTitle}
            aria-label={regenTitle}
            disabled={loading}
            onClick={onRegenerate}
          >
            <RegenIcon spinning={loading} />
          </button>
        )}
      </div>
    </div>
  );
}

const optionsWord = (n) => (n === 1 ? 'a new design' : `${n} new design options`);

export default function GenerateDesigns() {
  const navigate = useNavigate();
  const location = useLocation();
  const { post, setPost } = useWorkflow();
  const { isAgency, features } = useAuth(); // the image brief editor is for agency admins only
  // Design options per creative (1, 2 or 3): a per-customer setting the agency chooses on the customer. The server makes the same number.
  const DESIGN_OPTION_COUNT = features?.designOptions || 1;
  const { open: openLightbox } = useLightbox();
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [headlineOptions, setHeadlineOptions] = useState([]);
  const [subOptions, setSubOptions] = useState([]);
  const [seenSubs, setSeenSubs] = useState([]);
  const [loadingSubOptions, setLoadingSubOptions] = useState(false);
  const [seenHeadlines, setSeenHeadlines] = useState([]); // everything already offered, never repeated
  const [loadingHeadlineOptions, setLoadingHeadlineOptions] = useState(false);

  async function downloadImage(key, url, name) {
    setDownloadingKey(key);
    try {
      await downloadFile(resolveAssetUrl(url), name);
    } catch {
      window.open(resolveAssetUrl(url), '_blank', 'noopener');
    } finally {
      setDownloadingKey(null);
    }
  }
  const [loadingCopy, setLoadingCopy] = useState(false);
  const [error, setError] = useState('');
  const [copiedCopy, setCopiedCopy] = useState(false);
  const POST_COPY_MAX = 2200;
  const [postPop, setPostPop] = useState(null); // last screen: position of the post copy popover, null = closed
  const postBtnRef = useRef(null);
  const postPopRef = useRef(null);
  useEffect(() => {
    if (!postPop) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setPostPop(null); postBtnRef.current?.focus(); } };
    const onDown = (e) => { if (!postPopRef.current?.contains(e.target) && !postBtnRef.current?.contains(e.target)) setPostPop(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [postPop]);
  function togglePostPop() {
    if (postPop) { setPostPop(null); return; }
    const r = postBtnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPostPop({ left: Math.max(12, Math.min(r.left, window.innerWidth - 532)), bottom: window.innerHeight - r.top + 10 });
  }
  useLeaveGuard(Boolean(post?._id));
  async function copyPostCopy() {
    const d = chosenDesign();
    const text = (d ? draftCaptions[d.label] ?? d.caption : '') || '';
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopiedCopy(true); setTimeout(() => setCopiedCopy(false), 1500); } catch { /* clipboard blocked */ }
  }
  // Fine-tune: open Creative Edit with the chosen image already added (no second upload).
  async function fineTuneChosen() {
    const url = chosenDesign()?.imageUrl;
    if (!url) { setImageRequiredPrompt('finetune'); return; }
    try { await startNextFlow(navigate, 'edit', url); } catch { setError({ message: 'We couldn’t open this image in Creative Edit. Please try again.' }); }
  }
  function chosenDesign() { return post?.designs?.find((d) => d.label === chosenLabel); }
  async function downloadAll() {
    const opts = (chosenDesign()?.imageOptions || []).filter((o) => o.imageUrl);
    setDownloadingKey('all');
    try {
      for (let i = 0; i < opts.length; i += 1) {
        await downloadFile(resolveAssetUrl(opts[i].imageUrl), `${fileSlug(post.purpose)}-option-${i + 1}.${fileExt(opts[i].imageUrl)}`);
      }
    } catch { /* individual downloads report nothing; the buttons on each option still work */ } finally { setDownloadingKey(null); }
  }

  // PHASE 1 = copy grid (chosenLabel is null). PHASE 2 = 3 image options for
  // one chosen direction. Only becomes non-null once the user deliberately
  // picks a direction (or when returning to a post that already progressed
  // that far) - post.selectedVariantLabel alone isn't a strong enough
  // signal, since generateDesigns defaults it to the first direction.
  const [chosenLabel, setChosenLabel] = useState(() => {
    // The step bar's "Creative directions" link lands here with { directions: true }: show the directions, not the images.
    if (location.state?.directions || location.state?.messaging) return null;
    const advanced = post?.designs?.find((d) => d.imageOptions?.length > 0 || d.imageUrl);
    return advanced?.label || null;
  });

  const [copyLoading, setCopyLoading] = useState({});
  // The direction being written up on the Messaging screen (null = the Creative directions screen is showing).
  const [msgLabel, setMsgLabel] = useState(() => {
    if (!location.state?.messaging) return null;
    const real = (post?.designs || []).filter((d) => d.label !== 'Preview');
    return real.find((d) => d.label === post?.selectedVariantLabel)?.label || real[0]?.label || null;
  });
  const [renderPost, setRenderPost] = useState(true); // "Include post copy" on the Messaging screen
  const [pickedLabel, setPickedLabel] = useState(null); // the direction highlighted on the Creative directions screen
  const [draftCaptions, setDraftCaptions] = useState({});
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [followBrand, setFollowBrand] = useState(true); // 'Follow Brand Assets & Guidelines' checkbox
  const [carouselLoading, setCarouselLoading] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(undefined);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [selectingIndex, setSelectingIndex] = useState(null);

  // Reference creative upload (Step 02, phase 2)
  const fileInputRef = useRef(null);
  const [referenceMode, setReferenceMode] = useState('include');
  const [uploadingReference, setUploadingReference] = useState(false);

  // Typography (Step 02, phase 2) - headline only makes sense once real
  // copy exists, so it's suggested here, not typed blind back on Step 01.
  const [draftHeadline, setDraftHeadline] = useState(undefined);
  const [generatingHeadline, setGeneratingHeadline] = useState(false);
  const [savingTypography, setSavingTypography] = useState(false);

  // Phase 1 (copy directions): each direction shows its own headline, and
  // "Render headline in creative" lives here, on by default. The picked
  // direction's headline is saved to the brief in chooseDirection.
  const [renderHeadline, setRenderHeadline] = useState(post?.creativeBrief?.includeTypography ?? true);
  const [headlineByLabel, setHeadlineByLabel] = useState({});
  // Undo for the Suggest / Improve links on a direction: headline, sub-headline and post copy.
  const undoHeadline = useSuggestUndo();
  const undoSub = useSuggestUndo();
  const undoCopy = useSuggestUndo();
  const [copyOptions, setCopyOptions] = useState({}); // label -> up to 3 improved versions of the typed post copy
  const [subByLabel, setSubByLabel] = useState({});
  // Sub-headline is on by default and can be switched off.
  const [renderSub, setRenderSub] = useState(post?.creativeBrief?.includeSubHeadline ?? true);
  const [editingLine, setEditingLine] = useState({}); // `${label}:headline|sub` -> input open
  const [headlineLoadingByLabel, setHeadlineLoadingByLabel] = useState({});
  const headlineRequested = useRef(new Set());

  // Video generation (Step 02, phase 2) - async job with polling, unlike
  // the synchronous image calls elsewhere on this page.
  const [generatingVideo, setGeneratingVideo] = useState(false);
  // 'suggest' | 'generate' | null - set when the person tries animation ideas / video before picking an image.
  const [imageRequiredPrompt, setImageRequiredPrompt] = useState(null);
  const [videoMode, setVideoMode] = useState('animate_kv'); // animate_kv | new_scene
  const [motionStyle, setMotionStyle] = useState('ambient'); // ambient | zoom_in | zoom_out | pan
  // "Animation ideas" step - the AI lists what could be animated for the
  // chosen image + copy direction, the person ticks what they want, and those
  // picks drive the video prompt instead of a single preset motion style.
  const [videoIdeas, setVideoIdeas] = useState([]);
  const [videoIdeaCategories, setVideoIdeaCategories] = useState([]);
  const [videoIdeasKey, setVideoIdeasKey] = useState(''); // `${label}|${imageUrl}` the ideas were generated for
  const [selectedIdeaIds, setSelectedIdeaIds] = useState(new Set());
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [bestCombo, setBestCombo] = useState({ ids: [], rationale: '' }); // AI's recommended mix of the ideas above
  const [customVideoDirection, setCustomVideoDirection] = useState('');
  const [ideaTab, setIdeaTab] = useState('basic'); // basic | advanced
  // Hand-edited video prompt (null = not edited -> the server builds it from the picks above)
  const [videoPromptDraft, setVideoPromptDraft] = useState(null);
  const [videoFeedback, setVideoFeedback] = useState('');
  const [carryFeedback, setCarryFeedback] = useState(true);
  const [showVideoPromptEditor, setShowVideoPromptEditor] = useState(false);
  const VIDEO_FORMATS = POST_FORMATS.filter((f) => f.isVideo);
  const VIDEO_PLATFORMS = [...new Set(VIDEO_FORMATS.map((f) => f.platform))];
  const [videoFormatId, setVideoFormatId] = useState(() => {
    const primary = post?.mediums?.[0];
    if (VIDEO_FORMATS.some((f) => f.id === primary)) return primary;
    return VIDEO_FORMATS[0]?.id;
  });
  const videoFormatPlatform = getFormat(videoFormatId).platform;
  const pollTimeoutRef = useRef(null);

  // Keep the animation-idea picker (suggestions, ticks, tab, notes) when the person leaves this page and comes back.
  // Stored per post in sessionStorage; the ideas are only shown again if they still match the chosen direction + image.
  const ideasStoreKey = post?._id ? `automatr:videoIdeas:${post._id}` : null;
  const ideasRestoredFor = useRef(null);
  useEffect(() => {
    if (!ideasStoreKey || ideasRestoredFor.current === ideasStoreKey) return;
    ideasRestoredFor.current = ideasStoreKey;
    try {
      const saved = JSON.parse(sessionStorage.getItem(ideasStoreKey) || 'null');
      if (!saved || !Array.isArray(saved.ideas)) return;
      setVideoIdeas(saved.ideas);
      setVideoIdeaCategories(saved.categories || []);
      setVideoIdeasKey(saved.key || '');
      setBestCombo(saved.bestCombo || { ids: [], rationale: '' });
      setSelectedIdeaIds(new Set(saved.selected || []));
      setIdeaTab(saved.tab === 'advanced' ? 'advanced' : 'basic');
      setCustomVideoDirection(saved.custom || '');
    } catch {
      /* storage unavailable or corrupt - start fresh */
    }
  }, [ideasStoreKey]);
  useEffect(() => {
    if (!ideasStoreKey || ideasRestoredFor.current !== ideasStoreKey) return;
    try {
      if (videoIdeas.length === 0 && !customVideoDirection) return; // nothing to keep (and don't wipe a save before it is restored)
      sessionStorage.setItem(ideasStoreKey, JSON.stringify({
        key: videoIdeasKey,
        ideas: videoIdeas,
        categories: videoIdeaCategories,
        bestCombo,
        selected: [...selectedIdeaIds],
        tab: ideaTab,
        custom: customVideoDirection
      }));
    } catch {
      /* quota or private mode - ignore */
    }
  }, [ideasStoreKey, videoIdeas, videoIdeaCategories, videoIdeasKey, bestCombo, selectedIdeaIds, ideaTab, customVideoDirection]);

  // Tracks which post id we've already kicked off generation for, so React
  // 18 StrictMode's intentional double-invoke of effects in dev (and any
  // other re-render) can't fire the same long-running request twice.
  const generatingForId = useRef(null);

  const [costs, setCosts] = useState(null); // GET /ai/cost-estimates - see CostTag usages below
  useEffect(() => {
    aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null));
  }, []);

  useEffect(() => {
    if (!post) {
      navigate('/generate');
      return;
    }
    const hasFullSet = post.designs?.length > 1;
    if (!hasFullSet && generatingForId.current !== post._id) {
      generatingForId.current = post._id;
      setLoadingCopy(true);
      postsApi
        .generateDesigns(post._id, { textModel: 'auto' })
        .then(({ post: updated }) => setPost(updated))
        .catch((e) => setError(apiErrorInfo(e)))
        .finally(() => setLoadingCopy(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?._id]);

  async function loadHeadlineFor(label) {
    setHeadlineLoadingByLabel((s) => ({ ...s, [label]: true }));
    try {
      const { headline, subheadline } = await postsApi.generateHeadline(post._id, label, { withSubheadline: true });
      if (headline) setHeadlineByLabel((s) => ({ ...s, [label]: headline }));
      if (subheadline) setSubByLabel((s) => ({ ...s, [label]: subheadline }));
    } catch {
      /* non-fatal - the field stays editable and can be regenerated */
    } finally {
      setHeadlineLoadingByLabel((s) => ({ ...s, [label]: false }));
    }
  }

  // The Messaging screen drafts a headline and sub-headline for the direction picked on the previous screen.
  useEffect(() => {
    if (!post || !msgLabel || chosenLabel || loadingCopy) return;
    const d = (post.designs || []).find((x) => x.label === msgLabel);
    if (!d?.caption) return;
    const key = `${post._id}:${msgLabel}`;
    if (headlineRequested.current.has(key)) return;
    headlineRequested.current.add(key);
    loadHeadlineFor(msgLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?._id, post?.designs?.length, msgLabel, chosenLabel, loadingCopy]);

  if (!post) return null;

  const realDesigns = post.designs?.filter((d) => d.label !== 'Preview') || [];
  const chosen = realDesigns.find((d) => d.label === chosenLabel);
  const canvasModifier = imageOptionCanvasModifier(post.mediums?.[0]);
  const canvasRatio = previewAspectRatio(post.mediums?.[0]);

  function captionFor(d) {
    return draftCaptions[d.label] ?? d.caption;
  }

  async function saveCaptionEdit(label) {
    const value = draftCaptions[label];
    if (value === undefined) return;
    try {
      const { post: updated } = await postsApi.updateVariant(post._id, label, { caption: value });
      setPost(updated);
    } catch (e) {
      setError(apiErrorInfo(e));
    }
  }

  // Improve (post copy already typed): three improved versions to pick from. Suggest (empty box) still writes fresh copy via regenerateCopy.
  async function improveCopy(label) {
    const text = (draftCaptions[label] ?? post?.designs?.find((x) => x.label === label)?.caption ?? '').trim();
    if (!text) return regenerateCopy(label);
    setCopyLoading((s) => ({ ...s, [label]: true }));
    setError('');
    try {
      const { options } = await postsApi.improveCaptionOptions(post._id, label, { caption: text });
      setCopyOptions((s) => ({ ...s, [label]: options || [] }));
      if (!(options || []).length) setError('Could not find a better version this time. Please try again.');
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setCopyLoading((s) => ({ ...s, [label]: false }));
    }
  }

  async function pickCopyOption(label, text) {
    const before = draftCaptions[label] ?? post?.designs?.find((x) => x.label === label)?.caption ?? '';
    try {
      const { post: updated } = await postsApi.updateVariant(post._id, label, { caption: text });
      setPost(updated);
      setDraftCaptions((s) => ({ ...s, [label]: undefined }));
      setCopyOptions((s) => ({ ...s, [label]: [] }));
      undoCopy.remember(async () => {
        try {
          const { post: restored } = await postsApi.updateVariant(post._id, label, { caption: before });
          setPost(restored);
          setDraftCaptions((s) => ({ ...s, [label]: undefined }));
        } catch (e) {
          setError(apiErrorInfo(e));
        }
      });
    } catch (e) {
      setError(apiErrorInfo(e));
    }
  }

  async function regenerateCopy(label) {
    setCopyLoading((s) => ({ ...s, [label]: true }));
    setError('');
    const before = draftCaptions[label] ?? post?.designs?.find((x) => x.label === label)?.caption ?? '';
    try {
      const { post: updated } = await postsApi.regenerateVariant(post._id, label, { textModel: 'auto' });
      setPost(updated);
      setDraftCaptions((s) => ({ ...s, [label]: undefined }));
      // Undo puts the previous post copy back, and saves it, so the regenerated text is not kept.
      undoCopy.remember(async () => {
        try {
          const { post: restored } = await postsApi.updateVariant(post._id, label, { caption: before });
          setPost(restored);
          setDraftCaptions((s) => ({ ...s, [label]: undefined }));
        } catch (e) {
          setError(apiErrorInfo(e));
        }
      });
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setCopyLoading((s) => ({ ...s, [label]: false }));
    }
  }

  async function chooseDirection(label) {
    setError('');
    setChosenLabel(label);
    setShowPromptEditor(false);
    setDraftPrompt(undefined);
    try {
      let { post: updated } = await postsApi.selectVariant(post._id, label);

      // Save the toggle and this direction's headline (if any) to the brief.
      if (post?.creativeType !== 'adaptation') {
        try {
          const chosenHeadline = renderHeadline ? (headlineByLabel[label] || '') : '';
          const chosenSub = renderHeadline && renderSub ? (subByLabel[label] || '') : '';
          const { post: withTypo } = await postsApi.updateCreativeBrief(post._id, {
            includeTypography: renderHeadline,
            headlineText: chosenHeadline,
            includeSubHeadline: renderSub,
            subHeadlineText: chosenSub
          });
          updated = withTypo;
        } catch {
          // Non-fatal - the auto-generate fallback below still applies.
        }
      }

      // Typography was opted into on Step 01, but there's no headline yet
      // since it's never typed manually - auto-generate one from the now-
      // chosen copy so it's ready before the first image generation, no
      // extra click required.
      if (updated.creativeBrief?.includeTypography && !updated.creativeBrief?.headlineText) {
        try {
          const { headline } = await postsApi.generateHeadline(post._id, label, {});
          if (headline) {
            const { post: withHeadline } = await postsApi.updateCreativeBrief(post._id, { headlineText: headline });
            updated = withHeadline;
          }
        } catch {
          // Non-fatal - proceed without a headline rather than blocking the flow.
        }
      }

      setPost(updated);
      const variant = updated.designs.find((d) => d.label === label);
      if (getFormat(post.mediums?.[0]).isVideo) {
        // Video formats have no still image to option/carousel-generate -
        // the "Generate video" action further down is the actual next step,
        // and it already has everything it needs (imagePrompt/caption).
      } else if (isCarouselFormat(post.mediums?.[0])) {
        if (!variant?.carouselSlides?.length) await generateCarousel(label);
      } else if (!variant?.imageOptions?.length) {
        // Typography and Reference creatives were already set in Step 01, so design options start
        // generating straight away - no extra "Generate Design Options" click.
        await generateOptions(label);
      }
    } catch (e) {
      setError(apiErrorInfo(e));
    }
  }

  // "Regenerate designs": each regenerate of a design gets a higher round, so the server picks a different approach and framing
  // than the earlier sets instead of re-rolling the same brief. Round 0 = the first set.
  const regenRounds = useRef({});
  async function generateOptions(label, promptOverride) {
    setOptionsLoading(true);
    setError('');
    const hadImages = (post?.designs?.find((d) => d.label === label)?.imageOptions || []).some((o) => o?.imageUrl);
    const round = hadImages ? (regenRounds.current[label] ?? Math.floor(Math.random() * 900) + 1) + 1 : 0; // random start after a reload, so a repeat is unlikely
    regenRounds.current[label] = round;
    try {
      const initPayload = promptOverride ? { imagePrompt: promptOverride } : {};
      const { post: initialized, count } = await postsApi.initImageOptions(post._id, label, initPayload);
      // Placeholders land immediately - the grid can render all 3 "generating…"
      // slots right away instead of staying blank through the round trip below.
      setPost(initialized);
      setDraftPrompt(undefined);
      // The grid itself (with 3 per-card spinners, driven by imageModel
      // === 'pending' below) should show now - NOT once every option has
      // actually finished generating, which would defeat the whole point
      // of writing placeholders first.
      setOptionsLoading(false);

      // Fired in parallel and each handled independently (not Promise.all
      // gating a single combined update) so whichever option finishes first
      // shows up first, instead of the whole grid waiting on the slowest one.
      await Promise.all(
        Array.from({ length: count || DESIGN_OPTION_COUNT }, (_, i) =>
          postsApi
            .generateImageOption(post._id, label, i, { imageModel: 'auto', followBrand, round })
            .then(({ option, index }) => {
              setPost((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  designs: prev.designs.map((d) => {
                    if (d.label !== label) return d;
                    const imageOptions = [...(d.imageOptions || [])];
                    imageOptions[index] = option;
                    return { ...d, imageOptions };
                  })
                };
              });
            })
            .catch((e) => {
              // Leave the other options generating - one slot failing
              // shouldn't block the two that might still succeed.
              const info = apiErrorInfo(e);
              setPost((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  designs: prev.designs.map((d) => {
                    if (d.label !== label) return d;
                    const imageOptions = [...(d.imageOptions || [])];
                    if (imageOptions[i]) {
                      imageOptions[i] = {
                        ...imageOptions[i],
                        imageModel: 'placeholder',
                        imageNote: info.message,
                        imageBillingUrl: info.isBillingError ? info.billingUrl : '',
                        imageBillingProviderLabel: info.isBillingError ? info.billingProviderLabel : ''
                      };
                    }
                    return { ...d, imageOptions };
                  })
                };
              });
            })
        )
      );
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setOptionsLoading(false);
    }
  }

  async function generateCarousel(label, promptOverride) {
    setCarouselLoading(true);
    setError('');
    try {
      const payload = {
        imageModel: 'auto',
        followBrand,
        slideCount: post.creativeBrief?.slideCount || 5,
        ...(promptOverride ? { imagePrompt: promptOverride } : {})
      };
      const { post: updated } = await postsApi.generateCarousel(post._id, label, payload);
      setPost(updated);
      setDraftPrompt(undefined);
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setCarouselLoading(false);
    }
  }

  async function pickOption(label, index) {
    setSelectingIndex(index);
    setError('');
    try {
      const { post: updated } = await postsApi.selectImageOption(post._id, label, index);
      setPost(updated);
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setSelectingIndex(null);
    }
  }

  async function handleReferenceFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingReference(true);
    setError('');
    try {
      const mode = referenceMode === 'style' ? 'style' : 'include';
      const exact = referenceMode === 'exact';
      const { post: updated } = await postsApi.uploadReference(post._id, file, mode, exact);
      setPost(updated);
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setUploadingReference(false);
    }
  }

  async function removeReference(filename) {
    try {
      const { post: updated } = await postsApi.removeReference(post._id, filename);
      setPost(updated);
    } catch (e) {
      setError(apiErrorInfo(e));
    }
  }

  async function toggleTypography(value) {
    setSavingTypography(true);
    setError('');
    try {
      const { post: updated } = await postsApi.updateCreativeBrief(post._id, { includeTypography: value });
      setPost(updated);
      if (value && !updated.creativeBrief?.headlineText && chosen?.caption) {
        await suggestHeadline();
      }
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setSavingTypography(false);
    }
  }

  async function saveHeadlineEdit() {
    if (draftHeadline === undefined) return;
    try {
      const { post: updated } = await postsApi.updateCreativeBrief(post._id, { headlineText: draftHeadline });
      setPost(updated);
    } catch (e) {
      setError(apiErrorInfo(e));
    }
  }

  useEffect(() => {
    setHeadlineOptions([]);
    setSeenHeadlines([]); setSubOptions([]); setSeenSubs([]);
  }, [chosenLabel, chosen?.imageUrl]);

  async function suggestHeadlineOptions() {
    setLoadingHeadlineOptions(true);
    setError('');
    try {
      const label = chosenLabel || msgLabel;
      const typed = (headlineByLabel[label] ?? '').trim();
      // Text typed in the box = Improve (3 better versions of it); empty box = Suggest (ideas from what the creative shows and says).
      const { options } = await postsApi.generateHeadlineOptions(post._id, label, { exclude: seenHeadlines, ...(typed ? { improve: true, current: typed } : {}) });
      setHeadlineOptions(options || []);
      setSeenHeadlines((prev) => [...prev, ...(options || [])]);
      if (typed && !(options || []).length) setError('Could not find a better version this time. Please try again.');
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setLoadingHeadlineOptions(false);
    }
  }

  async function pickHeadline(text) {
    setDraftHeadline(text);
    try {
      const { post: updated } = await postsApi.updateCreativeBrief(post._id, { includeTypography: true, headlineText: text });
      setPost(updated);
      setDraftHeadline(undefined);
    } catch (e) {
      setError(apiErrorInfo(e));
    }
  }

  async function suggestHeadline() {
    setGeneratingHeadline(true);
    setError('');
    try {
      const { headline } = await postsApi.generateHeadline(post._id, chosenLabel, {});
      const { post: updated } = await postsApi.updateCreativeBrief(post._id, { includeTypography: true, headlineText: headline });
      setPost(updated);
      setDraftHeadline(undefined);
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setGeneratingHeadline(false);
    }
  }

  // Video generation typically takes 1-3+ minutes, so this polls every 6s
  // rather than blocking on one long request (which would time out).
  function pollVideoStatus(label, jobId) {
    pollTimeoutRef.current = setTimeout(async () => {
      try {
        const { post: updated, job } = await postsApi.getVideoStatus(post._id, label, jobId);
        setPost(updated);
        if (job.status === 'processing' || job.status === 'pending') {
          pollVideoStatus(label, jobId);
        } else {
          setGeneratingVideo(false);
        }
      } catch (e) {
        setError(apiErrorInfo(e));
        setGeneratingVideo(false);
      }
    }, 6000);
  }

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  // Image formats animate the approved still, so one must be picked first.
  // Video-only and carousel formats have no single still to pick.
  function isImageMissing() {
    const fmtId = post.mediums?.[0];
    return !chosen?.imageUrl && !getFormat(fmtId).isVideo && !isCarouselFormat(fmtId);
  }

  function goToImageOptions() {
    setImageRequiredPrompt(null);
    setTimeout(() => {
      document.querySelector('.image-option-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  async function handleSuggestIdeas() {
    if (isImageMissing()) {
      setImageRequiredPrompt('suggest');
      return;
    }
    setIdeasLoading(true);
    setError('');
    try {
      const chosenNow = post.designs.find((d) => d.label === chosenLabel);
      const { ideas, categories, bestCombination } = await postsApi.suggestVideoIdeas(post._id, chosenLabel, { formatId: videoFormatId });
      setBestCombo(bestCombination || { ids: [], rationale: '' });
      setVideoIdeas(ideas);
      setVideoIdeaCategories(categories);
      setVideoIdeasKey(`${chosenLabel}|${chosenNow?.imageUrl || ''}`);
      setSelectedIdeaIds(new Set());
      setIdeaTab('basic');
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setIdeasLoading(false);
    }
  }

  function applyBestCombination() {
    setSelectedIdeaIds(new Set(bestCombo.ids));
  }

  // Camera moves are alternatives (one per video); everything else combines.
  function toggleVideoIdea(idea) {
    setSelectedIdeaIds((prev) => {
      const next = new Set(prev);
      if (next.has(idea.id)) {
        next.delete(idea.id);
        return next;
      }
      if (idea.category === 'camera') {
        videoIdeas.filter((i) => i.category === 'camera').forEach((i) => next.delete(i.id));
      }
      next.add(idea.id);
      return next;
    });
  }

  async function handleGenerateVideo() {
    if (isImageMissing()) {
      setImageRequiredPrompt('generate');
      return;
    }
    setGeneratingVideo(true);
    setError('');
    try {
      const chosenNow = post.designs.find((d) => d.label === chosenLabel);
      const ideasCurrent = videoIdeasKey === `${chosenLabel}|${chosenNow?.imageUrl || ''}`;
      const selectedIdeas = ideasCurrent
        ? videoIdeas.filter((i) => selectedIdeaIds.has(i.id)).map((i) => ({ category: i.category, title: i.title, videoPrompt: i.videoPrompt }))
        : [];
      const { post: updated, job } = await postsApi.generateVideo(post._id, chosenLabel, {
        mode: videoMode,
        motionStyle,
        formatId: videoFormatId,
        selectedIdeas,
        customDirection: customVideoDirection,
        ...(videoFeedback.trim() ? { feedback: videoFeedback.trim() } : {}),
        carryFeedback,
        ...(videoPromptDraft !== null && videoPromptDraft.trim() ? { promptOverride: videoPromptDraft.trim() } : {})
      });
      setPost(updated);
      setVideoPromptDraft(null);
      setVideoFeedback('');
      setShowVideoPromptEditor(false);
      pollVideoStatus(chosenLabel, job.externalJobId);
    } catch (e) {
      setError(apiErrorInfo(e));
      setGeneratingVideo(false);
    }
  }

  function handleContinue() {
    // Creative Adaptation is one direction, straight through - Refine
    // (comparing several directions) has nothing to do once there's only
    // ever one, so skip straight to Publish. See Stepper.jsx's matching
    // ADAPTATION_STEPS.
    navigate(post?.creativeType === 'adaptation' ? '/publish' : '/refine');
  }

  // -------------------------------------------------------------------
  // PHASE 1 - copy directions grid
  // -------------------------------------------------------------------
  const newFlow = post?.creativeType !== 'adaptation';
  const social = isSocialPlatform(getFormat(post?.mediums?.[0]).platform);
  // Step bar links: the brief screens live on /generate, "Creative directions" is this screen.
  // Every step stays reachable once it has something to show: the image step as soon as a direction has image options,
  const advancedDesign = post?.designs?.find((d) => d.imageOptions?.length > 0 || d.imageUrl);
  const selectedDesign = post?.designs?.find((d) => d.label === post.selectedVariantLabel);
  const stepLinks = {
    onStep: (key) => {
      if (key === 'directions') { setChosenLabel(null); setMsgLabel(null); return; }
      if (key === 'messaging') {
        const l = chosenLabel || msgLabel || pickedLabel || post?.selectedVariantLabel || realDesigns[0]?.label;
        if (l) { setChosenLabel(null); setMsgLabel(l); }
        return;
      }
      if (key === 'download') { if (advancedDesign) setChosenLabel(advancedDesign.label); return; }
      navigate('/generate', { state: { briefStep: key } });
    },
    reachable: ['purpose', 'visual', 'directions', ...(realDesigns.length ? ['messaging'] : []), ...(advancedDesign ? ['download'] : [])]
  };

  // Card text for a direction, drawn from its copy: the first sentence is the idea, the rest says what it sounds like.
  function directionParts(d) {
    // Newer directions carry their own concept name and idea; the post copy is shown as a short sample line.
    if (d.directionTitle) {
      const copy = String(d.caption || '').replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
      return { title: d.directionTitle, desc: d.directionIdea || '', sample: copy.length > 150 ? `${copy.slice(0, 149).replace(/[,;:\s]+\S*$/, '').trim()}…` : copy };
    }
    const text = String(d.caption || '').replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
    const m = text.match(/^[^.!?]+[.!?]?/);
    const first = (m ? m[0] : text).trim();
    const rest = text.slice(first.length).trim();
    const clip = (t, n) => (t.length <= n ? t : `${t.slice(0, n - 1).replace(/[,;:\s]+\S*$/, '').trim()}…`);
    return { title: clip(first, 90) || d.label, desc: clip(rest || '', 190) };
  }

  // -------------------------------------------------------------------
  // Screen 3 - Creative directions: a full page of direction cards
  // -------------------------------------------------------------------
  if (!chosenLabel && !msgLabel) {
    const picked = realDesigns.find((d) => d.label === pickedLabel) || null;
    const onContinue = () => {
      if (!picked) return;
      if (newFlow) setMsgLabel(picked.label);
      else chooseDirection(picked.label);
    };
    return (
      <Layout eyebrow="Step 02" title="Generate Designs" step={newFlow ? 'directions' : 'designs'} flow={newFlowProp(post)} {...(newFlow ? stepLinks : {})}>
        <div className="dirpage">
          <div className="dirpage__head">
            <p className="sa-kicker">03 / Creative directions</p>
            <h2 className="sa-heading">Choose a creative direction</h2>
            <p className="ncf-lede">
              {loadingCopy
                ? 'Writing your creative directions from everything you have told us…'
                : `Based on everything you have told us, here ${realDesigns.length === 1 ? 'is one direction' : `are ${realDesigns.length || 'several'} directions`}. Pick the one you like.${newFlow ? ' You will write the final headline and post copy on the next screen.' : ''}`}
            </p>
          </div>

          <AiErrorNotice error={error} />
          {loadingCopy && <div className="ncf-loading"><LoadingSpinner label="Generating creative directions…" /></div>}

          {!loadingCopy && (
            <div className="ncf-directions ncf-directions--page" role="radiogroup" aria-label="Creative directions">
              {realDesigns.map((d, i) => {
                const on = pickedLabel === d.label;
                const { title, desc, sample } = directionParts(d);
                return (
                  <div
                    key={d.label}
                    className={`ncf-direction ${on ? 'is-on' : ''}`.trim()}
                    role="radio"
                    aria-checked={on}
                    tabIndex={on || (!pickedLabel && i === 0) ? 0 : -1}
                    onClick={() => setPickedLabel(d.label)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPickedLabel(d.label); return; }
                      const k = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
                      if (!k) return;
                      e.preventDefault();
                      const j = (i + k + realDesigns.length) % realDesigns.length;
                      setPickedLabel(realDesigns[j].label);
                      e.currentTarget.parentElement?.children[j]?.focus();
                    }}
                  >
                    <div className="ncf-direction__top">
                      <span className="ncf-direction__num">{String(i + 1).padStart(2, '0')}</span>
                      <p className="ncf-direction__headline">{title}</p>
                      <span className="ncf-direction__tick" aria-hidden="true" />
                    </div>
                    {desc && <p className="ncf-direction__desc">{desc}</p>}
                    {sample && <p className="ncf-direction__sample"><span>Sample copy</span> {sample}</p>}
                    <div className="ncf-direction__foot">
                      <span className="ncf-direction__name">{d.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="dirpage__foot">
            <p className="ncf-hint" aria-live="polite">{loadingCopy ? '' : picked ? 'Looking good. Click Continue.' : 'Choose a direction to continue.'}</p>
            <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!picked || loadingCopy} onClick={onContinue}>
              <span>Continue</span><img src={iconArrowWhite} alt="" />
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // -------------------------------------------------------------------
  // Screen 4 - Messaging: headline, sub-headline and post copy for the chosen direction
  // -------------------------------------------------------------------
  if (!chosenLabel && msgLabel) {
    const d = realDesigns.find((x) => x.label === msgLabel);
    const fmt = getFormat(post.mediums?.[0]);
    const rr = String(fmt.ratio || '').split(':').map(Number);
    const ar = rr.length === 2 && rr[0] > 0 && rr[1] > 0 ? rr[0] / rr[1] : 1;
    const hl = headlineByLabel[msgLabel] ?? '';
    const sb = subByLabel[msgLabel] ?? '';
    const hLoading = Boolean(headlineLoadingByLabel[msgLabel]);
    const dirTitle = d ? directionParts(d).title : msgLabel;
    const brief = post?.creativeBrief || {};
    const canGo = Boolean(d) && !hLoading && (!renderHeadline || hl.trim().length > 0);
    const showSubInFrame = renderHeadline && renderSub && sb.trim();
    const Switch = ({ on, onToggle, label }) => (
      <button type="button" className="ncf-switch" role="switch" aria-checked={on} onClick={onToggle}>
        <span className="ncf-switch__track"><span className="ncf-switch__knob" /></span>
        <span>{label}</span>
      </button>
    );
    async function suggestSub() {
      setLoadingSubOptions(true);
      setError('');
      try {
        const { options } = await postsApi.generateHeadlineOptions(post._id, msgLabel, { kind: 'sub', headline: hl, current: sb, exclude: seenSubs, ...(sb.trim() ? { improve: true } : {}) });
        setSubOptions(options || []);
        setSeenSubs((prev) => [...prev, ...(options || [])]);
        if (sb.trim() && !(options || []).length) setError('Could not find a better version this time. Please try again.');
      } catch (e) {
        setError(apiErrorInfo(e));
      } finally {
        setLoadingSubOptions(false);
      }
    }
    return (
      <Layout rail eyebrow="Step 02" title="Generate Designs" step="messaging" flow={newFlowProp(post)} {...stepLinks}>
        <div className="rail">
          <div className="rail__stage" role="img" aria-label={hl && renderHeadline ? `Preview of your creative: headline ${hl}` : 'Preview of your creative so far'}>
            <div className="frame" style={{ '--ar': ar }}>
              <div className="frame__chips">
                {post.purpose && <span className="frame__chip frame__chip--blue"><b>Purpose</b> {post.purpose}</span>}
                {post.mediums?.[0] && <span className="frame__chip frame__chip--blue">{fmt.platform} · {fmt.label}</span>}
                {dirTitle && <span className="frame__chip frame__chip--blue"><b>Direction</b> {dirTitle.length > 40 ? `${dirTitle.slice(0, 39)}…` : dirTitle}</span>}
                {(brief.moodTags || []).map((m) => <span key={m} className="frame__chip frame__chip--mood">{m}</span>)}
                {(brief.styleReferences || []).map((m) => <span key={m} className="frame__chip frame__chip--mood">{m}</span>)}
              </div>
              {renderHeadline && (hl.trim() || showSubInFrame) && (
                <div className="frame__copy">
                  {hl.trim() && <p className="frame__head">{hl}</p>}
                  {showSubInFrame && <p className="frame__sub">{sb}</p>}
                </div>
              )}
            </div>
          </div>

          <aside className="rail__panel" aria-label="Messaging">
            <div className="sa-text">
              <p className="sa-kicker">04 / Messaging</p>
              <h2 className="sa-heading">Write the messaging</h2>
              <p className="ncf-lede">We have drafted this in the <strong>{dirTitle}</strong> direction. Edit any box, or use Suggest to see options and pick one. Switch a box off if it should not be in the creative.</p>
              <AiErrorNotice error={error} />

              <section className={`ncf-group ncf-group--card ${renderHeadline ? '' : 'ncf-group--off'}`.trim()} aria-labelledby="ncf-hd-label">
                <div className="ncf-group__head">
                  <label className="ncf-label ncf-label--lg" id="ncf-hd-label" htmlFor="ncf-hd">Headline</label>
                  <span className="ncf-group__tools">
                    <Switch on={renderHeadline} onToggle={() => setRenderHeadline((v) => !v)} label="Show in creative" />
                    <span className="ncf-count">{hl.length}</span>
                  </span>
                </div>
                <textarea
                  id="ncf-hd"
                  className="ncf-textarea"
                  rows={2}
                  style={{ minHeight: 56 }}
                  disabled={!renderHeadline}
                  placeholder={hLoading ? 'Writing headline…' : 'The headline that goes on the image'}
                  value={hl}
                  onChange={(e) => setHeadlineByLabel((x) => ({ ...x, [msgLabel]: e.target.value }))}
                />
                <SuggestRow canUndo={undoHeadline.can} onUndo={undoHeadline.run}>
                  <SuggestLink onClick={() => suggestHeadlineOptions()} loading={loadingHeadlineOptions || hLoading} disabled={!renderHeadline} improve={Boolean(hl.trim())} label="Suggest a headline" />
                </SuggestRow>
                {renderHeadline && headlineOptions.length > 0 && (
                  <div className="ncf-ideas">
                    {headlineOptions.map((o) => (
                      <button key={o} type="button" className="ncf-idea" onClick={() => { const prev = hl; undoHeadline.remember(() => setHeadlineByLabel((x) => ({ ...x, [msgLabel]: prev }))); setHeadlineByLabel((x) => ({ ...x, [msgLabel]: o })); setHeadlineOptions([]); }}>{o}</button>
                    ))}
                  </div>
                )}
              </section>

              <section className={`ncf-group ncf-group--card ${renderHeadline && renderSub ? '' : 'ncf-group--off'}`.trim()} aria-labelledby="ncf-sb-label">
                <div className="ncf-group__head">
                  <label className="ncf-label ncf-label--lg" id="ncf-sb-label" htmlFor="ncf-sb">Sub-headline</label>
                  <span className="ncf-group__tools">
                    <Switch on={renderSub} onToggle={() => setRenderSub((v) => !v)} label="Show in creative" />
                    <span className="ncf-count">{sb.length}</span>
                  </span>
                </div>
                <textarea
                  id="ncf-sb"
                  className="ncf-textarea"
                  rows={2}
                  style={{ minHeight: 56 }}
                  disabled={!renderHeadline || !renderSub}
                  placeholder={hLoading ? 'Writing sub-headline…' : 'A short supporting line under the headline'}
                  value={sb}
                  onChange={(e) => setSubByLabel((x) => ({ ...x, [msgLabel]: e.target.value }))}
                />
                <SuggestRow canUndo={undoSub.can} onUndo={undoSub.run}>
                  <SuggestLink onClick={suggestSub} loading={loadingSubOptions || hLoading} disabled={!renderHeadline || !renderSub} improve={Boolean(sb.trim())} label="Suggest a sub-headline" />
                </SuggestRow>
                {renderHeadline && renderSub && subOptions.length > 0 && (
                  <div className="ncf-ideas">
                    {subOptions.map((o) => (
                      <button key={o} type="button" className="ncf-idea" onClick={() => { const prev = sb; undoSub.remember(() => setSubByLabel((x) => ({ ...x, [msgLabel]: prev }))); setSubByLabel((x) => ({ ...x, [msgLabel]: o })); setSubOptions([]); }}>{o}</button>
                    ))}
                  </div>
                )}
              </section>

              {social ? (
                <section className={`ncf-group ncf-group--card ${renderPost ? '' : 'ncf-group--off'}`.trim()} aria-labelledby="ncf-pc-label">
                  <div className="ncf-group__head">
                    <label className="ncf-label ncf-label--lg" id="ncf-pc-label" htmlFor="ncf-pc">Post copy</label>
                    <span className="ncf-group__tools">
                      <Switch on={renderPost} onToggle={() => setRenderPost((v) => !v)} label="Include post copy" />
                      <span className="ncf-count">{(d ? captionFor(d) : '').length}</span>
                    </span>
                  </div>
                  <textarea
                    id="ncf-pc"
                    className="ncf-textarea"
                    rows={9}
                    disabled={!renderPost || !d}
                    placeholder="The copy that goes with the post"
                    value={d ? captionFor(d) : ''}
                    onChange={(e) => setDraftCaptions((x) => ({ ...x, [msgLabel]: e.target.value }))}
                    onBlur={() => saveCaptionEdit(msgLabel)}
                  />
                  <SuggestRow canUndo={undoCopy.can} onUndo={undoCopy.run}>
                    <SuggestLink onClick={() => (d && captionFor(d)?.trim() ? improveCopy(msgLabel) : regenerateCopy(msgLabel))} loading={Boolean(copyLoading[msgLabel])} disabled={!renderPost} improve={Boolean(d && captionFor(d)?.trim())} label="Suggest post copy" />
                  </SuggestRow>
                  {renderPost && (copyOptions[msgLabel] || []).length > 0 && (
                    <div className="ncf-ideas">
                      {copyOptions[msgLabel].map((o) => (
                        <button key={o} type="button" className="ncf-idea" style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }} onClick={() => pickCopyOption(msgLabel, o)}>{o}</button>
                      ))}
                    </div>
                  )}
                </section>
              ) : (
                <p className="ncf-note">This format does not need post copy.</p>
              )}

              <p className="ncf-hint" aria-live="polite">{canGo ? 'Looking good. Click Generate.' : hLoading ? 'Writing your headline…' : 'Add a headline to continue.'}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!canGo} onClick={() => chooseDirection(msgLabel)}>
                  <img src={iconSparkleWhite} alt="" className="sa-btn__sm" /><span>Generate</span><img src={iconArrowWhite} alt="" />
                </button>
                <CostTag estimate={costs?.imageHigh ? { usd: costs.imageHigh.usd * DESIGN_OPTION_COUNT, model: costs.imageHigh.model } : null} />
              </div>
            </div>
            <PanelArt />
          </aside>
        </div>
      </Layout>
    );
  }

  // -------------------------------------------------------------------
  // PHASE 2 - 3 image options for the chosen direction (or, for a
  // carousel-type format, the full ordered set of carousel slides instead)
  // -------------------------------------------------------------------
  const isCarousel = isCarouselFormat(post.mediums?.[0]);
  const format = getFormat(post.mediums?.[0]);
  const options = chosen?.imageOptions || [];
  const carouselSlides = chosen?.carouselSlides || [];
  const anyPlaceholder = options.some((o) => o.imageModel === 'placeholder');
  const placeholderNote = options.find((o) => o.imageModel === 'placeholder')?.imageNote;
  const anyCarouselPlaceholder = carouselSlides.some((s) => s.imageModel === 'placeholder');
  const carouselPlaceholderNote = carouselSlides.find((s) => s.imageModel === 'placeholder')?.imageNote;
  const references = post.referenceCreatives || [];


  // ---- Last screen of New Creative ("Download image"): the three options on the stage, actions in the bottom panel ----
  if (newFlow && !isCarousel && !format.isVideo) {
    const sizeTxt = format.px ? `${format.px.replace('x', ' × ')} px` : format.ratio;
    const [arW, arH] = String(format.ratio || '4:5').split(':').map(Number);
    const ar = arW && arH ? arW / arH : 0.8;
    const pending = options.some((o) => o.imageModel === 'pending');
    const working = optionsLoading || pending;
    const anyImage = options.some((o) => o.imageUrl);
    const showCopy = isSocialPlatform(format.platform) && renderPost && Boolean(chosen?.caption);
    const slots = options.length ? options : Array.from({ length: DESIGN_OPTION_COUNT }, () => null);
    return (
      <Layout rail pageClass="page-result" step="download" flow={newFlowProp(post)} {...stepLinks}>
        <Rail bottom>
          <RailStage scroll className="rail__stage--copy">
            <div className="stage-grid">
              <div className="options" style={{ '--ar': ar, '--n': slots.length }}>
                {slots.map((opt, i) => {
                  const isSelected = Boolean(opt?.imageUrl && chosen?.imageUrl && opt.imageUrl === chosen.imageUrl);
                  const isPicking = selectingIndex === i;
                  const dlName = `${fileSlug(post.purpose)}-option-${i + 1}.${opt?.imageUrl ? fileExt(opt.imageUrl) : 'png'}`;
                  return (
                    <div key={i} className="option" role="group" aria-label={`Option ${i + 1}`} aria-checked={isSelected ? 'true' : 'false'}>
                      <div className="option__frame canvas" style={{ aspectRatio: ar, ...(opt && !opt.imageUrl && opt.background ? { background: opt.background } : {}) }}>
                        {opt?.imageUrl && <img src={resolveAssetUrl(opt.imageUrl)} alt={`Option ${i + 1}`} />}
                        {(optionsLoading || !opt || (!opt.imageUrl && opt.imageModel === 'pending')) && (
                          <div className="direction-card__canvas-loading"><BloomLoader label="Generating…" /></div>
                        )}
                        {opt && !opt.imageUrl && opt.imageModel !== 'pending' && !optionsLoading && (
                          <div className="direction-card__no-image">
                            <p>{opt.imageNote || 'This option could not be generated.'}</p>
                            {opt.imageBillingUrl && (
                              <a href={opt.imageBillingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: 11.5, padding: '5px 10px' }}>Add AI credits ↗</a>
                            )}
                          </div>
                        )}
                        {opt?.imageUrl && !optionsLoading && (
                          <>
                            <button
                              type="button"
                              className="option__pick"
                              aria-pressed={isSelected}
                              aria-label={isSelected ? `Option ${i + 1} selected` : `Select option ${i + 1}`}
                              disabled={isPicking}
                              onClick={() => pickOption(chosenLabel, i)}
                            >
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                            </button>
                            <div className="sa-tile__actions">
                              <button
                                type="button"
                                className="sa-btn sa-btn--white sa-btn--tile"
                                onClick={() => openLightbox({
                                  src: opt.imageUrl,
                                  formatId: post.mediums?.[0],
                                  downloadName: dlName,
                                  title: chosen?.caption || post.purpose,
                                  meta: [{ label: 'Option', value: `${i + 1} of ${options.length}` }]
                                })}
                              ><img src={ICON_EYE} alt="" /><span>Preview</span></button>
                              <span className="sa-tile__right">
                                <button
                                  type="button"
                                  className="sa-btn sa-btn--primary sa-btn--tile"
                                  disabled={downloadingKey === `opt-${i}`}
                                  aria-label={`Download option ${i + 1}`}
                                  onClick={() => downloadImage(`opt-${i}`, opt.imageUrl, dlName)}
                                ><img className="sa-icon-down" src={ICON_DOWN_TILE} alt="" /></button>
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {showCopy && !working && (
              <div className="stage-copy">
                <p className="stage-copy__text postcopy">{chosen ? captionFor(chosen) : ''}</p>
                <button type="button" className={`postpop__copy ${copiedCopy ? 'is-done' : ''}`.trim()} aria-label={copiedCopy ? 'Copied' : 'Copy post copy'} title={copiedCopy ? 'Copied' : 'Copy post copy'} onClick={copyPostCopy}>
                  {copiedCopy
                    ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    : <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>}
                </button>
              </div>
            )}
          </RailStage>
          <RailBottom
            text={(
              <>
                <p role="status">
                  {working
                    ? 'Generating your options. This usually takes a few seconds.'
                    : (slots.length === 1 ? `Here is your design at ${sizeTxt}. Preview or download it, or pick it to turn into a video.` : `Here are ${['', 'one', 'two', 'three'][slots.length] || slots.length} options at ${sizeTxt}. Preview or download them, or pick one to turn into a video.`)}
                </p>
                {error && !optionsLoading ? (
                  <>
                    <p className="rail__bottom-error" role="alert">We couldn’t generate your creatives. Your selections are saved, so you can try again.</p>
                    <button type="button" className="sa-btn sa-btn--outline" onClick={() => { setError(''); generateOptions(chosenLabel, draftPrompt); }}>Try again</button>
                  </>
                ) : null}
                {!anyPlaceholder ? null : (
                  <p className="rail__bottom-error" role="status">{placeholderNote || 'Image generation isn’t fully available.'} An admin needs to set up image generation before real creatives can be made.</p>
                )}
                <div className="dl-row">
                  <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!anyImage || working || downloadingKey === 'all'} onClick={downloadAll}>
                    <span>{downloadingKey === 'all' ? 'Downloading…' : 'Download all'}</span>
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={working}
                    onClick={() => generateOptions(chosenLabel, draftPrompt)}
                    title={`Generate ${optionsWord(DESIGN_OPTION_COUNT)} for this copy direction`}
                  >Regenerate designs</button>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={working}
                    onClick={fineTuneChosen}
                  >Fine-tune {chosen?.imageUrl ? 'this image' : 'an option'} →</button>
                  <button type="button" className="link-btn" disabled={working} onClick={() => navigate('/generate', { state: { start: 'new', restart: true } })} title="Start New Creative again from scratch">Restart</button>
                </div>
              </>
            )}
            actions={<NextStepCards convert="select" imageUrl={chosen?.imageUrl || ''} selectHint="Select one of the options first." />}
          />
        </Rail>
        {imageRequiredPrompt && (
          <Modal title="Select an image first" onClose={() => setImageRequiredPrompt(null)} width={460}>
            <p style={{ marginBottom: 16, lineHeight: 1.5 }}>Fine-tune works on one specific image. Pick one of the options, then tap Fine-tune again.</p>
            <div className="btn-row" style={{ marginTop: 0 }}>
              <Btn variant="primary" onClick={() => setImageRequiredPrompt(null)}>OK</Btn>
            </div>
          </Modal>
        )}
      </Layout>
    );
  }

  return (
    <Layout eyebrow="Step 02" title="Generate Designs" step="designs" flow={newFlowProp(post)} {...(newFlow ? stepLinks : {})}>
      {error && !optionsLoading ? <GenerationError error={error} onRetry={() => { setError(''); generateOptions(chosenLabel, draftPrompt); }} /> : null}

      <button type="button" className="link-btn" style={{ marginBottom: 14 }} onClick={() => { if (newFlow) setMsgLabel(chosenLabel); setChosenLabel(null); }}>
        {newFlow ? '← Back to messaging' : '← Back to creative directions'}
      </button>

      {isSocialPlatform(format.platform) && renderPost && (
        <Card style={{ marginBottom: 18 }}>
          <p className="hint" style={{ marginBottom: 6 }}>Post copy</p>
          <div className="nc-copy">
            <p className="nc-copy__text">{chosen?.caption}</p>
            <button type="button" className="nc-copy__btn" aria-label="Copy post copy" title="Copy post copy" onClick={copyPostCopy}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
            </button>
            {copiedCopy && <span className="nc-copy__done" role="status">Copied</span>}
          </div>
        </Card>
      )}

      {format.isVideo && (
        <div className="notice-banner" style={{ marginBottom: 18 }}>
          <strong>🎥 {format.platform} {format.label} is a video format.</strong>
          <p style={{ margin: '4px 0 0' }}>
            There's no still image to pick between here - use "Generate video" below to produce the actual creative
            ({format.videoAspectRatio}, up to {format.maxDurationSeconds}s, {format.recommendedDurationSeconds}s recommended).
          </p>
        </div>
      )}

      {imageRequiredPrompt && (
        <Modal title="Select an image first" onClose={() => setImageRequiredPrompt(null)} width={460}>
          <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
            {imageRequiredPrompt === 'finetune'
              ? 'Fine-tune works on one specific image. Pick one of the design options above, then tap Fine-tune again.'
              : imageRequiredPrompt === 'suggest'
              ? 'Animation ideas are written for a specific image. Pick one of the design options above, then try again.'
              : 'The video animates the image you approve. Pick one of the design options above, then generate the video.'}
          </p>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <Btn variant="primary" onClick={goToImageOptions}>Choose an image</Btn>
            <Btn variant="secondary" onClick={() => setImageRequiredPrompt(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {!optionsLoading && !carouselLoading && (anyPlaceholder || anyCarouselPlaceholder) && (
        <div className="notice-banner" style={{ marginBottom: 18 }}>
          <strong>Image generation isn't fully available.</strong>
          <p style={{ margin: '4px 0 0' }}>
            {placeholderNote || carouselPlaceholderNote} An admin needs to set up the AI image model before real creatives can be generated.
          </p>
        </div>
      )}

      {/* Headline and sub-headline are set per copy direction on the previous screen. */}

      {isAgency && !isCarousel && !format.isVideo && (
      <button
        type="button"
        className="link-btn"
        style={{ marginBottom: 10 }}
        onClick={() => setShowPromptEditor((v) => !v)}
      >
        {showPromptEditor ? '− Hide' : '✎ Edit'} image brief
      </button>
      )}

      {isAgency && showPromptEditor && (
        <div style={{ marginBottom: 16 }}>
          <textarea
            className="direction-card__prompt-input"
            value={draftPrompt ?? chosen?.imagePrompt ?? ''}
            onChange={(e) => setDraftPrompt(e.target.value)}
            rows={5}
          />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <Btn variant="secondary" loading={optionsLoading} onClick={() => generateOptions(chosenLabel, draftPrompt)}>
              {DESIGN_OPTION_COUNT === 1 ? 'Regenerate with this brief' : `Regenerate ${DESIGN_OPTION_COUNT} options with this brief`}
            </Btn>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}>
              <input type="checkbox" checked={followBrand} onChange={(e) => setFollowBrand(e.target.checked)} />
              Follow Brand Assets &amp; Guidelines
            </label>
            {costs && (
              <CostTag
                estimate={(() => {
                  const perImage = costs[post.creativeBrief?.qualityTier === 'standard' ? 'imageStandard' : 'imageHigh'];
                  return perImage ? { usd: perImage.usd * DESIGN_OPTION_COUNT, model: perImage.model } : null;
                })()}
              />
            )}
          </div>
        </div>
      )}

      {optionsLoading && (
        <>
          {post?.creativeType !== 'adaptation' && <p className="hint" style={{ marginBottom: 12 }}>Building your creative</p>}
          <div className="image-option-grid">
            {Array.from({ length: DESIGN_OPTION_COUNT }, (_, i) => i).map((i) => (
              <div key={i} className="image-option-card image-option-card--skeleton">
                <div className={`image-option-card__canvas image-option-card__canvas--skeleton ${canvasModifier}`} style={{ aspectRatio: canvasRatio }}>
                  <BloomLoader />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!optionsLoading && options.length === 0 && chosen && !format.isVideo && !isCarouselFormat(post.mediums?.[0]) && (
        <Card style={{ marginBottom: 18, textAlign: 'center' }}>
          <p className="hint" style={{ marginBottom: 12 }}>
            {post?.creativeType === 'adaptation'
              ? "Ready to generate against your uploaded template - each option costs a real image-generation call, so nothing runs until you're ready."
              : "No design options yet - generate them when you're ready (each option costs a real image-generation call)."}
          </p>
          <Btn variant="primary" loading={optionsLoading} onClick={() => generateOptions(chosenLabel)}>
            ✦ Generate Design Options
          </Btn>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, fontSize: 13, fontWeight: 500, cursor: 'pointer', color: 'var(--ink)' }}>
            <input type="checkbox" checked={followBrand} onChange={(e) => setFollowBrand(e.target.checked)} />
            Follow Brand Assets &amp; Guidelines
          </label>
          {costs && (
            <div style={{ marginTop: 8 }}>
              <CostTag
                estimate={(() => {
                  const perImage = costs[post.creativeBrief?.qualityTier === 'standard' ? 'imageStandard' : 'imageHigh'];
                  return perImage ? { usd: perImage.usd * DESIGN_OPTION_COUNT, model: perImage.model } : null;
                })()}
              />
            </div>
          )}
        </Card>
      )}

      {/* One fixed heading; only the line under it changes between building and ready (Creative Adaptation).
          New Creative shows "Your options are ready" once the images are in. */}
      {post?.creativeType === 'adaptation' && (optionsLoading || options.length > 0) && (
        <>
          <h2 className="nc-ready" style={{ marginBottom: 4 }}>Your creative</h2>
          <p className="hint" style={{ marginBottom: 14 }} role="status">
            {optionsLoading || options.some((o) => o.imageModel === 'pending') ? 'Building your creative…' : 'Your options are ready.'}
          </p>
        </>
      )}
      {post?.creativeType !== 'adaptation' && !optionsLoading && options.length > 0 && !options.some((o) => o.imageModel === 'pending') && (
        <h2 className="nc-ready">Your options are ready</h2>
      )}

      {!optionsLoading && options.length > 0 && (
        <div className="image-option-grid">
          {options.map((opt, i) => {
            const isSelected = chosen?.imageUrl && opt.imageUrl === chosen.imageUrl;
            const isPicking = selectingIndex === i;
            return (
              <div
                key={i}
                className={`image-option-card ${isSelected || isPicking ? 'selected' : ''}`}
                onClick={() => opt.imageUrl && pickOption(chosenLabel, i)}
              >
                <div
                  className={`image-option-card__canvas ${canvasModifier}`}
                  style={opt.imageUrl ? { aspectRatio: canvasRatio } : { background: opt.background, aspectRatio: canvasRatio }}
                >
                  {opt.imageUrl && <img className="cap-img" src={resolveAssetUrl(opt.imageUrl)} alt="" />}
                  {opt.imageUrl && (
                    <button
                      type="button"
                      className="image-option-card__view"
                      onClick={(e) => {
                        e.stopPropagation();
                        openLightbox({
                          src: opt.imageUrl,
                          formatId: post.mediums?.[0],
                          downloadName: `${fileSlug(post.purpose)}-option-${i + 1}.${fileExt(opt.imageUrl)}`,
                          title: chosen?.caption || post.purpose,
                          meta: [
                            { label: 'Option', value: `${i + 1} of ${options.length}` }
                          ]
                        });
                      }}
                      aria-label="View full size"
                    >
                      🔍
                    </button>
                  )}
                  {opt.imageUrl && (
                    <button
                      type="button"
                      className="image-option-card__view"
                      style={{ right: 48, cursor: 'pointer' }}
                      disabled={downloadingKey === `opt-${i}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadImage(`opt-${i}`, opt.imageUrl, `${fileSlug(post.purpose)}-option-${i + 1}.${fileExt(opt.imageUrl)}`);
                      }}
                      aria-label="Download image"
                      title="Download image"
                    >
                      {downloadingKey === `opt-${i}` ? '…' : '⬇'}
                    </button>
                  )}
                  {!opt.imageUrl && !isPicking && opt.imageModel === 'pending' && (
                    <div className="direction-card__canvas-loading">
                      <BloomLoader label="Generating…" />
                    </div>
                  )}
                  {!opt.imageUrl && opt.imageModel !== 'pending' && (
                    <div className="direction-card__no-image">
                      <p>{opt.imageNote || 'This option could not be generated.'}</p>
                      {opt.imageBillingUrl && (
                        <a
                          href={opt.imageBillingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary"
                          style={{ fontSize: 11.5, padding: '5px 10px' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Add AI credits ↗
                        </a>
                      )}
                    </div>
                  )}
                  {isSelected && <SelBadge className="image-option-card__badge" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!optionsLoading && options.length > 0 && !format.isVideo && !isCarousel && (
        <div className="nc-actions">
          <Btn variant="primary" disabled={!chosen?.imageUrl} onClick={() => navigate('/video')}>
            Convert to video
          </Btn>
          <Btn variant="secondary" className="btn-flat" loading={downloadingKey === 'all'} disabled={!options.some((o) => o.imageUrl)} onClick={downloadAll}>
            Download all
          </Btn>
          {!chosen?.imageUrl && <p className="nc-actions__hint" role="status">Select one option</p>}
        </div>
      )}

      {!optionsLoading && options.length > 0 && (
        <div className="btn-row" style={{ marginTop: 0, marginBottom: 18, justifyContent: 'flex-end' }}>
          <Btn
            variant="secondary"
            loading={optionsLoading}
            disabled={options.some((o) => o.imageModel === 'pending')}
            onClick={() => generateOptions(chosenLabel, draftPrompt)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            title={`Generate ${optionsWord(DESIGN_OPTION_COUNT)} for this copy direction`}
          >
            {!optionsLoading && <RegenIcon />}
            Regenerate designs
          </Btn>
          <Btn
            variant="secondary"
            onClick={fineTuneChosen}
          >
            ✎ Fine-tune {chosen?.imageUrl ? 'this image' : 'an option'} →
          </Btn>
        </div>
      )}

      {isCarousel && (
        <Card style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
            <CardHead title={`${format.label} slides`} tag={carouselSlides.length ? `${carouselSlides.length} slides` : undefined} />
          </div>
          <p className="hint" style={{ marginBottom: 14 }}>
            {format.notSwipeable
              ? `X shows these as a grid of up to ${format.maxSlides} images in one post.`
              : `Each slide plays a role in the sequence - swipe through to preview the full set. Tap any slide to view it full-size and browse the rest with ← →.`}
          </p>

          {carouselLoading && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Array.from({ length: post.creativeBrief?.slideCount || 5 }, (_, i) => (
                <div key={i} className="image-option-card image-option-card--skeleton" style={{ width: 120 }}>
                  <div className={`image-option-card__canvas image-option-card__canvas--skeleton ${canvasModifier}`} style={{ aspectRatio: canvasRatio }}>
                    <BloomLoader />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!carouselLoading && carouselSlides.length === 0 && (
            <div className="btn-row" style={{ marginTop: 0 }}>
              <Btn variant="primary" onClick={() => generateCarousel(chosenLabel)}>✦ Generate {post.creativeBrief?.slideCount || 5} slides</Btn>
              {costs && (
                <CostTag
                  estimate={(() => {
                    const perImage = costs[post.creativeBrief?.qualityTier === 'standard' ? 'imageStandard' : 'imageHigh'];
                    return perImage ? { usd: perImage.usd * (post.creativeBrief?.slideCount || 5), model: perImage.model } : null;
                  })()}
                />
              )}
            </div>
          )}

          {!carouselLoading && carouselSlides.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
                {carouselSlides.map((slide, i) => (
                  <div key={slide.index} style={{ flex: '0 0 auto', width: 130, textAlign: 'center' }}>
                    <div
                      className={`image-option-card__canvas ${canvasModifier}`}
                      style={{ width: 130, aspectRatio: canvasRatio, cursor: slide.imageUrl ? 'zoom-in' : 'default', ...(slide.imageUrl ? {} : { background: 'linear-gradient(150deg,#1D3FE0,#8FA9FF)' }) }}
                      onClick={() =>
                        slide.imageUrl &&
                        openLightbox({
                          index: i,
                          items: carouselSlides.map((s) => ({
                            src: s.imageUrl,
                            formatId: post.mediums?.[0],
                            downloadName: `${fileSlug(post.purpose)}-slide-${s.index + 1}.${fileExt(s.imageUrl)}`,
                            title: chosen?.caption,
                            meta: [
                              { label: 'Slide', value: `${s.index + 1} of ${carouselSlides.length}` },
                              { label: 'Role', value: s.slideRole || '—' }
                            ]
                          }))
                        })
                      }
                    >
                      {slide.imageUrl && <img className="cap-img" src={resolveAssetUrl(slide.imageUrl)} alt="" />}
                      {!slide.imageUrl && (
                        <div className="direction-card__no-image">
                          <p>{slide.imageNote || 'Could not be generated.'}</p>
                          {slide.imageBillingUrl && (
                            <a
                              href={slide.imageBillingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary"
                              style={{ fontSize: 11, padding: '4px 8px' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Add credits ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="hint" style={{ margin: '6px 0 0' }}>{i + 1}. {slide.slideRole || ''}</p>
                  </div>
                ))}
              </div>
              <div className="btn-row" style={{ marginTop: 14 }}>
                <Btn variant="secondary" loading={carouselLoading} onClick={() => generateCarousel(chosenLabel)}>
                  ↻ Regenerate all slides
                </Btn>
                {costs && (
                  <CostTag
                    estimate={(() => {
                      const perImage = costs[post.creativeBrief?.qualityTier === 'standard' ? 'imageStandard' : 'imageHigh'];
                      return perImage ? { usd: perImage.usd * carouselSlides.length, model: perImage.model } : null;
                    })()}
                  />
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {/* Video card appears only once images exist (video-only formats have no still, so they always show it). */}
      {chosen?.caption && !optionsLoading && !carouselLoading && (format.isVideo || options.length > 0 || carouselSlides.length > 0 || chosen?.imageUrl) && (() => {
        // Jobs for whichever video format is currently selected in the
        // picker below - an empty formatId on an older job (from before
        // this per-format picker existed) is treated as "the post's
        // primary medium" per generateVariantVideo's own convention.
        const jobs = (chosen.videoJobs || []).filter((j) => (j.formatId || post.mediums?.[0]) === videoFormatId);
        const latestJob = jobs[jobs.length - 1];
        // "Tweak the prompt" - shows exactly what was sent for the last video, editable, used on the next regenerate.
        const renderPromptEditor = () => {
          if (!latestJob?.prompt || isActive) return null;
          return (
            <div style={{ marginBottom: 12 }}>
              <button type="button" className="link-btn" style={{ fontSize: 13 }} onClick={() => setShowVideoPromptEditor((v) => !v)}>
                {showVideoPromptEditor ? '▾ Hide video prompt' : '✎ Tweak the video prompt before regenerating'}
              </button>
              {showVideoPromptEditor && (
                <div style={{ marginTop: 8 }}>
                  <p className="hint" style={{ marginBottom: 6 }}>
                    This is the instruction the AI video model received for the last video. Change anything - motion, speed, what must stay still - then press Regenerate. Rules that keep logos, product and text still are re-added automatically.
                  </p>
                  <textarea
                    rows={7}
                    maxLength={4000}
                    value={videoPromptDraft ?? latestJob.prompt}
                    onChange={(e) => setVideoPromptDraft(e.target.value)}
                    style={{ width: '100%' }}
                  />
                  {videoPromptDraft !== null && videoPromptDraft !== latestJob.prompt && (
                    <button type="button" className="link-btn" style={{ fontSize: 12, marginTop: 4 }} onClick={() => setVideoPromptDraft(null)}>
                      Reset to the original prompt
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        };
        // "Give feedback" - a short follow-up note the video model keeps in mind on the next regenerate.
        const renderFeedbackBox = () => {
          if (!latestJob || isActive) return null;
          const hasEarlier = jobs.some((j) => j.feedback);
          return (
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Feedback on this video (optional)</label>
              <textarea
                rows={2}
                maxLength={500}
                value={videoFeedback}
                onChange={(e) => setVideoFeedback(e.target.value)}
                placeholder="e.g. Slower camera move, no zoom on the product, keep the headline completely still…"
                style={{ width: '100%' }}
              />
              <p className="hint" style={{ marginTop: 4 }}>
                Tell the AI what to change. It is added to the instruction as a follow-up and applied when you press {latestJob.status === 'failed' ? 'Try again' : 'Regenerate'}.
              </p>
              {hasEarlier && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 4 }}>
                  <input type="checkbox" checked={carryFeedback} onChange={(e) => setCarryFeedback(e.target.checked)} />
                  Keep my earlier feedback in mind too
                </label>
              )}
            </div>
          );
        };
        const isActive = latestJob && (latestJob.status === 'pending' || latestJob.status === 'processing');
        const videoTargetFormat = getFormat(videoFormatId);
        return (
          <Card style={{ marginBottom: 18 }}>
            <CardHead title="Generate video" tag="Beta" />
            <p className="hint" style={{ marginBottom: 14 }}>
              Turns this copy direction into a short video, using the AI video model - generation typically takes 1-3 minutes.
              {' '}Sized for {videoTargetFormat.platform} {videoTargetFormat.label}: {videoTargetFormat.videoAspectRatio}, {videoTargetFormat.recommendedDurationSeconds}s (up to {videoTargetFormat.maxDurationSeconds}s).
            </p>

            <div className="field" style={{ marginBottom: 10 }}>
              <label>Video type</label>
              <div className="select-row">
                <select
                  value={videoFormatPlatform}
                  onChange={(e) => {
                    const firstForPlatform = VIDEO_FORMATS.find((f) => f.platform === e.target.value);
                    setVideoFormatId(firstForPlatform?.id);
                  }}
                >
                  {VIDEO_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                </select>
                <select value={videoFormatId} onChange={(e) => setVideoFormatId(e.target.value)}>
                  {VIDEO_FORMATS.filter((f) => f.platform === videoFormatPlatform).map((f) => (
                    <option key={f.id} value={f.id}>{f.label} ({f.videoAspectRatio})</option>
                  ))}
                </select>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                Every video placement across every connected platform - Reels, Shorts, TikTok, Stories, and more - not just the format you picked as this post's primary medium on Step 01.
              </p>
            </div>

            {SHOW_VIDEO_SOURCE_PICKER && chosen.imageUrl && (
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Video source</label>
                <select value={videoMode} onChange={(e) => setVideoMode(e.target.value)} disabled={isActive}>
                  <option value="animate_kv">Animate the approved image (recommended)</option>
                  <option value="new_scene">Generate a new scene from the brief</option>
                </select>
                <p className="hint" style={{ marginTop: 6 }}>
                  {videoMode === 'animate_kv'
                    ? "Adds motion to this exact creative - logo, compliance text, and layout stay locked in place. What most agencies want: the client already approved this image."
                    : "Generates a brand-new video scene from the copy's brief, independent of the still image - may not match the approved creative."}
                </p>
              </div>
            )}
            {(() => {
              const ideasCurrent = videoIdeasKey === `${chosenLabel}|${chosen.imageUrl || ''}`;
              const pickedCount = ideasCurrent ? videoIdeas.filter((i) => selectedIdeaIds.has(i.id)).length : 0;
              return (
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>Animation ideas</label>
                  <p className="hint" style={{ marginBottom: 8 }}>
                    AUTOMATr studies this creative and its copy direction and lists everything that could be animated - camera moves, subject motion,
                    atmosphere, light, text and supers and more. Tick the ones you want and they are sent to the video model. Logos, QR codes and legal/compliance text always stay still.
                  </p>
                  <div className="btn-row" style={{ marginTop: 0, marginBottom: 10 }}>
                    <Btn variant="secondary" loading={ideasLoading} onClick={handleSuggestIdeas}>
                      {ideasCurrent ? '↻ Suggest again' : '✦ Suggest animation ideas'}
                    </Btn>
                  </div>
                  {ideasLoading && <LoadingSpinner label="Studying the creative and listing animation possibilities…" />}
                  {!ideasLoading && ideasCurrent && bestCombo.ids.length > 0 && (
                    <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8, marginBottom: 12 }}>
                      <p style={{ marginBottom: 6 }}>
                        <strong>AI&apos;s best combination</strong> - {bestCombo.ids.length} ideas that work well together:
                      </p>
                      <p className="hint" style={{ marginBottom: 6 }}>
                        {bestCombo.ids.map((id) => videoIdeas.find((i) => i.id === id)?.title).filter(Boolean).join(' · ')}
                      </p>
                      {bestCombo.rationale && <p className="hint" style={{ marginBottom: 8 }}>{bestCombo.rationale}</p>}
                      <Btn variant="secondary" onClick={applyBestCombination}>✦ Use the best combination</Btn>
                    </div>
                  )}
                  {!ideasLoading && ideasCurrent && (
                    <>
                      {(() => {
                        const inTab = (cat) => (ideaTab === 'basic') === BASIC_IDEA_CATEGORIES.includes(cat.key);
                        const countFor = (basic) => videoIdeas.filter((i) => selectedIdeaIds.has(i.id) && BASIC_IDEA_CATEGORIES.includes(i.category) === basic).length;
                        const tabs = [['basic', 'Basic', countFor(true)], ['advanced', 'Advanced', countFor(false)]];
                        return (
                          <>
                            <div role="tablist" style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
                              {tabs.map(([k, label, n]) => (
                                <button
                                  key={k}
                                  type="button"
                                  role="tab"
                                  aria-selected={ideaTab === k}
                                  onClick={() => setIdeaTab(k)}
                                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '8px 6px', marginRight: 12, marginBottom: -1, fontSize: 13, fontWeight: 600, color: ideaTab === k ? '#1D3FE0' : '#667085', borderBottom: ideaTab === k ? '2px solid #2E5EFF' : '2px solid transparent' }}
                                >
                                  {label}
                                  {n > 0 && <span style={{ marginLeft: 6, background: '#2E5EFF', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>{n}</span>}
                                </button>
                              ))}
                            </div>
                            {ideaTab === 'advanced' && (
                              <p className="hint" style={{ marginBottom: 8 }}>
                                Camera movement, depth, focus, reveals and finishing touches. Optional - skip this tab for a natural result.
                              </p>
                            )}
                            {videoIdeaCategories.filter(inTab).map((cat) => {
                              const catIdeas = videoIdeas.filter((i) => i.category === cat.key);
                              if (catIdeas.length === 0) return null;
                              return (
                                <div key={cat.key} style={{ marginBottom: 14 }}>
                                  <p className="hint" style={{ margin: '4px 0 8px' }}>
                                    <strong>{cat.key === 'text' ? 'Headline animation' : cat.label}</strong>{cat.single ? ' - pick one' : ''}{cat.text ? ' - video models can distort lettering, so check the result' : ''}
                                  </p>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
                                    {catIdeas.map((idea) => {
                                      const selected = selectedIdeaIds.has(idea.id);
                                      return (
                                        <button
                                          key={idea.id}
                                          type="button"
                                          role="checkbox"
                                          aria-checked={selected}
                                          disabled={isActive}
                                          onClick={() => toggleVideoIdea(idea)}
                                          style={{
                                            textAlign: 'left',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 6,
                                            cursor: isActive ? 'default' : 'pointer',
                                            padding: '12px 14px',
                                            border: selected ? '1.5px solid #2E5EFF' : '1px solid var(--line)',
                                            borderRadius: 12,
                                            background: selected ? 'rgba(46, 94, 255, 0.08)' : '#fff',
                                            boxShadow: selected ? '0 4px 14px rgba(46,94,255,.12)' : 'none',
                                            font: 'inherit',
                                            color: 'inherit'
                                          }}
                                        >
                                          <span style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                            <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{idea.title}</strong>
                                            <span aria-hidden="true" style={{ flex: '0 0 auto', width: 18, height: 18, borderRadius: cat.single ? '50%' : 5, border: selected ? 'none' : '1.5px solid #C5CAD6', background: selected ? '#2E5EFF' : 'transparent', color: '#fff', fontSize: 12, lineHeight: '18px', textAlign: 'center' }}>{selected ? '\u2713' : ''}</span>
                                          </span>
                                          {idea.description && <span className="hint" style={{ lineHeight: 1.4 }}>{idea.description}</span>}
                                          <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: '#475467', background: '#F2F4F7', borderRadius: 10, padding: '2px 8px' }}>{idea.intensity}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        );
                      })()}
                      <label style={{ display: 'block', marginTop: 10 }}>Anything else to add? (optional)</label>
                      <textarea
                        rows={2}
                        maxLength={500}
                        placeholder="e.g. Keep it calm and premium - no fast movement."
                        value={customVideoDirection}
                        onChange={(e) => setCustomVideoDirection(e.target.value)}
                        disabled={isActive}
                      />
                      {videoIdeas.some((i) => i.touchesText && selectedIdeaIds.has(i.id)) && (
                        <p className="hint" style={{ marginTop: 6 }}>
                          Text animation selected - the prompt asks the video model to keep the exact wording sharp and correct. Review the video for any warped letters before using it.
                        </p>
                      )}
                      <p className="hint" style={{ marginTop: 6 }}>
                        {pickedCount > 0
                          ? `${pickedCount} idea${pickedCount === 1 ? '' : 's'} selected - they will be combined into one video.`
                          : 'Nothing ticked yet - the video will use a subtle ambient motion unless you pick some ideas.'}
                      </p>
                    </>
                  )}
                  {!ideasCurrent && !ideasLoading && (videoMode === 'animate_kv' || !chosen.imageUrl) && (
                    <div className="field" style={{ marginTop: 6 }}>
                      <label>Or choose a quick motion style</label>
                      <select value={motionStyle} onChange={(e) => setMotionStyle(e.target.value)} disabled={isActive}>
                        <option value="ambient">Ambient drift (subtle, safest for text-heavy creatives)</option>
                        <option value="zoom_in">Slow zoom in</option>
                        <option value="zoom_out">Slow zoom out</option>
                        <option value="pan">Slow pan across</option>
                      </select>
                    </div>
                  )}
                </div>
              );
            })()}

            {!latestJob && (
              <div className="btn-row" style={{ marginTop: 0 }}>
                <Btn variant="secondary" loading={generatingVideo} onClick={handleGenerateVideo}>
                  ✦ Generate video
                </Btn>
                <CostTag estimate={costs?.video} />
              </div>
            )}

            {latestJob && isActive && (
              <div style={{ position: 'relative', height: 220, borderRadius: 12, overflow: 'hidden' }}><BloomLoader label="Generating your video… this can take a few minutes" /></div>
            )}

            {latestJob && latestJob.status === 'failed' && (
              <>
                <div className="notice-banner" style={{ marginBottom: 14 }}>
                  <strong>Video generation failed.</strong>
                  <p style={{ margin: '4px 0 0' }}>{latestJob.note || 'Unknown error.'}</p>
                </div>
                {renderFeedbackBox()}
                {renderPromptEditor()}
                <Btn variant="secondary" loading={generatingVideo} onClick={handleGenerateVideo}>
                  ↻ Try again
                </Btn>
                <CostTag estimate={costs?.video} />
              </>
            )}

            {latestJob && latestJob.status === 'completed' && latestJob.videoUrl && (
              <>
                <video
                  controls
                  playsInline
                  src={resolveAssetUrl(latestJob.videoUrl)}
                  style={{ width: '100%', maxWidth: 360, borderRadius: 10, background: '#000', display: 'block', marginBottom: 12 }}
                />
                {latestJob.sourceMode && (
                  <p className="hint" style={{ marginBottom: 10 }}>
                    {latestJob.sourceMode === 'animate_kv' ? '✓ Animated from the approved image' : 'Generated as a new scene'}
                    {latestJob.motionStyle ? ` · ${latestJob.motionStyle.replace('_', ' ')}` : ''}
                    {latestJob.ideaTitles?.length ? ` · ${latestJob.ideaTitles.join(', ')}` : ''}
                  </p>
                )}
                {renderFeedbackBox()}
                {renderPromptEditor()}
                <div className="btn-row" style={{ marginTop: 0 }}>
                  <a className="btn btn-secondary" href={resolveAssetUrl(latestJob.videoUrl)} download target="_blank" rel="noopener noreferrer">
                    Download video
                  </a>
                  <Btn variant="secondary" loading={generatingVideo} onClick={handleGenerateVideo}>
                    ↻ Regenerate
                  </Btn>
                  <CostTag estimate={costs?.video} />
                </div>
              </>
            )}
          </Card>
        );
      })()}

      <div className="btn-row">
        <Btn variant="secondary" onClick={() => navigate('/generate')}>← Back to brief</Btn>
        <Btn variant="primary" onClick={handleContinue}>
          {post?.creativeType === 'adaptation' ? 'Continue to Publish →' : 'Continue →'}
        </Btn>
      </div>
    </Layout>
  );
}
