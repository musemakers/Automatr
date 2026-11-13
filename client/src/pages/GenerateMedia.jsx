import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import HeadlineEditor from '../components/HeadlineEditor.jsx';
import HeroEditor from '../components/HeroEditor.jsx';
import AdaptEditor from '../components/AdaptEditor.jsx';
import ConvertVideoEditor from '../components/ConvertVideoEditor.jsx';
import MultiSceneStudio from '../components/MultiSceneStudio.jsx';
import { setSceneHandoff } from '../utils/sceneHandoff.js';
import CustomFeatureRunner from '../components/CustomFeatureRunner.jsx';
import CreativeEditor from '../components/CreativeEditor.jsx';
import GenerateHome, { getActiveTask } from '../components/GenerateHome.jsx';
import { Btn, AiErrorNotice } from '../components/ui.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { brandAssetsApi, postsApi, stockPhotosApi, aiApi, customFeaturesApi } from '../api/resources.js';
import { apiErrorMessage, apiErrorInfo, resolveAssetUrl } from '../api/client.js';
import { getFormat, POST_FORMATS, catalogPlatformOf } from '../constants/postFormats.js';
import NewCreativeBrief, { joinBrief, splitBrief } from '../components/NewCreativeBrief.jsx';
import { useLeaveGuard } from '../components/LeaveGuard.jsx';
import '../styles/new-creative.css';

const PURPOSES = [
  'Product launch',
  'Promotion / Sale',
  'Engagement post',
  'Announcement',
  'Brand awareness',
  'Educational / How-to',
  'Behind-the-scenes',
  'Customer testimonial / UGC',
  'Event promotion',
  'Seasonal / Holiday',
  'Thought leadership',
  'Community / Culture',
  'Recruitment / Hiring',
  'Customer appreciation',
  'Feature highlight',
  'Statement / PR response'
];

// The entire brief, from the basics through to the final review, is one
// continuous step-by-step flow. Related decisions are grouped onto the
// same screen (e.g. mood + style + lighting all live under "Look & feel")
// rather than each single field getting its own step - keeps the guided
// feel without turning a 2-minute brief into 12 clicks.

// New Creative's brief is two screens - 01 Purpose & brief, 02 Visual & style - and the third step of the journey,
// Creative directions, is the copy-directions screen on /designs (see NewCreativeBrief.jsx).
const MAIN_STEPS = [
  { key: 'purpose', label: 'Purpose & brief' },
  { key: 'visual', label: 'Visual & style' }
];

const MOOD_TAGS = ['Bold', 'Minimal', 'Luxurious', 'Playful', 'Editorial', 'Warm', 'Futuristic', 'Nostalgic', 'Energetic', 'Calm'];
const STYLE_REFERENCES = [
  'Studio product photography',
  'Editorial lifestyle',
  'Cinematic film still',
  'Bold graphic / typographic',
  'Flat lay top-down',
  'Architectural / geometric',
  'Hand-illustrated',
  '3D render'
];
const PEOPLE_COUNTS = ['One person', 'A couple / two people', 'A small group or family', 'A crowd'];
const PEOPLE_AGES = ['Children', 'Teens / young adults', 'Adults', 'Seniors'];
const PEOPLE_GENDERS = ['Only female', 'Only male'];
const PEOPLE_STYLES = ['Candid, natural moment', 'Posed portrait', 'At work / in action'];
const PEOPLE_ETHNICITIES = ['Indian', 'South Asian (other)', 'East Asian', 'Southeast Asian', 'Middle Eastern', 'Black / African', 'White / European', 'Latino / Hispanic', 'Mixed / diverse group'];
const DEFAULT_PEOPLE_ETHNICITY = 'Indian';
const LIGHTING_STYLES = ['Natural daylight', 'Golden hour', 'Studio softbox', 'Dramatic high-contrast', 'Neon / vibrant', 'Moody low-key'];
const COMPOSITION_STYLES = ['Rule-of-thirds hero shot', 'Centered minimal', 'Dynamic diagonal', 'Flat lay top-down', 'Negative-space led'];

