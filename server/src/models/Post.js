import mongoose from 'mongoose';
import tenantPlugin from '../tenant/tenantPlugin.js';

const imageOptionSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, default: '' },
    imagePrompt: { type: String, default: '' },
    background: { type: String, default: '' },
    imageModel: { type: String, default: '' },
    imageNote: { type: String, default: '' },
    // Set when imageNote is due to an out-of-credits/quota failure - lets
    // the client offer a direct "Add credits" link instead of a dead end.
    imageBillingUrl: { type: String, default: '' },
    imageBillingProviderLabel: { type: String, default: '' }
  },
  { _id: false }
);

// A version of the variant's master creative, AI-adapted for a different
// platform/format (different aspect ratio) - see
// services/ai/designService.js portImageToFormat.
const formatVariantSchema = new mongoose.Schema(
  {
    formatId: { type: String, required: true }, // e.g. "linkedin_feed" - see constants/postFormats.js
    imageUrl: { type: String, default: '' },
    imageModel: { type: String, default: '' },
    imageNote: { type: String, default: '' },
    imageBillingUrl: { type: String, default: '' },
    imageBillingProviderLabel: { type: String, default: '' },
    // Size Adapt batch (adaptVariantSizes): 'pending' while the size is being made, then 'done' / 'failed'.
    // Older entries have no status and default to 'done'.
    status: { type: String, enum: ['pending', 'done', 'failed'], default: 'done' },
    startedAt: { type: Date }
  },
  { _id: false }
);

// A video generation job for this variant. Video gen is async (submit,
// then poll) unlike the synchronous image calls, so this tracks job state
// explicitly rather than just an imageUrl - see services/ai/videoRouter.js.
const videoJobSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true }, // "veo" | "kling" | "runway" | "seedance"
    externalJobId: { type: String, required: true }, // the provider's own task/operation id, for polling
    // Provider-specific polling detail some providers need alongside
    // externalJobId - currently only Kling, whose image-to-video and
    // text-to-video jobs live under different endpoint paths
    // (image2video/text2video) that must be polled the same way they were
    // submitted. Empty/unset for providers where this doesn't apply.
    providerMeta: { type: mongoose.Schema.Types.Mixed, default: undefined },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    prompt: { type: String, default: '' },
    videoUrl: { type: String, default: '' }, // local /uploads/... path once downloaded
    note: { type: String, default: '' }, // failure reason, if any
    // Which format this job was generated for - the variant's own primary
    // medium by default, or a specific video format id when this job came
    // from porting the variant to another platform/placement (see
    // portVariantToFormats in posts.controller.js). Empty string is treated
    // as "the post's primary medium" for jobs created before this field existed.
    formatId: { type: String, default: '' },
    // Whether this job animated the actual approved key visual image
    // (image-to-video) or generated a brand-new scene from text alone -
    // see buildVideoPrompt in designService.js. Shown in the UI so it's
    // clear at a glance which kind of result a given job is.
    sourceMode: { type: String, enum: ['animate_kv', 'new_scene'], default: 'new_scene' },
    // Titles of the animation ideas the person ticked before generating (see
    // videoIdeasService.js) - shown with the finished video. Empty when a plain
    // preset motion style was used instead.
    ideaTitles: { type: [String], default: [] },
    // True when a headline / text animation idea was ticked - the text-lock step is skipped for these videos.
    textAnimated: { type: Boolean, default: false },
    // Art-director feedback applied to this video (see applyVideoFeedback in designService.js); carried forward to later regenerations.
    feedback: { type: String, default: '' },
    // "Convert to Video" / New Creative video size: the exact pixel size the person asked for (the clip is cropped to it after the model finishes).
    requestedSize: { w: { type: Number, default: 0 }, h: { type: Number, default: 0 } },
    aspectRatio: { type: String, default: '' }, // the model aspect ratio actually requested
    // Moderator check ("Check quality" tick on Convert to Video): after the clip is made it is inspected frame by frame and,
    // if it has visible defects (extra fingers, warped faces, garbled lettering...), made once more with a fix. The job stays
    // 'processing' (same externalJobId) while this runs, so the client keeps polling the same id.
    qualityCheck: { type: Boolean, default: false },
    qcStage: { type: String, enum: ['', 'checking', 'fixing'], default: '' },
    qcStartedAt: { type: Date },
    qcFirstUrl: { type: String, default: '' }, // the first attempt, kept when a fixed version replaces it
    qcIssues: { type: [String], default: [] },
    qcResult: { type: String, enum: ['', 'passed', 'fixed', 'kept_original', 'skipped'], default: '' },
    qcAttempt: { type: Number, default: 0 }, // corrected re-makes started so far (each one is re-checked, up to the server limit)
    qcMax: { type: Number, default: 0 }, // how many re-makes this job may use
    qcNotes: { type: [String], default: [] }, // the corrections asked for so far, carried into every later attempt
    qcBestUrl: { type: String, default: '' }, // the clip with the fewest defects so far
    qcBestIssueCount: { type: Number, default: 0 },
    fixJobId: { type: String, default: '' },
    fixProvider: { type: String, default: '' },
    fixMeta: { type: mongoose.Schema.Types.Mixed, default: undefined },
    motionStyle: { type: String, default: '' }, // 'ambient' | 'zoom_in' | 'zoom_out' | 'pan' - only meaningful for sourceMode:'animate_kv'
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

