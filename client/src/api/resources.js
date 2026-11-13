import { api } from './client.js';

export const authApi = {
  register: (payload) => api.post('/auth/register', payload).then((r) => r.data),
  login: (payload) => api.post('/auth/login', payload).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  updateMe: (payload) => api.patch('/auth/me', payload).then((r) => r.data),
  industries: () => api.get('/auth/industries').then((r) => r.data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (token, password) => api.post('/auth/reset-password', { token, password }).then((r) => r.data),
  resetAvailable: () => api.get('/auth/forgot-password/status').then((r) => r.data)
};

export const brandAssetsApi = {
  list: () => api.get('/brand-assets').then((r) => r.data),
  // extra: { logoVariant, label, notes } for the super admin's richer uploads.
  upload: (files, kind, subBrandId, extra = {}) => {
    const form = new FormData();
    [...files].forEach((f) => form.append('files', f));
    if (kind) form.append('kind', kind);
    if (subBrandId) form.append('subBrandId', subBrandId);
    ['logoVariant', 'label', 'notes', 'styleGroup'].forEach((k) => { if (extra[k]) form.append(k, extra[k]); });
    if (extra.onDark !== undefined) form.append('onDark', extra.onDark ? 'true' : 'false');
    return api.post('/brand-assets', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  remove: (id) => api.delete(`/brand-assets/${id}`).then((r) => r.data),
  // Super admin: describe what you need in plain words; the AI picks the matching files.
  // Super admin: past published assets -> proposed style rules, in two light steps so no request runs long. Nothing is saved.
  readPastAssets: (files) => {
    const form = new FormData();
    [...files].forEach((f) => form.append('files', f));
    return api.post('/brand-assets/past-assets/read', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }).then((r) => r.data);
  },
  synthesizePastAssets: (notes) => api.post('/brand-assets/past-assets/synthesize', { notes }, { timeout: 120000 }).then((r) => r.data),
  // Super admin: a photography guide (.md text) -> condensed photography-only direction to review. Nothing is saved.
  readPhotographyGuide: (name, text, reuse = false) => api.post('/brand-assets/photography/read', reuse ? { reuse: true } : { name, text }, { timeout: 120000 }).then((r) => r.data),
  gallery: () => api.get('/brand-assets/gallery').then((r) => r.data),
  search: (query) => api.post('/brand-assets/search', { query }).then((r) => r.data),
  // The structured Brand Assets screen: every box's items, the guidelines PDF it came from and the style summaries.
  getProfile: () => api.get('/brand-assets/profile').then((r) => r.data),
  updateProfile: (payload) => api.patch('/brand-assets/profile', payload).then((r) => r.data),
  readGuidelines: (file) => {
    const form = new FormData();
    form.append('files', file);
    return api.post('/brand-assets/profile/guidelines', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 }).then((r) => r.data);
  },
  resetAll: () => api.post('/brand-assets/reset', { confirm: 'RESET' }).then((r) => r.data),
  removeGuidelines: () => api.delete('/brand-assets/profile/guidelines').then((r) => r.data),
  styleSummary: (kind, force = false) => api.post('/brand-assets/profile/style-summary', { kind, force }, { timeout: 180000 }).then((r) => r.data),
  updateAsset: (id, payload) => api.patch(`/brand-assets/${id}`, payload).then((r) => r.data),
  reanalyzeAsset: (id) => api.post(`/brand-assets/${id}/reanalyze`).then((r) => r.data),
  // Brand guide (super admin): custom instructions + a review of what the AI is told.
  getGuide: () => api.get('/brand-assets/guide').then((r) => r.data),
  updateGuide: (payload) => api.patch('/brand-assets/guide', payload).then((r) => r.data),
  updateBrandKit: (payload) => api.patch('/brand-assets/brand-kit', payload).then((r) => r.data),
  getFontSpecimen: (subBrandId) => api.get('/brand-assets/font-specimen', { params: subBrandId ? { subBrandId } : {} }).then((r) => r.data),
  generateFontSpecimen: (payload) => api.post('/brand-assets/font-specimen', payload || {}).then((r) => r.data),
  systemFonts: () => api.get('/brand-assets/system-fonts').then((r) => r.data),
  uploadFontFile: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/brand-assets/font-file', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }).then((r) => r.data);
  },
  getLanguages: () => api.get('/brand-assets/languages').then((r) => r.data),
  updateLanguages: (payload) => api.patch('/brand-assets/languages', payload).then((r) => r.data),
  updateDesignLanguage: (payload) => api.patch('/brand-assets/design-language', payload).then((r) => r.data),
  researchToneOfVoice: () => api.post('/brand-assets/design-language/tone-of-voice/research').then((r) => r.data),
  // Sub-brands: each has its own uploads and brand guideline.
  listSubBrands: () => api.get('/brand-assets/sub-brands').then((r) => r.data),
  createSubBrand: (payload) => api.post('/brand-assets/sub-brands', payload).then((r) => r.data),
  updateSubBrand: (id, payload) => api.patch(`/brand-assets/sub-brands/${id}`, payload).then((r) => r.data),
  deleteSubBrand: (id, deleteAssets) => api.delete(`/brand-assets/sub-brands/${id}`, { params: deleteAssets ? { assets: 'delete' } : {} }).then((r) => r.data),
  detectSubBrand: (payload) => api.post('/brand-assets/sub-brands/detect', payload).then((r) => r.data)
};