export default function GenerateMedia() {
  const navigate = useNavigate();
  const { viewOnly, features } = useAuth(); // agency admin in a customer's workspace: no creating
  const location = useLocation();
  // Opening Generate Media from the sidebar always lands on the start screen (New Creative / Finish Up / Quick Fixes),
  // even if a task is in progress - that task is offered on the Finish Up card instead of being re-opened automatically.
  const [atHome, setAtHome] = useState(Boolean(location.state?.home));
  useEffect(() => {
    if (location.state?.home) setAtHome(true);
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { post, setPost, reset, briefDraft, setBriefDraft } = useWorkflow();
  const D = briefDraft || {}; // saved unsaved-brief state from the last visit to this page (see the snapshot below)
  const { open: openLightbox } = useLightbox();

  // The fork at the very top of the brief: a brand-new concept (full
  // explore -> refine -> modify -> publish path) vs adapting an existing,
  // already-approved creative (agency workflow - one direction, straight
  // to Publish once the image is ready). See Stepper.jsx for the matching
  // shortened path this drives.
  // null = not yet chosen - shows the standalone fork screen below instead
  // of the brief form. Once a post already has a saved creativeType (an
  // existing draft being revisited), that choice carries over and the
  // fork screen is skipped entirely.
  const [creativeType, setCreativeType] = useState(() => ('creativeType' in D ? D.creativeType : (post?.creativeType || null)));
  // null = not yet answered. Only asked in Adaptation - see the gate in
  // handleGenerate that blocks generation if this is true and nothing's
  // been staged as an exact element, so the answer can't just be given
  // and then silently ignored.
  const [hasComplianceElements, setHasComplianceElements] = useState(() => ('hasComplianceElements' in D ? D.hasComplianceElements : (null)));
  // AI detection of what's actually in the uploaded template (logo, key
  // visual, secondary text, compliance text, decorative graphics), and the
  // person's editable preserve/redesign choices derived from it. null =
  // no template uploaded yet / analysis not run. See stageTemplateFile and
  // buildTemplateInstruction (designService.js) for how this flows through.
  const [templateAnalysis, setTemplateAnalysis] = useState(() => ('templateAnalysis' in D ? D.templateAnalysis : (null)));
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);
  // Dotted selection outlines drawn on the template preview for each
  // preserved element. showOutlines is the master on/off; hoveredRegion is
  // the option the pointer is over (so it can be located even if unticked).
  const [showOutlines, setShowOutlines] = useState(true);
  const [hoveredRegion, setHoveredRegion] = useState(null);
  // Per-element box corrections the person made by dragging on the preview, keyed like templateAnalysis.elements.regions.
  const [regionBoxes, setRegionBoxes] = useState(() => ('regionBoxes' in D ? D.regionBoxes : ({})));
  // The preserve/redesign picker opens in a lightbox once the creative has been analysed.
  const [preserveModalOpen, setPreserveModalOpen] = useState(false);
  const [preserveTab, setPreserveTab] = useState('elements');
  const [preservation, setPreservation] = useState(() => ('preservation' in D ? D.preservation : {
    preserveLogo: true,
    preserveKeyVisual: true,
    preserveSecondaryText: true,
    preserveComplianceText: true,
    preserveDecorative: true,
      preserveBackground: true,
    layoutFlexible: false
  }));
  // The literal headline text detected in the uploaded template (see
  // stageTemplateFile) and the person's chosen replacement for it. Only
  // relevant for Creative Adaptation - New Creative writes headlines from
  // scratch per copy direction instead of varying an existing one.
  const [originalHeadline, setOriginalHeadline] = useState(() => ('originalHeadline' in D ? D.originalHeadline : ('')));
  const [headlineOptions, setHeadlineOptions] = useState(() => ('headlineOptions' in D ? D.headlineOptions : ([])));
  const [generatingHeadlines, setGeneratingHeadlines] = useState(false);
  const [headlineError, setHeadlineError] = useState('');
  const [selectedHeadline, setSelectedHeadline] = useState(() => ('selectedHeadline' in D ? D.selectedHeadline : ('')));
  const [customHeadline, setCustomHeadline] = useState(() => ('customHeadline' in D ? D.customHeadline : ('')));
  const [purpose, setPurpose] = useState(() => ('purpose' in D ? D.purpose : (post?.purpose || '')));
  // "Something else..." lets the person type their own purpose; `purpose` always holds the text that is used.
  const [purposeIsOther, setPurposeIsOther] = useState(() => ('purposeIsOther' in D ? D.purposeIsOther : Boolean((post?.purpose) && !PURPOSES.includes(post.purpose))));
  const [purposeOther, setPurposeOther] = useState(() => ('purposeOther' in D ? D.purposeOther : (post?.purpose && !PURPOSES.includes(post.purpose) ? post.purpose : '')));
  const [mediums, setMediums] = useState(() => ('mediums' in D ? D.mediums : (post?.mediums?.length ? post.mediums : [])));
  // The server keeps one brief text; screen 1 owns the context and screen 2 the visual description (joinBrief / splitBrief).
  const initialBrief = splitBrief(post?.briefNote || '');
  const [contextNote, setContextNote] = useState(() => ('contextNote' in D ? D.contextNote : initialBrief.context));
  const [visualNote, setVisualNote] = useState(() => ('visualNote' in D ? D.visualNote : initialBrief.visual));
  const briefNote = joinBrief(contextNote, visualNote);

  // Creative direction - the exhaustive set of controls for steering toward
  // a genuinely on-brief, high-production-value creative rather than a
  // generic one-line image prompt.
  const cb = post?.creativeBrief || {};
  const [moodTags, setMoodTags] = useState(() => ('moodTags' in D ? D.moodTags : (cb.moodTags || [])));
  const [styleReferences, setStyleReferences] = useState(() => ('styleReferences' in D ? D.styleReferences : (cb.styleReferences || [])));
  // Lighting and composition are no longer asked for (the photography guide sets the light; otherwise the AI decides), so they stay empty.
  const [lightingStyle, setLightingStyle] = useState('');
  const [compositionStyle, setCompositionStyle] = useState('');
  const [primaryMessage, setPrimaryMessage] = useState(() => ('primaryMessage' in D ? D.primaryMessage : (cb.primaryMessage || '')));
  const [mustInclude, setMustInclude] = useState(() => ('mustInclude' in D ? D.mustInclude : (cb.mustInclude || '')));
  const [mustAvoid, setMustAvoid] = useState(() => ('mustAvoid' in D ? D.mustAvoid : (cb.mustAvoid || '')));
  // Quality tier is fixed at high-fidelity - no longer a user choice.
  const qualityTier = 'high';
  const [includeTypography, setIncludeTypography] = useState(() => ('includeTypography' in D ? D.includeTypography : (cb.includeTypography ?? true)));
  const [useBrandStyle, setUseBrandStyle] = useState(false); // option hidden in the brief: always off, so no old draft can switch it on unseen
  // Brand guidelines are always followed when the brand has them (there is no on/off tick any more).
  const followBrand = true; // "Follow Brand's Design Language"
  const [peopleMode, setPeopleMode] = useState(() => ('peopleMode' in D ? D.peopleMode : (cb.peopleMode || 'auto'))); // auto | include | none
  const [peopleCount, setPeopleCount] = useState(() => ('peopleCount' in D ? D.peopleCount : (cb.peopleCount || '')));
  const [peopleAge, setPeopleAge] = useState(() => ('peopleAge' in D ? D.peopleAge : (cb.peopleAge || [])));
  const [peopleGender, setPeopleGender] = useState(() => ('peopleGender' in D ? D.peopleGender : (cb.peopleGender || ''))); // '' = no preference | 'Only female' | 'Only male'
  const [peopleStyle, setPeopleStyle] = useState(() => ('peopleStyle' in D ? D.peopleStyle : (cb.peopleStyle || '')));
  // Indian by default; only an explicit deselect (empty string) means "no preference".
  const [peopleEthnicity, setPeopleEthnicity] = useState(() => ('peopleEthnicity' in D ? D.peopleEthnicity : (cb.peopleEthnicity ?? DEFAULT_PEOPLE_ETHNICITY)));
  const [peopleNote, setPeopleNote] = useState(() => ('peopleNote' in D ? D.peopleNote : (cb.peopleNote || '')));
  const [slideCount, setSlideCount] = useState(() => ('slideCount' in D ? D.slideCount : (cb.slideCount || 5)));

  const [suggestingLook, setSuggestingLook] = useState(false);
  const [lookSuggestionError, setLookSuggestionError] = useState('');
  const [lookSuggestionRationale, setLookSuggestionRationale] = useState('');

  const [suggestingMessage, setSuggestingMessage] = useState(false);
  const [messageSuggestionError, setMessageSuggestionError] = useState('');
  const [messageSuggestionRationale, setMessageSuggestionRationale] = useState('');

  // Where the user is in the overall wizard.
  const [stepIndex, setStepIndex] = useState(() => {
    // The step bar on /designs links back here with { briefStep: 'purpose' | 'visual' }.
    const fromBar = MAIN_STEPS.findIndex((s) => s.key === location.state?.briefStep);
    if (fromBar >= 0) return fromBar;
    return 'stepIndex' in D ? Math.min(Number(D.stepIndex) || 0, MAIN_STEPS.length - 1) : 0;
  });

  // Reference creatives - staged locally (no post exists yet at brief time)
  // and uploaded right after the post is created, before navigating on.
  const [stagedReferences, setStagedReferences] = useState(() => ('stagedReferences' in D ? D.stagedReferences : ([]))); // [{file, mode, exact, previewUrl}]
  // Four-way choice: 'include' (AI adapts it into the scene), 'exact'
  // (AI never sees it - pasted onto the finished image unmodified),
  // 'style' (mood/palette reference only, not the literal subject), or
  // 'template' (this reference IS a finished creative - AI preserves its
  // logo/layout/branding and only adapts the copy/message).
  const [referenceMode, setReferenceMode] = useState(() => ('referenceMode' in D ? D.referenceMode : ('include')));
  const referenceFileInputRef = useRef(null);
  const templateFileInputRef = useRef(null);
  const exactElementFileInputRef = useRef(null);

  // Stock photo search (Pexels) - hidden entirely if the server has no
  // PEXELS_API_KEY configured, same graceful-degradation pattern used for
  // AI providers elsewhere in this app.
  const [stockConfigured, setStockConfigured] = useState(false);
  const [showStockSearch, setShowStockSearch] = useState(false);
  const [stockQuery, setStockQuery] = useState('');
  const [stockResults, setStockResults] = useState([]);
  const [stockSearching, setStockSearching] = useState(false);
  const [stockError, setStockError] = useState('');
  const [addingStockId, setAddingStockId] = useState(null);

  const [assets, setAssets] = useState([]);
  const [selectedAssets, setSelectedAssets] = useState(() => ('selectedAssets' in D ? D.selectedAssets : (new Set(post?.selectedAssets || []))));
  const [exactAssets, setExactAssets] = useState(() => ('exactAssets' in D ? D.exactAssets : (new Set(post?.exactAssetIds || []))));

  // Sub-brands (Brand Assets -> Sub-brands). 'auto' reads the brief and picks one; 'main' = the main brand.
  const [subBrands, setSubBrands] = useState([]);
  const [subBrandChoice, setSubBrandChoice] = useState(() => ('subBrandChoice' in D ? D.subBrandChoice : (post?.subBrand ? String(post.subBrand) : 'auto')));
  const [detectedSub, setDetectedSub] = useState(null); // { id, name, matched } from the keyword match

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Navigating back to "Generate Media" (e.g. via the sidebar) re-uses
  // whatever post/brief was last active in WorkflowContext, so returning
  // users land on a pre-filled form rather than a blank one - useful for
  // resuming an interrupted brief, but confusing when the intent was to
  // start a brand new post. This lets them explicitly clear it instead of
  // the page silently deciding for them either way.
  const hadExistingPost = useRef(Boolean(post?._id) || Boolean(briefDraft));
  function startFresh() {
    reset();
    setCreativeType(null);
    setHasComplianceElements(null);
    setTemplateAnalysis(null);
    setAnalyzingTemplate(false);
    setPreservation({
      preserveLogo: true,
      preserveKeyVisual: true,
      preserveSecondaryText: true,
      preserveComplianceText: true,
      preserveDecorative: true,
      preserveBackground: true,
      layoutFlexible: false
    });
    setOriginalHeadline('');
    setHeadlineOptions([]);
    setGeneratingHeadlines(false);
    setHeadlineError('');
    setSelectedHeadline('');
    setCustomHeadline('');
    setPurpose('');
    setPurposeIsOther(false);
    setPurposeOther('');
    setMediums([]);
    setPendingPlatform('');
    setPendingFormatId('');
    setContextNote('');
    setVisualNote('');
    setMoodTags([]);
    setStyleReferences([]);
    setLightingStyle('');
    setCompositionStyle('');
    setPrimaryMessage('');
    setMustInclude('');
    setMustAvoid('');
    setIncludeTypography(true);
    setUseBrandStyle(false);
    setPeopleMode('auto');
    setPeopleCount('');
    setPeopleAge([]);
    setPeopleGender('');
    setPeopleStyle('');
    setPeopleEthnicity(DEFAULT_PEOPLE_ETHNICITY);
    setPeopleNote('');
    setSlideCount(5);
    setStagedReferences([]);
    setReferenceMode('include');
    setSelectedAssets(new Set());
    setExactAssets(new Set());
    setRegionBoxes({});
    setSubBrandChoice('auto');
    setStepIndex(0);
    setError('');
    hadExistingPost.current = false;
  }

  // Switching into Adaptation nudges the reference-mode default toward
  // "template" (since that's almost always what an adaptation actually
  // needs), but only if nothing's staged yet - never silently changes a
  // choice the person already made for references they're mid-upload on.
  function handleSelectCreativeType(type) {
    setCreativeType(type);
    setHasComplianceElements(null);
    setTemplateAnalysis(null);
    setAnalyzingTemplate(false);
    setPreservation({
      preserveLogo: true,
      preserveKeyVisual: true,
      preserveSecondaryText: true,
      preserveComplianceText: true,
      preserveDecorative: true,
      preserveBackground: true,
      layoutFlexible: false
    });
    setOriginalHeadline('');
    setHeadlineOptions([]);
    setGeneratingHeadlines(false);
    setHeadlineError('');
    setSelectedHeadline('');
    setCustomHeadline('');
    // The two modes have different-length step lists (Adaptation skips
    // Generation Settings, Look & feel, Message & constraints, and
    // Reference Creatives) - always restart the wizard at 0 rather than
    // risk stepIndex landing on a different step than intended if someone
    // switches type mid-way via "Change".
    setStepIndex(0);
    if (type === 'adaptation') {
      if (referenceMode === 'include' && stagedReferences.length === 0) setReferenceMode('template');
      // Adaptation strictly follows the uploaded template - clear any
      // creative-direction fields filled in while previously on New
      // Creative, so nothing stale/conflicting leaks into the brief. Their
      // input steps are hidden in this mode, so there'd be no way to
      // notice or fix them otherwise.
      setMoodTags([]);
      setStyleReferences([]);
      setLightingStyle('');
      setCompositionStyle('');
      setPeopleMode('auto');
      setPrimaryMessage('');
      setMustInclude('');
      setMustAvoid('');
      setSelectedAssets(new Set());
      setExactAssets(new Set());
    }
  }

  useEffect(() => {
    brandAssetsApi.list().then(({ assets }) => setAssets((assets || []).filter((a) => a.kind !== 'reference' && a.kind !== 'layout'))).catch(() => setAssets([]));
    brandAssetsApi.listSubBrands().then(({ subBrands: s }) => setSubBrands(s || [])).catch(() => setSubBrands([]));
  }, []);

  // New Creative only: sub-brand guidelines apply here, not to adaptations / resizes / etc.
  const subBrandsOn = creativeType === 'new' && subBrands.length > 0;
  // Live keyword match while the brief is typed (free; the model fallback only runs when the post is created).
  useEffect(() => {
    if (!subBrandsOn || subBrandChoice !== 'auto') { setDetectedSub(null); return undefined; }
    const t = setTimeout(() => {
      brandAssetsApi.detectSubBrand({ purpose, briefNote, primaryMessage }).then(({ subBrand }) => setDetectedSub(subBrand)).catch(() => setDetectedSub(null));
    }, 500);
    return () => clearTimeout(t);
  }, [subBrandsOn, subBrandChoice, purpose, briefNote, primaryMessage]);

  const activeSubId = !subBrandsOn || subBrandChoice === 'main' ? null : (subBrandChoice === 'auto' ? (detectedSub?.id || null) : subBrandChoice);
  const activeSub = activeSubId ? subBrands.find((s) => String(s._id) === String(activeSubId)) || null : null;
  const subBrandIdForApi = subBrandsOn ? (subBrandChoice === 'auto' ? (detectedSub?.id || 'auto') : subBrandChoice) : undefined;
  // A sub-brand shows its own assets (falling back to the main brand's if it has none yet); otherwise the main brand's.
  const visibleAssets = useMemo(() => {
    if (!subBrandsOn) return assets;
    const own = activeSubId ? assets.filter((a) => String(a.subBrand) === String(activeSubId)) : [];
    return own.length ? own : assets.filter((a) => !a.subBrand);
  }, [assets, subBrandsOn, activeSubId]);
  // Switching brand drops selected assets that belong to the other one.
  useEffect(() => {
    if (!subBrandsOn || assets.length === 0) return;
    const ok = new Set(visibleAssets.map((a) => a._id));
    setSelectedAssets((prev) => (prev.size && [...prev].some((id) => !ok.has(id)) ? new Set([...prev].filter((id) => ok.has(id))) : prev));
    setExactAssets((prev) => (prev.size && [...prev].some((id) => !ok.has(id)) ? new Set([...prev].filter((id) => ok.has(id))) : prev));
  }, [visibleAssets, subBrandsOn, assets.length]);

  useEffect(() => {
    stockPhotosApi.status().then(({ configured }) => setStockConfigured(configured)).catch(() => setStockConfigured(false));
  }, []);

  const [costs, setCosts] = useState(null); // GET /ai/cost-estimates - see CostTag usages below
  useEffect(() => {
    aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null));
  }, []);

  // Custom features built in Admin -> Brief Studio and switched on for this workspace (one extra tile each).
  const [customFeatures, setCustomFeatures] = useState([]);
  useEffect(() => {
    customFeaturesApi.list().then(({ features }) => setCustomFeatures(features || [])).catch(() => setCustomFeatures([]));
  }, []);

  const ALL_PLATFORMS = [...new Set(POST_FORMATS.map((f) => f.platform))];
  // Nothing is chosen on a fresh brief: the size dropdown only appears once a platform is picked.
  const [pendingPlatform, setPendingPlatform] = useState(() => ('pendingPlatform' in D ? D.pendingPlatform : (mediums[0] ? catalogPlatformOf(mediums[0]) : '')));
  const [pendingFormatId, setPendingFormatId] = useState(() => ('pendingFormatId' in D ? D.pendingFormatId : (mediums[0] || '')));
  // Remember the whole unsaved brief when leaving this page, so coming back (sidebar, browser back, another step) restores it.
  const draftRef = useRef({});
  draftRef.current = { creativeType, hasComplianceElements, templateAnalysis, regionBoxes, preservation, originalHeadline, headlineOptions, selectedHeadline, customHeadline, purpose, purposeIsOther, purposeOther, mediums, contextNote, visualNote, moodTags, styleReferences, lightingStyle, compositionStyle, primaryMessage, mustInclude, mustAvoid, qualityTier, includeTypography, useBrandStyle, followBrand, peopleMode, peopleCount, peopleAge, peopleGender, peopleStyle, peopleEthnicity, peopleNote, slideCount, stepIndex, stagedReferences, referenceMode, selectedAssets, exactAssets, pendingPlatform, pendingFormatId, subBrandChoice };
  const skipDraftSave = useRef(false); // set once the brief has been saved as a post - nothing left to restore
  useEffect(() => () => { if (!skipDraftSave.current) setBriefDraft(draftRef.current); }, [setBriefDraft]);

  // The shared size picker (platform first, then the sizes for it). Carousel and video placements are not in that list,
  // so they stay available through the "Carousel or video format" select below it.
  function handleSizeChange({ platform, formatId }) {
    setPendingPlatform(platform);
    setPendingFormatId(formatId || '');
    setMediums(formatId ? [formatId] : []);
  }
  const OTHER_FORMATS = POST_FORMATS.filter((f) => f.isCarousel || f.isVideo);
  function handleOtherFormat(formatId) {
    setPendingPlatform('');
    setPendingFormatId(formatId);
    setMediums(formatId ? [formatId] : []);
  }

  function toggleFrom(setter) {
    return (value) => setter((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
  }
  const toggleMood = toggleFrom(setMoodTags);
  const toggleStyleReference = toggleFrom(setStyleReferences);
  const togglePeopleAge = toggleFrom(setPeopleAge);
  // Mood is capped (the reference picks up to three) and the visual style is a single choice.
  function toggleMoodCapped(value, max = 3) {
    setMoodTags((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : prev.length >= max ? prev : [...prev, value]));
  }
  function pickStyle(value) {
    setStyleReferences((prev) => (prev.includes(value) ? [] : [value]));
  }
  function pickPurpose(value) {
    if (value === '__other') {
      setPurposeIsOther(true);
      setPurpose(purposeOther.trim());
    } else {
      setPurposeIsOther(false);
      setPurpose(value);
    }
  }
  function changePurposeOther(value) {
    setPurposeOther(value);
    setPurpose(value.trim());
  }
  function setSlideCountClamped(raw) {
    const { minSlides, maxSlides } = getFormat(pendingFormatId);
    setSlideCount(Math.min(Math.max(Number(raw) || minSlides, minSlides), maxSlides));
  }

  async function handleSuggestLookAndFeel() {
    setSuggestingLook(true);
    setLookSuggestionError('');
    setLookSuggestionRationale('');
    try {
      const { moodTags: mt, styleReferences: sr, lightingStyle: ls, compositionStyle: cs, rationale } =
        await postsApi.suggestLookAndFeel({ purpose, briefNote, mediums, followBrand, subBrandId: subBrandIdForApi });
      setMoodTags(mt);
      setStyleReferences(sr);
      if (ls) setLightingStyle(ls);
      if (cs) setCompositionStyle(cs);
      setLookSuggestionRationale(rationale || '');
    } catch (e) {
      setLookSuggestionError(apiErrorInfo(e));
    } finally {
      setSuggestingLook(false);
    }
  }

  // "Suggest" on one section at a time. The look-and-feel call returns mood, style, lighting and composition; each link
  // applies only its own part. The visual description is drafted from the message call.
  const [suggestBusy, setSuggestBusy] = useState('');
  const [suggestErr, setSuggestErr] = useState({ section: '', error: '' });
  const [suggestNote, setSuggestNote] = useState({ section: '', text: '' });
  // "Suggest" on Context in brief and Key message is a single suggestion: it is written straight into the box (Undo puts the old text back).
  const [briefIdea, setBriefIdea] = useState('');
  const [messageIdea, setMessageIdea] = useState(null); // { primaryMessage, mustInclude, mustAvoid }
  // Undo for every Suggest / Improve on this screen: each applied suggestion remembers what the field held before.
  const [undoMap, setUndoMap] = useState({});
  const rememberUndo = (section, restore) => setUndoMap((m) => ({ ...m, [section]: restore }));
  const canUndo = (section) => Boolean(undoMap[section]);
  function undoSection(section) {
    const fn = undoMap[section];
    if (fn) fn();
    setUndoMap((m) => { const n = { ...m }; delete n[section]; return n; });
  }
  function applyBriefIdea() {
    if (briefIdea) {
      const prev = contextNote;
      rememberUndo('brief', () => setContextNote(prev));
      setContextNote(briefIdea.slice(0, 600));
    }
    setBriefIdea('');
  }
  function applyMessageIdea() {
    if (!messageIdea) return;
    if (messageIdea.primaryMessage) {
      const prev = primaryMessage;
      rememberUndo('message', () => setPrimaryMessage(prev));
      setPrimaryMessage(messageIdea.primaryMessage);
    }
    // Must include / Must avoid are typed by the person only; a suggestion never fills or clears them.
    setMessageIdea(null);
  }
  async function suggestSection(section) {
    if (section === 'brief') setBriefIdea('');
    setSuggestBusy(section);
    setSuggestErr({ section: '', error: '' });
    setSuggestNote({ section: '', text: '' });
    try {
      if (section === 'brief' || section === 'visual') {
        // One message call drafts both: the context in brief leads with the key message, the visual description with what to show.
        const improve = section === 'brief'
          ? (contextNote.trim() ? { field: 'contextBrief', text: contextNote } : null)
          : (visualNote.trim() ? { field: 'visualDescription', text: visualNote } : null);
        const r = await postsApi.suggestMessage({ purpose, briefNote, mediums, moodTags, styleReferences, followBrand, subBrandId: subBrandIdForApi, primaryMessage, improve });
        if (section === 'brief') {
          const draft = (r.contextBrief || r.primaryMessage || '').trim();
          if (draft) {
            const prev = contextNote;
            rememberUndo('brief', () => setContextNote(prev));
            setContextNote(draft.slice(0, 600));
          }
        } else {
          const draft = (r.visualDescription || '').trim() || [r.mustInclude ? `Show ${r.mustInclude}.` : '', r.primaryMessage ? `The image should carry the idea: ${r.primaryMessage}` : ''].filter(Boolean).join(' ');
          if (draft) setVisualNote(draft.slice(0, 400));
        }
        setSuggestNote({ section, text: r.rationale || '' });
      } else {
        // The suggestion is made for THIS brief: it reads the context in brief, the key message and whatever else is already chosen.
        const people = { peopleMode, peopleCount, peopleAge, peopleGender, peopleStyle, peopleNote };
        const r = await postsApi.suggestLookAndFeel({ purpose, briefNote, mediums, followBrand, subBrandId: subBrandIdForApi, section, primaryMessage, moodTags, styleReferences, people });
        if (section === 'mood') {
          const prev = moodTags;
          rememberUndo('mood', () => setMoodTags(prev));
          setMoodTags((r.moodTags || []).slice(0, 3));
        }
        if (section === 'style') {
          const prev = styleReferences;
          rememberUndo('style', () => setStyleReferences(prev));
          setStyleReferences((r.styleReferences || []).slice(0, 1));
        }
        if (section === 'people') {
          const prev = { peopleMode, peopleCount, peopleAge, peopleGender, peopleStyle, peopleNote };
          rememberUndo('people', () => { setPeopleMode(prev.peopleMode); setPeopleCount(prev.peopleCount); setPeopleAge(prev.peopleAge); setPeopleGender(prev.peopleGender); setPeopleStyle(prev.peopleStyle); setPeopleNote(prev.peopleNote); });
          setPeopleMode(r.peopleMode === 'include' ? 'include' : 'none');
          if (r.peopleMode === 'include') {
            if (r.peopleCount) setPeopleCount(r.peopleCount);
            if ((r.peopleAge || []).length) setPeopleAge(r.peopleAge);
            if (r.peopleGender) setPeopleGender(r.peopleGender);
            if (r.peopleStyle) setPeopleStyle(r.peopleStyle);
            if (r.peopleNote) setPeopleNote(r.peopleNote);
          }
        }
        setSuggestNote({ section, text: r.rationale || '' });
      }
    } catch (e) {
      setSuggestErr({ section, error: apiErrorInfo(e) });
    } finally {
      setSuggestBusy('');
    }
  }
  const sugProps = (section) => ({
    onSuggest: () => suggestSection(section),
    loading: suggestBusy === section,
    error: suggestErr.section === section ? suggestErr.error : '',
    rationale: suggestNote.section === section ? suggestNote.text : ''
  });

  async function handleSuggestMessage() {
    setMessageIdea(null);
    setSuggestingMessage(true);
    setMessageSuggestionError('');
    setMessageSuggestionRationale('');
    try {
      const { primaryMessage: pm, mustInclude: mi, mustAvoid: ma, rationale } =
        await postsApi.suggestMessage({ purpose, briefNote, mediums, moodTags, styleReferences, followBrand, subBrandId: subBrandIdForApi, primaryMessage, improve: primaryMessage.trim() ? { field: 'primaryMessage', text: primaryMessage } : null });
      if (pm) {
        const prev = primaryMessage;
        rememberUndo('message', () => setPrimaryMessage(prev));
        setPrimaryMessage(pm.slice(0, 160)); // Must include / Must avoid are typed by the person only; a suggestion never fills or clears them.
      }
      setMessageSuggestionRationale(rationale || '');
    } catch (e) {
      setMessageSuggestionError(apiErrorInfo(e));
    } finally {
      setSuggestingMessage(false);
    }
  }

  function toggleAsset(id) {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Deselecting an asset should never leave a stale "keep exact" flag behind.
        setExactAssets((prevExact) => {
          if (!prevExact.has(id)) return prevExact;
          const nextExact = new Set(prevExact);
          nextExact.delete(id);
          return nextExact;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleExactAsset(id, e) {
    e.stopPropagation(); // don't also toggle selection when clicking the checkbox
    setExactAssets((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // How an already-added reference is used: 'include' | 'exact' | 'style' | 'template'.
  function setStagedMode(index, mode) {
    setStagedReferences((prev) => prev.map((r, i) => (i === index ? { ...r, mode: mode === 'exact' ? 'include' : mode, exact: mode === 'exact' } : r)));
  }

  function stageReferenceFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Adaptation has no UI to pick a reference mode (the Reference Creatives
    // step is skipped entirely) - always template, never whatever stale
    // referenceMode value might be left over from a prior New Creative session.
    const mode =
      creativeType === 'adaptation' ? 'template' : referenceMode === 'style' ? 'style' : referenceMode === 'template' ? 'template' : 'include';
    const exact = creativeType !== 'adaptation' && referenceMode === 'exact';
    setStagedReferences((prev) => [...prev, { file, mode, exact, previewUrl: URL.createObjectURL(file) }]);
  }

  // Separate from the main template upload above - this is specifically
  // for elements that must be guaranteed pixel-perfect (a logo, a QR code,
  // compliance/registration text). Always exact:true regardless of
  // referenceMode, and defaults to bottom-right until the person picks a
  // different corner via setStagedReferenceAnchor. See
  // compositeExactAssets.js for how multiple corners get laid out.
  function stageExactElement(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStagedReferences((prev) => [
      ...prev,
      { file, mode: 'include', exact: true, anchor: 'bottom-right', previewUrl: URL.createObjectURL(file) }
    ]);
  }

  function setStagedReferenceAnchor(index, anchor) {
    setStagedReferences((prev) => prev.map((r, i) => (i === index ? { ...r, anchor } : r)));
  }

  async function handleGenerateHeadlineVariations() {
    setGeneratingHeadlines(true);
    setHeadlineError('');
    try {
      const { variations } = await aiApi.generateHeadlineVariations({ originalHeadline, purpose, briefNote });
      setHeadlineOptions(variations || []);
    } catch (err) {
      setHeadlineError(apiErrorInfo(err));
    } finally {
      setGeneratingHeadlines(false);
    }
  }

  // The main "Creative to adapt" upload for Creative Adaptation. Separate
  // from stageReferenceFile above because this one also triggers AI
  // detection of what's actually in the image (logo, key visual, secondary
  // text, compliance text, decorative graphics) so the preservation
  // checkboxes below can default to what's actually there, rather than
  // the person having to identify every element themselves. Detection
  // failing is never treated as blocking - it falls back to "assume
  // everything should be preserved" (the safer default) either way.
  async function stageTemplateFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Re-uploading replaces the current original (and everything derived from it).
    setStagedReferences((prev) => {
      prev.filter((r) => r.mode === 'template').forEach((r) => URL.revokeObjectURL(r.previewUrl));
      return [...prev.filter((r) => r.mode !== 'template'), { file, mode: 'template', exact: false, previewUrl: URL.createObjectURL(file) }];
    });
    setTemplateAnalysis(null);
    setRegionBoxes({});
    setHoveredRegion(null);
    setOriginalHeadline('');
    setHeadlineOptions([]);
    setSelectedHeadline('');
    setCustomHeadline('');
    setPreservation((p) => ({ ...p, protectedRegions: [] }));
    setPreserveModalOpen(false);
    setAnalyzingTemplate(true);
    try {
      const result = await aiApi.analyzeTemplate(file);
      setTemplateAnalysis(result);
      setPreserveModalOpen(true);
      if (result.detected) {
        setPreservation((prev) => ({
          protectedRegions: prev.protectedRegions || [],
          customInstruction: prev.customInstruction || '',
          preserveLogo: result.elements.hasLogo,
          preserveKeyVisual: result.elements.hasKeyVisual,
          preserveSecondaryText: result.elements.hasSecondaryText,
          preserveComplianceText: result.elements.hasComplianceText,
          preserveDecorative: result.elements.hasDecorativeGraphics,
          preserveBackground: result.elements.hasBackground,
          ...(result.elements.hasPrimaryHeadline && result.elements.primaryHeadlineText ? { preservePrimaryHeadline: true } : {}),
          layoutFlexible: false
        }));
        // We now KNOW rather than have to ask - answer the compliance
        // question automatically instead of leaving it for the person to
        // notice and self-report.
        if (result.elements.hasComplianceText) setHasComplianceElements(true);
        if (result.elements.hasPrimaryHeadline && result.elements.primaryHeadlineText) {
          setOriginalHeadline(result.elements.primaryHeadlineText);
        }
      }
    } catch (err) {
      setTemplateAnalysis({ detected: false, reason: 'Analysis failed - defaulting to preserving everything. Use Review & edit to adjust.' });
      setPreserveModalOpen(true);
    } finally {
      setAnalyzingTemplate(false);
    }
  }

  function unstageReference(index) {
    setStagedReferences((prev) => {
      const removed = prev[index];
      URL.revokeObjectURL(removed.previewUrl);
      if (removed.mode === 'template') {
        setTemplateAnalysis(null);
        setAnalyzingTemplate(false);
        setOriginalHeadline('');
        setHeadlineOptions([]);
        setSelectedHeadline('');
        setCustomHeadline('');
        setPreservation((p) => ({ ...p, protectedRegions: [] }));
        setHoveredRegion(null);
        setRegionBoxes({});
        setPreserveModalOpen(false);
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleStockSearch(e) {
    e?.preventDefault();
    if (!stockQuery.trim()) return;
    setStockSearching(true);
    setStockError('');
    try {
      const { photos } = await stockPhotosApi.search(stockQuery.trim());
      setStockResults(photos);
    } catch (err) {
      setStockError(apiErrorMessage(err));
      setStockResults([]);
    } finally {
      setStockSearching(false);
    }
  }

  // Downloads the chosen stock photo client-side and stages it as a real
  // File, so it flows through the exact same upload pipeline as a locally
  // picked file (postsApi.uploadReference) - no server-side changes needed
  // beyond the search itself.
  async function handleAddStockPhoto(photo) {
    setAddingStockId(photo.id);
    setStockError('');
    try {
      const res = await fetch(photo.fullUrl);
      if (!res.ok) throw new Error('Could not download that image.');
      const blob = await res.blob();
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const file = new File([blob], `pexels-${photo.id}.${ext}`, { type: blob.type });
      const mode = referenceMode === 'style' ? 'style' : referenceMode === 'template' ? 'template' : 'include';
      const exact = referenceMode === 'exact';
      setStagedReferences((prev) => [
        ...prev,
        { file, mode, exact, previewUrl: photo.previewUrl, credit: photo.photographer ? `Photo by ${photo.photographer} on Pexels` : '' }
      ]);
    } catch (err) {
      setStockError(apiErrorMessage(err));
    } finally {
      setAddingStockId(null);
    }
  }

  // Opens the full stock-photo search results as a browsable lightbox set -
  // prev/next arrows page through every result, and the "Select Photo" CTA
  // calls the exact same handleAddStockPhoto used by the grid's quick-add
  // "+" button, just reached from inside the lightbox instead.
  function openStockLightbox(startIndex) {
    openLightbox({
      index: startIndex,
      items: stockResults.map((photo) => ({
        src: photo.fullUrl || photo.previewUrl,
        alt: photo.alt || 'Stock photo',
        title: photo.alt || 'Stock photo',
        meta: [
          { label: 'Photographer', value: photo.photographer || 'Unknown' },
          { label: 'Source', value: 'Pexels' }
        ],
        data: photo
      })),
      cta: {
        label: referenceMode === 'style' ? 'Select as style reference' : referenceMode === 'exact' ? 'Select as exact asset' : referenceMode === 'template' ? 'Select as template' : 'Select Photo',
        onClick: (item) => handleAddStockPhoto(item.data)
      }
    });
  }

  async function handleGenerate({ resetDesigns = false } = {}) {
    if (!purpose.trim() || mediums.length === 0) { setStepIndex(0); return; } // the first screen still needs a purpose and a size
    setError('');
    setLoading(true);
    try {
      const briefPayload = {
        creativeType,
        purpose,
        mediums: mediums.length ? mediums : ['instagram_feed'],
        briefNote,
        selectedAssets: [...selectedAssets],
        exactAssetIds: [...exactAssets],
        ...(subBrandsOn ? { subBrandId: subBrandIdForApi } : {}),
        creativeBrief: {
          moodTags,
          styleReferences,
          lightingStyle,
          compositionStyle,
          primaryMessage,
          mustInclude,
          mustAvoid,
          qualityTier,
          useBrandStyle,
          followBrand,
          peopleMode,
          peopleCount: peopleMode === 'include' ? peopleCount : '',
          peopleAge: peopleMode === 'include' ? peopleAge : [],
          peopleGender: peopleMode === 'include' ? peopleGender : '',
          peopleStyle: peopleMode === 'include' ? peopleStyle : '',
          peopleEthnicity: peopleMode === 'include' ? peopleEthnicity : '',
          peopleNote: peopleMode === 'include' ? peopleNote : '',
          // Adaptation with a detected original headline means the
          // template inherently has baked-in text to preserve/vary - the
          // "no baked-in text, leave clean caption space" default (which
          // makes sense for New Creative) would directly contradict the
          // template-preservation instruction telling the model to
          // reproduce the headline. Force it on in that specific case;
          // otherwise leave whatever New Creative's Generation Settings
          // step actually set.
          includeTypography: creativeType === 'adaptation' && originalHeadline ? true : includeTypography,
          slideCount,
          ...(creativeType === 'adaptation' && originalHeadline ? { headlineText: preservation.preservePrimaryHeadline === false ? selectedHeadline : originalHeadline } : {}),
          ...(creativeType === 'adaptation' ? { templatePreservation: preservation } : {})
        }
      };

      // Revisiting an existing post (e.g. navigated back from Step 02/03)
      // updates it in place, preserving whatever was already generated -
      // only a genuinely new post (no post in context yet) creates one.
      // Designs are only ever wiped when resetDesigns is explicitly
      // requested via the separate "Start over" action below.
      const { post: saved } = post?._id
        ? await postsApi.update(post._id, { ...briefPayload, ...(resetDesigns ? { resetDesigns: true } : {}) })
        : await postsApi.create(briefPayload);

      // References need a real post to attach to, so they're uploaded here
      // rather than at creation time. Best-effort: one failing shouldn't
      // block the workflow (Step 02 has the same uploader to re-add it).
      for (const ref of stagedReferences) {
        try {
          await postsApi.uploadReference(saved._id, ref.file, ref.mode, ref.exact, ref.anchor || 'bottom-right');
        } catch (err) {
          console.warn('Reference creative failed to upload:', ref.file.name, err);
        }
      }
      stagedReferences.forEach((ref) => URL.revokeObjectURL(ref.previewUrl));
      setStagedReferences([]);

      skipDraftSave.current = true;
      setBriefDraft(null);
      setPost(saved);
      navigate('/designs');
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setLoading(false);
    }
  }

  const hasExistingDesigns = (post?.designs?.length || 0) > 1;

  function handleStartOver() {
    if (!window.confirm('This will discard your current creative directions and any generated images for this post. Continue?')) return;
    handleGenerate({ resetDesigns: true });
  }

  const preview = post?.designs?.[0];
  // Creative Adaptation strictly follows the uploaded template rather than
  // taking new creative direction, so Look & feel (mood/style/lighting/
  // composition) and Message & constraints (primary message/must-include/
  // must-avoid) would just be conflicting instructions fighting the "keep
  // it as close to the original as possible" instruction already baked
  // into template mode. Reference Creatives (the general-purpose, four-mode
  // picker) is also skipped in favor of a single-purpose upload folded
  // directly into Basics below - Adaptation only ever needs one thing
  // (the template), not brand-asset selection/stock search/style refs.
  const activeSteps =
    creativeType === 'adaptation' ? MAIN_STEPS.filter((s) => !['look', 'message', 'sources'].includes(s.key)) : MAIN_STEPS;
  const step = activeSteps[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === activeSteps.length - 1;

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, activeSteps.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const creativeDirectionCount = [
    moodTags.length > 0,
    styleReferences.length > 0,
    Boolean(lightingStyle),
    Boolean(compositionStyle),
    Boolean(primaryMessage.trim()),
    Boolean(mustInclude.trim()),
    Boolean(mustAvoid.trim()),
    peopleMode !== 'auto',
    stagedReferences.length > 0
  ].filter(Boolean).length;

  // Leaving the brief (sidebar link / Back) asks first once anything has been entered or the person is past step 1.
  const briefHasProgress = !atHome && (creativeType === 'new' || creativeType === 'adaptation')
    && (stepIndex > 0 || creativeDirectionCount > 0 || Boolean(briefNote.trim()) || mediums.length > 0);
  useLeaveGuard(briefHasProgress);

  // Start screen - shown before a flow is chosen, or whenever the person opens Generate Media from the sidebar.
  // Deliberately rendered without the numbered Stepper (Layout only shows it when `step` is passed) since
  // choosing a flow isn't itself a step.
  const customNames = Object.fromEntries(customFeatures.map((cf) => [cf.id, cf.name]));
  const activeTask = getActiveTask({ post, creativeType, stepIndex, customNames });

  // Starts a flow from the start screen. Every flow keeps its existing journey; if another task is still in
  // progress it is replaced (a saved post stays in Saved Documents).
  async function startFlow(type, extra) {
    if (viewOnly) return;
    // Storage full: ask the person to delete old assets before any flow opens.
    try {
      const u = await postsApi.storage(true);
      if (u && !u.unscoped && u.limitBytes && u.usedBytes >= u.limitBytes) {
        window.dispatchEvent(new CustomEvent('automatr:storage-full', { detail: u }));
        return;
      }
    } catch { /* could not measure: the server still checks on every generate */ }
    // No confirm: starting a new task silently replaces the one in progress. Always start clean - even when there is no
    // resumable task (e.g. the last creative was finished), the old brief and post must not leak into the new one.
    startFresh();
    if (type === 'multiscene') setSceneHandoff(extra); // a template to prefill, or an earlier reel to open
    handleSelectCreativeType(type);
    setAtHome(false);
  }

  // Finish Up: back into the task in progress, at the step it had reached.
  function resumeTask(task) {
    if (!task) return;
    if (task.route === '/generate') setAtHome(false);
    else navigate(task.route);
  }

  // "Adapt now" / "Convert now" cards on the last screens of other flows land here with { start: 'resize' | 'convert' }.
  const startedFromHandoff = useRef(false);
  useEffect(() => {
    const kind = location.state?.start;
    if (!kind || startedFromHandoff.current) return;
    startedFromHandoff.current = true;
    if (location.state?.restart) startFresh(); // "Restart" on the New Creative last screen: wipe the brief and start from scratch
    startFlow(kind === 'edit' ? 'adaptation' : kind); // 'edit' = Fine-tune from New Creative -> Creative Edit
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!creativeType || atHome) {
    return (
      <Layout eyebrow="Get started" title="Generate Media">
        <GenerateHome activeTask={activeTask} customFeatures={customFeatures} onStart={startFlow} onResume={resumeTask} viewOnly={viewOnly} />
      </Layout>
    );
  }

  // A custom feature from Brief Studio ("custom:<id>") - its own form + run, never enters the post wizard.
  if (typeof creativeType === 'string' && creativeType.startsWith('custom:')) {
    return <CustomFeatureRunner key={creativeType} featureId={creativeType.slice('custom:'.length)} onBack={startFresh} />;
  }

  // "Quick Adapt" - upload a finished creative and go straight to Adapt Creative.
  if (creativeType === 'resize') {
    return <AdaptEditor onBack={startFresh} />;
  }

  // "Convert to Video" - upload an image, pick its motion and video size, download the video.
  if (creativeType === 'convert') {
    return <ConvertVideoEditor onBack={startFresh} />;
  }

  // "Multi-scene Video" (Made for You) - setup, scenes, generate, download.
  if (creativeType === 'multiscene' && features.multiSceneVideo) {
    return <MultiSceneStudio onBack={startFresh} />;
  }

  // "Change Hero Image Only" - same short flow as Edit Headline Only, for the main image.
  if (creativeType === 'hero') {
    return <HeroEditor onBack={startFresh} />;
  }

  // "Creative Edit" - upload, review the elements (keep / edit / remove), choose a size, download.
  if (creativeType === 'adaptation') {
    return <CreativeEditor onBack={startFresh} />;
  }

  // "Edit Headline Only" is its own short flow (upload -> edit text -> Modify -> Publish)
  // with none of the brief steps, so it renders its own page.
  if (creativeType === 'headline') {
    return <HeadlineEditor onBack={startFresh} />;
  }

  const otherFormatPicked = OTHER_FORMATS.some((f) => f.id === pendingFormatId);
  const canContinueFromPurpose = Boolean(purpose.trim()) && mediums.length > 0;

  // Everything the two brief screens need, in one place (see NewCreativeBrief.jsx).
  const briefProps = {
    step, goNext, goBack, loading, hasExistingDesigns, handleGenerate, handleStartOver, costs,
    purposes: PURPOSES, purpose, purposeIsOther, purposeOther, pickPurpose, setPurposeOther: changePurposeOther,
    mediums, pendingPlatform, pendingFormatId, otherFormatPicked, otherFormats: OTHER_FORMATS,
    onSizeChange: handleSizeChange, onOtherFormat: handleOtherFormat, slideCount, setSlideCountClamped,
    canContinueFromPurpose,
    contextNote, setContextNote, visualNote, setVisualNote, primaryMessage, setPrimaryMessage,
    mustInclude, setMustInclude, mustAvoid, setMustAvoid,
    suggestSection, suggestBusy, suggestErr, suggestNote, briefIdea, applyBriefIdea, messageIdea, applyMessageIdea, canUndo, undoSection,
    handleSuggestMessage, suggestingMessage, messageSuggestionError, messageSuggestionRationale,
    moodOptions: MOOD_TAGS, moodTags, toggleMood: toggleMoodCapped,
    styleOptions: STYLE_REFERENCES, styleReferences, pickStyle,
    lightingOptions: LIGHTING_STYLES, lightingStyle, setLightingStyle,
    compositionOptions: COMPOSITION_STYLES, compositionStyle, setCompositionStyle,
    peopleMode, setPeopleMode, peopleCount, setPeopleCount, peopleAge, togglePeopleAge, peopleGender, setPeopleGender,
    peopleEthnicity, setPeopleEthnicity, peopleStyle, setPeopleStyle, peopleNote, setPeopleNote,
    peopleCounts: PEOPLE_COUNTS, peopleAges: PEOPLE_AGES, peopleGenders: PEOPLE_GENDERS, peopleEthnicities: PEOPLE_ETHNICITIES, peopleStyles: PEOPLE_STYLES,
    referenceMode, setReferenceMode, stagedReferences, unstageReference, setStagedMode,
    openReferencePicker: () => { setReferenceMode('include'); referenceFileInputRef.current?.click(); },
    stockConfigured, showStockSearch, setShowStockSearch, stockQuery, setStockQuery, stockResults, stockSearching, stockError,
    addingStockId, handleStockSearch, handleAddStockPhoto, openStockLightbox,
    assets: visibleAssets, subBrandsOn, subBrands, subBrandChoice, setSubBrandChoice, detectedSub, activeSub, selectedAssets, exactAssets, toggleAsset, toggleExactAsset, followBrand, useBrandStyle, setUseBrandStyle
  };

  return (
    <Layout
      title="Generate Media"
      step={step.key === 'visual' ? 'visual' : 'purpose'}
      flow="new"
      rail
      onStep={(key) => {
        if (key === 'directions') { navigate('/designs', { state: { directions: true } }); return; }
        if (key === 'messaging') { navigate('/designs', { state: { messaging: true } }); return; }
        const idx = activeSteps.findIndex((x) => x.key === key);
        if (idx >= 0) setStepIndex(idx);
      }}
      reachable={[...(canContinueFromPurpose ? ['purpose', 'visual'] : ['purpose']), ...(hasExistingDesigns ? ['directions', 'messaging'] : [])]}
    >
      <AiErrorNotice error={error} />

      <input ref={referenceFileInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={stageReferenceFile} />

      <NewCreativeBrief s={briefProps} />
    </Layout>
  );
}
