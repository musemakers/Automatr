import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { enforceBudget, restrictGeneration, blockSuperadminCreation } from '../middleware/budgetGuard.js';
import { enforceStorage } from '../middleware/storageGuard.js';
import { deliver } from '../controllers/delivery.controller.js';
import {
  createPost,
  suggestLookAndFeel,
  suggestMessage,
  updatePost,
  listPosts,
  getStorageUsage,
  getPost,
  deletePost,
  deleteAllPosts,
  generateDesigns,
  regenerateVariant,
  generateVariantImage,
  generateVariantImageOptions,
  initVariantImageOptions,
  generateVariantImageOptionSingle,
  generateVariantCarousel,
  selectImageOption,
  portVariantToFormats,
  adaptVariantSizes,
  generateVariantVideo,
  suggestVariantVideoIdeas,
  suggestVariantMotionPrompt,
  getVariantVideoStatus,
  updateVariant,
  updateCreativeBrief,
  generateVariantHeadline,
  generateVariantHeadlineOptions,
  improveVariantCaptionOptions,
  uploadReferenceCreative,
  removeReferenceCreative,
  selectVariant,
  modifyImage,
  editHeadlineText,
  editHeroImage, editCreativeElements,
  adoptCreativeForAdaptation,
  undoImageEdit,
  modifyCopy,
  sendForApproval,
  respondToApproval,
  publishPost
} from '../controllers/posts.controller.js';

const router = Router();

router.use(requireAuth);

// Step 01
router.post('/suggest-look-and-feel', enforceBudget, suggestLookAndFeel);
router.post('/suggest-message', enforceBudget, suggestMessage);
router.post('/', blockSuperadminCreation, enforceStorage, createPost);
router.get('/', listPosts);
router.get('/storage', getStorageUsage);
router.delete('/', deleteAllPosts);
router.get('/:id', getPost);
router.patch('/:id', updatePost);
router.delete('/:id', deletePost);

// Step 02 - copy-first: generate copy directions fast, then deliberately
// commission an image per variant (or edit either by hand, no AI call)
router.post('/:id/designs', blockSuperadminCreation, enforceStorage, enforceBudget, generateDesigns);
router.post('/:id/designs/:label/regenerate', blockSuperadminCreation, enforceStorage, enforceBudget, regenerateVariant);
router.post('/:id/designs/:label/image', restrictGeneration('image'), enforceStorage, enforceBudget, generateVariantImage);
router.post('/:id/designs/:label/image-options', restrictGeneration('image'), enforceStorage, enforceBudget, generateVariantImageOptions);
// Progressive alternative to the line above - init 3 placeholders, then
// generate each one independently so the client can render each as it
// finishes instead of waiting for all 3. See GenerateDesigns.jsx.
router.post('/:id/designs/:label/image-options/init', restrictGeneration('image'), enforceStorage, enforceBudget, initVariantImageOptions);
router.post('/:id/designs/:label/image-options/:index', restrictGeneration('image'), enforceStorage, enforceBudget, generateVariantImageOptionSingle);
router.post('/:id/designs/:label/carousel', restrictGeneration('image'), enforceStorage, enforceBudget, generateVariantCarousel);
router.patch('/:id/designs/:label/select-image', selectImageOption);
router.post('/:id/designs/:label/port-formats', restrictGeneration('image'), enforceStorage, enforceBudget, portVariantToFormats);
// Size Adapt: many sizes in one request, made in the background (poll GET /:id)
router.post('/:id/designs/:label/adapt-sizes', restrictGeneration('image'), enforceStorage, enforceBudget, adaptVariantSizes);
router.post('/:id/designs/:label/video-ideas', enforceBudget, suggestVariantVideoIdeas);
router.post('/:id/designs/:label/motion-prompt', enforceBudget, suggestVariantMotionPrompt);
router.post('/:id/designs/:label/video', restrictGeneration('video'), enforceStorage, enforceBudget, generateVariantVideo);
router.get('/:id/designs/:label/video/:jobId', getVariantVideoStatus);
router.patch('/:id/designs/:label', updateVariant);
router.post('/:id/designs/:label/headline', enforceBudget, generateVariantHeadline);
router.post('/:id/designs/:label/headline-options', enforceBudget, generateVariantHeadlineOptions);
router.post('/:id/designs/:label/caption-options', enforceBudget, improveVariantCaptionOptions);
router.patch('/:id/creative-brief', updateCreativeBrief);

// Post-scoped reference creatives (style inspiration or "include in design")
router.post('/:id/references', upload.single('file'), uploadReferenceCreative);
router.delete('/:id/references/:filename', removeReferenceCreative);

// Step 03
router.patch('/:id/select-variant', selectVariant);

// "Edit Headline Only" - change just the headline/sub-headline of an uploaded creative
router.post('/:id/headline-edit', restrictGeneration('image'), enforceStorage, enforceBudget, upload.single('file'), editHeadlineText);
// "Change Hero Image Only" - original creative in `file`, optional replacement photo in `replacement`
router.post('/:id/adapt-source', blockSuperadminCreation, enforceStorage, upload.single('file'), adoptCreativeForAdaptation);
router.post('/:id/hero-edit', restrictGeneration('image'), enforceStorage, enforceBudget, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'replacement', maxCount: 6 }]), editHeroImage);
router.post('/:id/creative-edit', restrictGeneration('image'), enforceStorage, enforceBudget, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'replacement', maxCount: 6 }]), editCreativeElements);

// Step 04
router.post('/:id/modify/image', restrictGeneration('image'), enforceStorage, enforceBudget, upload.single('file'), modifyImage);
router.post('/:id/modify/image/undo', undoImageEdit);
router.post('/:id/modify/copy', enforceBudget, modifyCopy);

// Step 05
router.post('/:id/approval', sendForApproval);
router.patch('/:id/approval', respondToApproval);
router.post('/:id/publish', publishPost);
// Send the finished creative to the customer's delivery destination (folder or webhook)
router.post('/:id/deliver', deliver);

export default router;
