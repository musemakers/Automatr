import { Router } from 'express';
import { requireAuth, requireAgency } from '../middleware/auth.js';
import { uploadBrandFiles, uploadPastAssets, uploadFontFile } from '../middleware/upload.js';
import { uploadAssets, listAssets, deleteAsset, updateAsset, reanalyzeAsset, getGuide, updateGuide, updateBrandKit, updateDesignLanguage, researchToneOfVoice, listSubBrandsHandler, createSubBrand, updateSubBrand, deleteSubBrand, detectSubBrandHandler, getLanguages, updateLanguages, searchAssets, galleryHandler, readPastAssetsHandler, synthesizePastAssetsHandler, readPhotographyHandler, getProfile, updateProfile, readGuidelinesHandler, removeGuidelinesHandler, resetBrandAssetsHandler, styleSummaryHandler, getFontSpecimen, generateFontSpecimen, listSystemFonts, uploadFontFileHandler } from '../controllers/brandAssets.controller.js';

const router = Router();

router.use(requireAuth);

// Reading stays open to everyone in the workspace: the New Creative flow lists the brand's logos and products,
// picks the languages and detects the sub-brand. Everything that changes the brand (uploads, guide, design language,
// languages, sub-brands) is the agency super admin's, who works inside a customer's workspace from the customer switcher.
router.get('/', listAssets);
router.get('/languages', getLanguages);
router.get('/sub-brands', listSubBrandsHandler);
router.post('/sub-brands/detect', detectSubBrandHandler);

router.post('/', requireAgency, uploadBrandFiles.array('files', 10), uploadAssets);
router.patch('/brand-kit', requireAgency, updateBrandKit);
router.get('/font-specimen', getFontSpecimen);
router.post('/font-specimen', requireAgency, generateFontSpecimen);
router.get('/system-fonts', requireAgency, listSystemFonts);
router.post('/font-file', requireAgency, uploadFontFile.single('file'), uploadFontFileHandler);
router.patch('/design-language', requireAgency, updateDesignLanguage);
router.post('/design-language/tone-of-voice/research', requireAgency, researchToneOfVoice);
router.post('/search', requireAgency, searchAssets);
router.get('/gallery', requireAgency, galleryHandler);
router.post('/past-assets/read', requireAgency, uploadPastAssets.array('files', 8), readPastAssetsHandler);
router.post('/past-assets/synthesize', requireAgency, synthesizePastAssetsHandler);
router.post('/photography/read', requireAgency, readPhotographyHandler);
router.get('/profile', requireAgency, getProfile);
router.patch('/profile', requireAgency, updateProfile);
router.post('/profile/guidelines', requireAgency, uploadBrandFiles.array('files', 1), readGuidelinesHandler);
router.delete('/profile/guidelines', requireAgency, removeGuidelinesHandler);
router.post('/reset', requireAgency, resetBrandAssetsHandler);
router.post('/profile/style-summary', requireAgency, styleSummaryHandler);
router.get('/guide', requireAgency, getGuide);
router.patch('/guide', requireAgency, updateGuide);
router.patch('/languages', requireAgency, updateLanguages);
router.post('/sub-brands', requireAgency, createSubBrand);
router.patch('/sub-brands/:id', requireAgency, updateSubBrand);
router.delete('/sub-brands/:id', requireAgency, deleteSubBrand);
router.patch('/:id', requireAgency, updateAsset);
router.post('/:id/reanalyze', requireAgency, reanalyzeAsset);
router.delete('/:id', requireAgency, deleteAsset);

export default router;