// One slide/frame of a carousel (Instagram/Facebook/LinkedIn carousel, or
// an X multi-image post). Each slide is generated with a narrative "role"
// (hook, context, solution, etc.) so the set reads as a coherent sequence
// rather than N unrelated images - see designService.js#generateCarouselForVariant.
const carouselSlideSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    slideRole: { type: String, default: '' }, // e.g. "Hook", "Problem", "Solution", "Call to action"
    imageUrl: { type: String, default: '' },
    imagePrompt: { type: String, default: '' },
    imageModel: { type: String, default: '' },
    imageNote: { type: String, default: '' },
    imageBillingUrl: { type: String, default: '' },
    imageBillingProviderLabel: { type: String, default: '' }
  },
  { _id: false }
);

const designVariantSchema = new mongoose.Schema(
  {
    label: { type: String, required: true }, // "Variant A", "Variant B", ...
    angle: { type: String, default: '' }, // internal creative-direction descriptor for this variant (the visual treatment fed to the image prompt)
    // What the Creative directions card shows: a short concept name and one or two sentences on the idea. Empty on older posts.
    directionTitle: { type: String, default: '' },
    directionIdea: { type: String, default: '' },
    caption: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    imagePrompt: { type: String, default: '' },
    background: { type: String, default: '' }, // CSS gradient fallback when no image model is configured
    textModel: { type: String, default: '' },
    imageModel: { type: String, default: '' },
    imageNote: { type: String, default: '' }, // set when imageModel is "placeholder", explaining why
    imageBillingUrl: { type: String, default: '' },
    imageBillingProviderLabel: { type: String, default: '' },
    // One-level undo for the "Fix an area" touch-up tool - holds the image
    // right before the last region edit was applied, so a bad touch-up can
    // be reverted without burning another generation call. Cleared (not
    // chained) on the next edit, upload, or full regenerate - this is a
    // single undo step, not a history stack.
    previousImageUrl: { type: String, default: '' },
    // The untouched creative the person uploaded for Edit Headline Only / Change Hero Image Only,
    // so Saved Documents can open the true original next to the edited result.
    originalImageUrl: { type: String, default: '' },
    // Once this copy direction is chosen, up to 3 candidate images are
    // generated here; picking one copies it into the fields above as the
    // canonical image (the "master creative") for this variant.
    imageOptions: { type: [imageOptionSchema], default: [] },
    // AI-ported versions of the master creative for other platforms/formats
    // selected on this post, beyond the primary one used for the master.
    formatVariants: { type: [formatVariantSchema], default: [] },
    // Populated instead of imageUrl when this variant's medium is a
    // carousel-type format (see constants/postFormats.js#isCarouselFormat) -
    // the ordered set of slide images that make up the swipeable post.
    carouselSlides: { type: [carouselSlideSchema], default: [] },
    // Video generation jobs for this variant - a variant can have several
    // (e.g. retried attempts, or different providers tried).
    videoJobs: { type: [videoJobSchema], default: [] }
  },
  { _id: false }
);

const referenceImageSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String, default: '' },
    mimeType: { type: String, required: true },
    url: { type: String, required: true },
    // "include": the actual subject must appear in the final image (same
    // grounding treatment as a selected brand asset). "style": match the
    // mood/palette/treatment of this reference, not its literal subject.
    // "template": this reference IS an existing finished creative (logo
    // placement, layout, branding elements included) - preserve it as
    // closely as possible and only adapt the message/copy, rather than
    // treating it as a subject to place into a newly imagined scene.
    mode: { type: String, enum: ['include', 'style', 'template'], default: 'include' },
    // Only meaningful when mode === 'include'. When true, this image is
    // never sent to the AI model to be reinterpreted - it's composited
    // onto the finished generation pixel-for-pixel unchanged instead. See
    // resolveReferenceImages/compositeExactAssets in posts.controller.js.
    exact: { type: Boolean, default: false },
    // Only meaningful when exact === true. Which corner this element gets
    // pasted onto - lets a logo and a separate compliance/QR element (say)
    // sit at different corners rather than always stacking in one spot.
    // See compositeExactAssets.js for the actual layout math.
    anchor: { type: String, enum: ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'], default: 'bottom-right' }
  },
  { _id: false }
);