export const postsApi = {
  create: (payload) => api.post('/posts', payload).then((r) => r.data),
  // Send the finished creative to the customer's delivery destination (folder or webhook).
  deliver: (id) => api.post(`/posts/${id}/deliver`).then((r) => r.data),
  suggestLookAndFeel: (payload) => api.post('/posts/suggest-look-and-feel', payload).then((r) => r.data),
  suggestMessage: (payload) => api.post('/posts/suggest-message', payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/posts/${id}`, payload).then((r) => r.data),
  list: (status) => api.get('/posts', { params: status ? { status } : {} }).then((r) => r.data),
  storage: (fresh) => api.get('/posts/storage', { params: fresh ? { fresh: 1 } : {} }).then((r) => r.data),
  get: (id) => api.get(`/posts/${id}`).then((r) => r.data),
  remove: (id) => api.delete(`/posts/${id}`).then((r) => r.data),
  removeAll: () => api.delete('/posts').then((r) => r.data),
  generateDesigns: (id, payload) => api.post(`/posts/${id}/designs`, payload).then((r) => r.data),
  regenerateVariant: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/regenerate`, payload).then((r) => r.data),
  generateVariantImage: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/image`, payload).then((r) => r.data),
  generateImageOptions: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/image-options`, payload).then((r) => r.data),
  // Progressive alternative: init writes 3 "generating…" placeholders
  // immediately, then each option is requested independently so the UI
  // can show each as it finishes rather than waiting for all 3 together.
  initImageOptions: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/image-options/init`, payload).then((r) => r.data),
  generateImageOption: (id, label, index, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/image-options/${index}`, payload).then((r) => r.data),
  generateCarousel: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/carousel`, payload).then((r) => r.data),
  selectImageOption: (id, label, optionIndex) => api.patch(`/posts/${id}/designs/${encodeURIComponent(label)}/select-image`, { optionIndex }).then((r) => r.data),
  adaptSizes: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/adapt-sizes`, payload).then((r) => r.data),
  portFormats: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/port-formats`, payload).then((r) => r.data),
  generateVideo: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/video`, payload).then((r) => r.data),
  suggestMotionPrompt: (id, label, payload = {}) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/motion-prompt`, payload).then((r) => r.data),
  suggestVideoIdeas: (id, label, payload = {}) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/video-ideas`, payload).then((r) => r.data),
  getVideoStatus: (id, label, jobId) => api.get(`/posts/${id}/designs/${encodeURIComponent(label)}/video/${encodeURIComponent(jobId)}`).then((r) => r.data),
  updateVariant: (id, label, payload) => api.patch(`/posts/${id}/designs/${encodeURIComponent(label)}`, payload).then((r) => r.data),
  updateCreativeBrief: (id, payload) => api.patch(`/posts/${id}/creative-brief`, payload).then((r) => r.data),
  generateHeadlineOptions: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/headline-options`, payload).then((r) => r.data),
  improveCaptionOptions: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/caption-options`, payload).then((r) => r.data),
  generateHeadline: (id, label, payload) => api.post(`/posts/${id}/designs/${encodeURIComponent(label)}/headline`, payload).then((r) => r.data),
  uploadReference: (id, file, mode, exact = false, anchor = 'bottom-right') => {
    const form = new FormData();
    form.append('file', file);
    form.append('mode', mode);
    form.append('exact', exact ? 'true' : 'false');
    form.append('anchor', anchor);
    return api.post(`/posts/${id}/references`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  removeReference: (id, filename) => api.delete(`/posts/${id}/references/${encodeURIComponent(filename)}`).then((r) => r.data),
  selectVariant: (id, label) => api.patch(`/posts/${id}/select-variant`, { label }).then((r) => r.data),
  // "Edit Headline Only": change just the headline / sub-headline of an uploaded creative.
  editHeadline: (id, file, edits, sizePx) => {
    const form = new FormData();
    form.append('file', file);
    form.append('edits', JSON.stringify(edits));
    if (sizePx) form.append('sizePx', sizePx); // "1080x1350": crop the result to the chosen size
    return api.post(`/posts/${id}/headline-edit`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  // "Change Hero Image Only": swap just the hero of an uploaded creative, for a described hero or an uploaded photo.
  // "Quick Adapt": store an uploaded finished creative, unedited, so it can be ported to other sizes.
  adaptSource: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/posts/${id}/adapt-source`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  editHero: (id, file, replacement, instruction, sizePx) => {
    const form = new FormData();
    form.append('file', file);
    if (sizePx) form.append('sizePx', sizePx); // "1080x1350": crop the result to the chosen size
    [].concat(replacement || []).forEach((f) => form.append('replacement', f)); // one file, or several (one per subject)
    form.append('instruction', JSON.stringify(instruction));
    return api.post(`/posts/${id}/hero-edit`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  // "Creative Edit": keep / edit / remove the elements of an uploaded creative (references go in `replacement`).
  editCreative: (id, file, replacement, instruction, sizePx) => {
    const form = new FormData();
    form.append('file', file);
    if (sizePx) form.append('sizePx', sizePx);
    [].concat(replacement || []).forEach((f) => form.append('replacement', f));
    form.append('instruction', JSON.stringify(instruction));
    return api.post(`/posts/${id}/creative-edit`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  modifyImageWithUpload: (id, file) => {
    const form = new FormData();
    form.append('method', 'upload');
    form.append('file', file);
    return api.post(`/posts/${id}/modify/image`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  modifyImageWithPrompt: (id, prompt, model) =>
    api.post(`/posts/${id}/modify/image`, { method: 'prompt', prompt, model }).then((r) => r.data),
  modifyImageWithRegion: (id, { maskDataUrl, instruction, model = 'auto' }) =>
    api.post(`/posts/${id}/modify/image`, { method: 'region', maskDataUrl, instruction, model }).then((r) => r.data),
  undoImageEdit: (id) => api.post(`/posts/${id}/modify/image/undo`).then((r) => r.data),
  modifyCopy: (id, payload) => api.post(`/posts/${id}/modify/copy`, payload).then((r) => r.data),
  sendForApproval: (id, payload) => api.post(`/posts/${id}/approval`, payload).then((r) => r.data),
  respondToApproval: (id, decision) => api.patch(`/posts/${id}/approval`, { decision }).then((r) => r.data),
  publish: (id, payload) => api.post(`/posts/${id}/publish`, payload).then((r) => r.data)
};

export const newsApi = {
  snapshot: (industry) => api.get('/news', { params: industry ? { industry } : {} }).then((r) => r.data),
  refresh: (industry) => api.post('/news/refresh', { industry }).then((r) => r.data)
};

export const aiApi = {
  status: () => api.get('/ai/status').then((r) => r.data),
  getCostEstimates: () => api.get('/ai/cost-estimates').then((r) => r.data),
  getGenerationAllowance: () => api.get('/ai/generation-allowance').then((r) => r.data),
  getUsage: (params) => api.get('/ai/usage', { params }).then((r) => r.data),
  analyzeTemplate: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/ai/analyze-template', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  analyzeHeadline: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/ai/analyze-headline', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  analyzeHero: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/ai/analyze-hero', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  // Sends the creative itself so ideas respect the hero's look, placement and the layout around it.
  heroIdeas: ({ file, current, position, background, direction, exclude }) => {
    const form = new FormData();
    if (file) form.append('file', file);
    form.append('current', current || '');
    form.append('position', position || '');
    form.append('background', background || '');
    form.append('direction', direction || '');
    form.append('exclude', JSON.stringify(exclude || []));
    return api.post('/ai/hero-ideas', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  generateHeadlineVariations: ({ originalHeadline, purpose, briefNote, improve }) =>
    api.post('/ai/headline-variations', { originalHeadline, purpose, briefNote, improve }).then((r) => r.data),
  // Improve for any typed box: { options: [3 rewrites] }
  improveText: ({ text, kind, context }) => api.post('/ai/improve-text', { text, kind, context }).then((r) => r.data)
};

// Custom features (Brief Studio). The first block is what everyone uses; the "admin" calls are agency-only.
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };
function withReference(payload = {}, file = null) {
  if (!file) return payload;
  const form = new FormData();
  for (const [k, v] of Object.entries(payload)) if (v !== undefined && v !== null) form.append(k, v);
  form.append('reference', file);
  return form;
}

export const customFeaturesApi = {
  list: () => api.get('/custom-features').then((r) => r.data),
  get: (id) => api.get(`/custom-features/${id}`).then((r) => r.data),
  listRuns: (id) => api.get(`/custom-features/${id}/runs`).then((r) => r.data),
  start: (id, form) => api.post(`/custom-features/${id}/runs`, form, MULTIPART).then((r) => r.data),
  getRun: (runId) => api.get(`/custom-features/runs/${runId}`).then((r) => r.data),
  compose: (runId, selections) => api.post(`/custom-features/runs/${runId}/compose`, { selections }).then((r) => r.data),
  retry: (runId) => api.post(`/custom-features/runs/${runId}/retry`).then((r) => r.data),

  adminList: () => api.get('/custom-features/admin').then((r) => r.data),
  // With a reference image/video the request is multipart (field `reference`); otherwise plain JSON.
  adminCreate: (payload, file) => api.post('/custom-features/admin', withReference(payload, file), { timeout: 300000 }).then((r) => r.data),
  adminGet: (id) => api.get(`/custom-features/admin/${id}`).then((r) => r.data),
  adminUpdate: (id, payload) => api.patch(`/custom-features/admin/${id}`, payload).then((r) => r.data),
  adminRemove: (id) => api.delete(`/custom-features/admin/${id}`).then((r) => r.data),
  // Designing / changing a spec asks the AI to write it, which can take a little while.
  adminRedesign: (id, payload, file) => api.post(`/custom-features/admin/${id}/redesign`, withReference(payload, file), { timeout: 300000 }).then((r) => r.data),
  adminRefine: (id, instruction) => api.post(`/custom-features/admin/${id}/refine`, { instruction }, { timeout: 180000 }).then((r) => r.data),
  adminTest: (id, form) => api.post(`/custom-features/admin/${id}/test`, form, MULTIPART).then((r) => r.data),
  adminTestRuns: (id) => api.get(`/custom-features/admin/${id}/test-runs`).then((r) => r.data),
  adminPublish: (id, payload) => api.post(`/custom-features/admin/${id}/publish`, payload).then((r) => r.data),
  adminUnpublish: (id) => api.post(`/custom-features/admin/${id}/unpublish`).then((r) => r.data)
};

const ALL_CUSTOMERS = { 'X-Customer-Id': 'all' };

export const adminApi = {
  getAiPipelines: (params) => api.get('/admin/ai-pipelines', { params }).then((r) => r.data),
  previewAiPipeline: (workflow, graph, params) => api.post(`/admin/ai-pipelines/${workflow}/preview`, graph, { params }).then((r) => r.data),
  saveAiPipeline: (workflow, graph, params) => api.put(`/admin/ai-pipelines/${workflow}`, graph, { params }).then((r) => r.data),
  resetAiPipeline: (workflow, params) => api.delete(`/admin/ai-pipelines/${workflow}`, { params }).then((r) => r.data),
  aiPipelineStatus: () => api.get('/admin/ai-pipelines/status').then((r) => r.data),
  meta: () => api.get('/admin/users/meta').then((r) => r.data),
  listUsers: (params) => api.get('/admin/users', { params }).then((r) => r.data),
  getUser: (id) => api.get(`/admin/users/${id}`).then((r) => r.data),
  createUser: (payload) => api.post('/admin/users', payload).then((r) => r.data),
  updateUser: (id, payload) => api.patch(`/admin/users/${id}`, payload).then((r) => r.data),
  deleteUser: (id) => api.delete(`/admin/users/${id}`).then((r) => r.data),

  listIndustries: () => api.get('/admin/industries').then((r) => r.data),
  createIndustry: (payload) => api.post('/admin/industries', payload).then((r) => r.data),
  updateIndustry: (id, payload) => api.patch(`/admin/industries/${id}`, payload).then((r) => r.data),
  deleteIndustry: (id) => api.delete(`/admin/industries/${id}`).then((r) => r.data),

  getNewsSettings: () => api.get('/admin/settings/news').then((r) => r.data),
  updateNewsSettings: (payload) => api.patch('/admin/settings/news', payload).then((r) => r.data),

  getGenerationSettings: () => api.get('/admin/settings/generation').then((r) => r.data),
  updateGenerationSettings: (payload) => api.patch('/admin/settings/generation', payload).then((r) => r.data),
  updateImageModelSettings: (payload) => api.patch('/admin/settings/generation/image', payload).then((r) => r.data),
  updateVisionModelSettings: (payload) => api.patch('/admin/settings/generation/vision', payload).then((r) => r.data),

  getVideoModelSettings: () => api.get('/admin/settings/generation/video').then((r) => r.data),
  updateVideoModelSettings: (payload) => api.patch('/admin/settings/generation/video', payload).then((r) => r.data),

  getProviderMatrix: () => api.get('/admin/settings/providers').then((r) => r.data),

  getBlanketRules: () => api.get('/admin/settings/blanket-rules').then((r) => r.data),
  updateBlanketRule: (key, payload) => api.patch(`/admin/settings/blanket-rules/${encodeURIComponent(key)}`, payload).then((r) => r.data),
  resetBlanketRule: (key) => api.delete(`/admin/settings/blanket-rules/${encodeURIComponent(key)}`).then((r) => r.data),

  // Agency super admin dashboard: one cross-customer roll-up
  getAgencyGallery: () => api.get('/admin/dashboard/gallery', { headers: ALL_CUSTOMERS }).then((r) => r.data),
  getAgencyDashboard: () => api.get('/admin/dashboard', { headers: ALL_CUSTOMERS }).then((r) => r.data),

  // Customers (multi-customer). Agency admins manage the list; customer admins use the "current" ones.
  listCustomers: () => api.get('/admin/customers').then((r) => r.data),
  customersUsage: () => api.get('/admin/customers/usage').then((r) => r.data),
  createCustomer: (payload) => api.post('/admin/customers', payload).then((r) => r.data),
  createCustomerUser: (id, payload) => api.post(`/admin/customers/${id}/users`, payload).then((r) => r.data),
  modifyLimits: (id, payload) => api.patch(`/admin/customers/${id}/limits`, payload).then((r) => r.data),
  getLimitsHistory: (id) => api.get(`/admin/customers/${id}/limits-history`).then((r) => r.data),
  topUpCustomer: (id, payload) => api.post(`/admin/customers/${id}/top-up`, payload).then((r) => r.data),
  getTopUpHistory: (id) => api.get(`/admin/customers/${id}/top-ups`).then((r) => r.data),
  updateCustomer: (id, payload) => api.patch(`/admin/customers/${id}`, payload).then((r) => r.data),
  // Backup / delete / import a customer (a backup is one .zip with the data and the files)
  customerCounts: (id) => api.get(`/admin/customers/${id}/counts`).then((r) => r.data),
  backupCustomer: (id) => api.post(`/admin/customers/${id}/backup`, {}, { timeout: 0 }).then((r) => r.data),
  deleteCustomer: (id, payload) => api.delete(`/admin/customers/${id}`, { data: payload, timeout: 0 }).then((r) => r.data),
  listCustomerBackups: () => api.get('/admin/customer-backups', { headers: ALL_CUSTOMERS }).then((r) => r.data),
  downloadCustomerBackup: (file) => api.get(`/admin/customer-backups/${encodeURIComponent(file)}`, { responseType: 'blob', timeout: 0, headers: ALL_CUSTOMERS }).then((r) => r.data),
  deleteCustomerBackup: (file) => api.delete(`/admin/customer-backups/${encodeURIComponent(file)}`, { headers: ALL_CUSTOMERS }).then((r) => r.data),
  importSavedCustomerBackup: (file) => api.post(`/admin/customer-backups/${encodeURIComponent(file)}/import`, {}, { timeout: 0, headers: ALL_CUSTOMERS }).then((r) => r.data),
  importCustomerBackup: (formData) => api.post('/admin/customer-backups/import', formData, { timeout: 0, headers: ALL_CUSTOMERS }).then((r) => r.data),
  getCurrentCustomer: () => api.get('/admin/customer').then((r) => r.data),
  updateCurrentCustomer: (payload) => api.patch('/admin/customer', payload).then((r) => r.data),
  testDelivery: () => api.post('/admin/customer/delivery/test').then((r) => r.data),

  // AI spend log: always the all-customers view (agency admins only); filter by customerId.
  getUsageLogs: (params) => api.get('/admin/ai-usage', { params, headers: ALL_CUSTOMERS }).then((r) => r.data),
  getUsageLogDetail: (id) => api.get(`/admin/ai-usage/${id}`, { headers: ALL_CUSTOMERS }).then((r) => r.data),
  getUsageSummary: (params) => api.get('/admin/ai-usage/summary', { params, headers: ALL_CUSTOMERS }).then((r) => r.data),
  getUsageByUsers: (params) => api.get('/admin/ai-usage/users', { params, headers: ALL_CUSTOMERS }).then((r) => r.data),
  getUsageByCustomers: (params) => api.get('/admin/ai-usage/customers', { params, headers: ALL_CUSTOMERS }).then((r) => r.data),
  getUsageByModels: (params) => api.get('/admin/ai-usage/models', { params, headers: ALL_CUSTOMERS }).then((r) => r.data),
  exportUsageCsv: (params) => api.get('/admin/ai-usage/export.csv', { params, headers: ALL_CUSTOMERS, responseType: 'blob', timeout: 120000 }).then((r) => r.data),

  getEstimator: () => api.get('/admin/estimator').then((r) => r.data),
  estimateUsage: (payload) => api.post('/admin/estimator/estimate', payload).then((r) => r.data),
  getPricing: () => api.get('/admin/pricing').then((r) => r.data),
  // Web-searching the current prices can take a while - give it more room than the default.
  fetchPricing: (payload) => api.post('/admin/pricing/fetch', payload, { timeout: 180000 }).then((r) => r.data),
  savePricing: (payload) => api.put('/admin/pricing', payload).then((r) => r.data),
  resetPricing: () => api.delete('/admin/pricing').then((r) => r.data),

  // Email templates (agency)
  listEmailTemplates: () => api.get('/admin/email-templates').then((r) => r.data),
  previewEmailTemplate: (key, fields) => api.post(`/admin/email-templates/${key}/preview`, fields).then((r) => r.data),
  saveEmailTemplate: (key, fields) => api.put(`/admin/email-templates/${key}`, fields).then((r) => r.data),
  resetEmailTemplate: (key) => api.delete(`/admin/email-templates/${key}`).then((r) => r.data),
  testEmailTemplate: (key, fields) => api.post(`/admin/email-templates/${key}/test`, fields, { timeout: 60000 }).then((r) => r.data)
};

export const stockPhotosApi = {
  status: () => api.get('/stock-photos/status').then((r) => r.data),
  search: (query, { page, orientation } = {}) =>
    api.get('/stock-photos/search', { params: { query, page, orientation } }).then((r) => r.data)
};

export const linkedinApi = {
  getConnectUrl: () => api.get('/linkedin/connect-url').then((r) => r.data),
  getStatus: () => api.get('/linkedin/status').then((r) => r.data),
  disconnect: () => api.post('/linkedin/disconnect').then((r) => r.data)
};

export const metaApi = {
  getConnectUrl: () => api.get('/meta/connect-url').then((r) => r.data),
  getStatus: () => api.get('/meta/status').then((r) => r.data),
  disconnect: () => api.post('/meta/disconnect').then((r) => r.data)
};

export const xApi = {
  getConnectUrl: () => api.get('/x/connect-url').then((r) => r.data),
  getStatus: () => api.get('/x/status').then((r) => r.data),
  disconnect: () => api.post('/x/disconnect').then((r) => r.data)
};

export const youtubeApi = {
  getConnectUrl: () => api.get('/youtube/connect-url').then((r) => r.data),
  getStatus: () => api.get('/youtube/status').then((r) => r.data),
  disconnect: () => api.post('/youtube/disconnect').then((r) => r.data)
};

export const competitorsApi = {
  get: () => api.get('/competitors').then((r) => r.data),
  detect: () => api.post('/competitors/detect').then((r) => r.data),
  save: (competitors) => api.put('/competitors', { competitors }).then((r) => r.data),
  getNews: (refresh = false) => api.get('/competitors/news', { params: refresh ? { refresh: 'true' } : {} }).then((r) => r.data)
};

// Billboard print files (scale a creative up and export CMYK TIFF / PDF, preview, digital billboard image)
export const billboardApi = {
  config: () => api.get('/billboard/config').then((r) => r.data),
  start: (payload) => api.post('/billboard/export', payload).then((r) => r.data),
  get: (id) => api.get(`/billboard/export/${id}`).then((r) => r.data)
};

// Multi-scene Video (Generate Media -> Made for You)
export const sceneReelApi = {
  config: () => api.get('/scene-reels/config').then((r) => r.data),
  list: () => api.get('/scene-reels').then((r) => r.data),
  get: (id) => api.get(`/scene-reels/${id}`).then((r) => r.data),
  suggest: (payload) => api.post('/scene-reels/suggest', payload, { timeout: 120000 }).then((r) => r.data),
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/scene-reels/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  create: (payload) => api.post('/scene-reels', payload).then((r) => r.data),
  retry: (id) => api.post(`/scene-reels/${id}/retry`).then((r) => r.data),
  redoScene: (id, sceneId, changes = {}) => api.post(`/scene-reels/${id}/scenes/${sceneId}/redo`, changes).then((r) => r.data)
};