const modificationSchema = new mongoose.Schema(
  {
    target: { type: String, enum: ['image', 'copy'], required: true },
    // "region": a masked/annotated touch-up to one part of the image only
    // (see refineImageRegion in designService.js) - distinct from "prompt"
    // which regenerates the whole image from scratch.
    method: { type: String, enum: ['upload', 'prompt', 'sharpen', 'region'], required: true },
    input: { type: String, default: '' },
    resultUrl: { type: String, default: '' },
    resultText: { type: String, default: '' },
    model: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const creativeBriefSchema = new mongoose.Schema(
  {
    moodTags: { type: [String], default: [] }, // e.g. "bold", "minimal", "luxurious"
    styleReferences: { type: [String], default: [] }, // e.g. "Studio product photography", "Cinematic film still"
    lightingStyle: { type: String, default: '' }, // e.g. "Golden hour", "Studio softbox"
    compositionStyle: { type: String, default: '' }, // e.g. "Rule-of-thirds hero shot"
    primaryMessage: { type: String, default: '' }, // the single thing the creative should communicate visually
    mustInclude: { type: String, default: '' },
    mustAvoid: { type: String, default: '' },
    qualityTier: { type: String, enum: ['standard', 'high'], default: 'high' },
    // When set, the image model is told to render this short headline/CTA
    // text directly into the creative (styled, legible), instead of the
    // default behavior of leaving clean negative space for the caption
    // overlay added separately by the UI.
    includeTypography: { type: Boolean, default: false },
    // Opt-in: blend the brand kit's analyzed design language (mood + imagery
    // style from past assets) into this brief. Off by default.
    useBrandStyle: { type: Boolean, default: false },
    // New Creative -> Brand assets tick. Off = clean slate: no brand assets, colours, style, mood or voice reach any prompt.
    followBrand: { type: Boolean, default: true },
    headlineText: { type: String, default: '' },
    // Optional second, smaller line rendered under the headline. Step 02 sets it (on by default) and clears it when switched off.
    includeSubHeadline: { type: Boolean, default: true },
    subHeadlineText: { type: String, default: '' },
    // Step 3 "People": 'auto' = model decides (default), 'include' = the final
    // design must feature people (count/age/style/note refine it), 'none' = no people.
    peopleMode: { type: String, enum: ['auto', 'include', 'none'], default: 'auto' },
    peopleCount: { type: String, default: '' },
    peopleAge: { type: [String], default: [] },
    // Optional: restrict anyone shown to one gender. '' = no preference.
    peopleGender: { type: String, enum: ['', 'Only female', 'Only male'], default: '' },
    peopleStyle: { type: String, default: '' },
    // Ethnicity of any people shown. Defaults to Indian; '' = no preference.
    peopleEthnicity: { type: String, default: 'Indian' },
    peopleNote: { type: String, default: '' },
    // Number of slides to generate when mediums[0] is a carousel-type
    // format (see constants/postFormats.js#isCarouselFormat) - clamped to
    // that format's minSlides/maxSlides at generation time regardless of
    // what's stored here.
    slideCount: { type: Number, default: 5 },
    // Creative Adaptation only - which elements detected in the uploaded
    // template must be preserved vs which parts of the layout are open to
    // redesign. Populated from AI detection (templateAnalysisService.js)
    // but always user-editable/overridable. Irrelevant for New Creative.
    templatePreservation: {
      preserveLogo: { type: Boolean, default: true },
      // Only set when a primary headline was detected in the template.
      // true = keep its exact wording/position/style; false = wording may change.
      preservePrimaryHeadline: { type: Boolean },
      preserveKeyVisual: { type: Boolean, default: true },
      // The hero subject's background/setting/location, tracked separately
      // from the subject itself (e.g. keep the car, change Paris).
      preserveBackground: { type: Boolean, default: true },
      preserveSecondaryText: { type: Boolean, default: true },
      preserveComplianceText: { type: Boolean, default: true },
      preserveDecorative: { type: Boolean, default: true },
      // false ("strict") = keep the exact layout/composition. true
      // ("flexible") = the layout itself may be redesigned, but whichever
      // elements above are marked to preserve must still appear.
      layoutFlexible: { type: Boolean, default: false },
      // Optional free-text change request for Creative Adaptation, e.g.
      // "change the background from Paris to a Mumbai street at golden hour,
      // keep the car exactly as is". Overrides the preserve rules above where
      // they conflict. Capped at 1000 chars when applied.
      customInstruction: { type: String, default: '' },
      // Rectangles the person drew on the original creative around elements
      // that must NOT be modified (QR code, registration number, logo...).
      // Coordinates are fractions (0-1) of the original image's width/height.
      protectedRegions: {
        type: [
          new mongoose.Schema(
            {
              x: { type: Number, min: 0, max: 1 },
              y: { type: Number, min: 0, max: 1 },
              w: { type: Number, min: 0, max: 1 },
              h: { type: Number, min: 0, max: 1 },
              label: { type: String, default: '' }
            },
            { _id: false }
          )
        ],
        default: []
      }
    }
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Step 01 - fork at the very top of the brief: a brand-new concept
    // (the full multi-variant explore -> refine -> modify -> publish
    // path) vs adapting an existing, already-approved creative (agencies
    // reworking one campaign asset for a new message/market/product -
    // skips straight from Step 02 to Publish; see Stepper.jsx and
    // generateDesigns()'s variantCount handling).
    // 'headline' = "Edit Headline Only" and 'hero' = "Change Hero Image Only", 'convert' = "Convert to Video" (an uploaded creative turned into a short video), 'resize' = "Adapt to Other Sizes" (an uploaded finished creative taken straight to sizing, no edit): an uploaded creative where just that one element is changed.
    creativeType: { type: String, enum: ['new', 'adaptation', 'headline', 'hero', 'resize', 'convert', 'multiscene'], default: 'new' },

    // Step 01 - brief
    // Free text: the standard purposes, internal flow names ('Creative edit', 'Size adaptation', ...) and anything the
    // user types under "Something else..." are all valid, so there is deliberately no enum here.
    purpose: {
      type: String,
      trim: true,
      default: 'Product launch'
    },
    mediums: { type: [String], default: ['instagram_feed'] },
    briefNote: { type: String, default: '' },
    creativeBrief: { type: creativeBriefSchema, default: () => ({}) },
    selectedAssets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BrandAsset' }],
    // Subset of selectedAssets the user asked to be kept pixel-exact (no
    // AI reinterpretation) - composited onto the generated image as-is
    // rather than sent to the model as a visual reference. See
    // resolveReferenceImages/compositeExactAssets in posts.controller.js.
    exactAssetIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BrandAsset' }],
    // Post-scoped one-off reference creatives (e.g. a competitor ad for
    // style inspiration, or a specific graphic that must appear in the
    // final design) - separate from the permanent Brand Assets library,
    // since these are often one-time inputs for this post only.
    referenceCreatives: { type: [referenceImageSchema], default: [] },
    masterDesignUrl: { type: String, default: '' },
    // Sub-brand this creative was made for (null = main brand). Name is kept so it still reads after a delete.
    subBrand: { type: mongoose.Schema.Types.ObjectId, default: null },
    subBrandName: { type: String, default: '' },

    // Step 02 - generated directions
    designs: { type: [designVariantSchema], default: [] },
    selectedVariantLabel: { type: String, default: '' },

    // Step 04 - modifications log (image + copy refinements)
    modifications: { type: [modificationSchema], default: [] },

    // Step 05 - publish
    status: {
      type: String,
      enum: ['draft', 'in_review', 'approved', 'published'],
      default: 'draft'
    },
    approval: {
      approverName: { type: String, default: '' },
      note: { type: String, default: '' },
      status: { type: String, enum: ['pending', 'approved', 'changes_requested'], default: 'pending' },
      requestedAt: Date,
      respondedAt: Date
    },
    publishedTo: [
      {
        platform: String,
        account: String,
        deployedAt: Date,
        externalUrl: String,
        // true for platforms still using the mock connector (see
        // publishConnectors.js) - lets the UI show "(simulated)" so it's
        // never mistaken for an actual live post.
        simulated: { type: Boolean, default: true }
      }
    ]
  },
  { timestamps: true }
);

postSchema.virtual('selectedDesign').get(function selectedDesign() {
  return this.designs.find((d) => d.label === this.selectedVariantLabel) || this.designs[0];
});

postSchema.set('toJSON', { virtuals: true });
postSchema.set('toObject', { virtuals: true });

postSchema.plugin(tenantPlugin);

export default mongoose.model('Post', postSchema);
