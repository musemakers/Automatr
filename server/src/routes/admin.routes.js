import { Router } from 'express';
import { requireAuth, requireAgency, requireStaff } from '../middleware/auth.js';
import * as usersCtrl from '../controllers/admin.users.controller.js';
import * as industriesCtrl from '../controllers/admin.industries.controller.js';
import * as settingsCtrl from '../controllers/admin.settings.controller.js';
import * as customersCtrl from '../controllers/admin.customers.controller.js';
import * as pipelinesCtrl from '../controllers/admin.pipelines.controller.js';
import * as emailTplCtrl from '../controllers/admin.emailTemplates.controller.js';
import * as dashboardCtrl from '../controllers/admin.dashboard.controller.js';

const router = Router();

router.use(requireAuth);

// Two admin levels:
//   staff  = agency admin OR the customer's own admin ("customerAdmin") - the active customer's
//            team, model settings and delivery destination
//   agency = the agency's own staff only - customers, industries, usage/spend and pricing

// ---- Staff (agency admin or customer admin) -------------------------------------------------
// Users (a customer admin only ever sees/manages their own customer's people - see controller)
router.get('/users/meta', requireStaff, usersCtrl.meta);
router.get('/users', requireStaff, usersCtrl.listUsers);
router.get('/users/:id', requireStaff, usersCtrl.getUser);
router.post('/users', requireStaff, usersCtrl.createUser);
router.patch('/users/:id', requireStaff, usersCtrl.updateUser);
router.delete('/users/:id', requireStaff, usersCtrl.deleteUser);

// The active customer: details, delivery destination
router.get('/customer', requireStaff, customersCtrl.getCurrentCustomer);
router.patch('/customer', requireStaff, customersCtrl.updateCurrentCustomer);
router.post('/customer/delivery/test', requireStaff, customersCtrl.testCurrentDelivery);

// Model settings (agency admins only: per customer, or ?scope=global for the shared defaults)
router.get('/settings/news', requireAgency, settingsCtrl.getNewsSettings);
router.patch('/settings/news', requireAgency, settingsCtrl.updateNewsSettings);
router.get('/settings/generation', requireAgency, settingsCtrl.getGenerationSettings);
router.patch('/settings/generation', requireAgency, settingsCtrl.updateGenerationSettings);
router.patch('/settings/generation/image', requireAgency, settingsCtrl.updateImageModelSettings);
router.patch('/settings/generation/vision', requireAgency, settingsCtrl.updateVisionModelSettings);
router.get('/settings/generation/video', requireAgency, settingsCtrl.getVideoModelSettings);
router.patch('/settings/generation/video', requireAgency, settingsCtrl.updateVideoModelSettings);
router.get('/settings/providers', requireAgency, settingsCtrl.getProviderMatrix);
router.get('/settings/blanket-rules', requireAgency, settingsCtrl.getBlanketRules);
router.patch('/settings/blanket-rules/:key', requireAgency, settingsCtrl.updateBlanketRule);
router.delete('/settings/blanket-rules/:key', requireAgency, settingsCtrl.resetBlanketRuleSetting);
// Which workflows a saved AI block pipeline currently drives (shown as a banner on AI Settings)
router.get('/ai-pipelines/status', requireStaff, pipelinesCtrl.pipelineStatus);

// ---- Agency only ------------------------------------------------------------------------------
// Agency super admin dashboard (cross-customer roll-up)
router.get('/dashboard', requireAgency, dashboardCtrl.agencyDashboard);
router.get('/dashboard/gallery', requireAgency, dashboardCtrl.agencyGallery);

// Customers
router.get('/customers', requireAgency, customersCtrl.listCustomers);
router.get('/customers/usage', requireAgency, customersCtrl.customersUsage);
router.post('/customers', requireAgency, customersCtrl.createCustomerHandler);
router.patch('/customers/:id', requireAgency, customersCtrl.updateCustomerHandler);
router.post('/customers/:id/users', requireAgency, customersCtrl.createCustomerUser);
router.patch('/customers/:id/limits', requireAgency, customersCtrl.modifyLimits);
router.get('/customers/:id/limits-history', requireAgency, customersCtrl.limitsHistoryHandler);
router.post('/customers/:id/top-up', requireAgency, customersCtrl.topUpCustomer);
router.get('/customers/:id/top-ups', requireAgency, customersCtrl.topUpHistoryHandler);
// Backup / delete / import (a backup is one .zip: data + files; see services/customerBackupService.js)
router.get('/customers/:id/counts', requireAgency, customersCtrl.customerCountsHandler);
router.post('/customers/:id/backup', requireAgency, customersCtrl.backupCustomerHandler);
router.delete('/customers/:id', requireAgency, customersCtrl.deleteCustomerHandler);
router.get('/customer-backups', requireAgency, customersCtrl.listBackupsHandler);
router.post('/customer-backups/import', requireAgency, customersCtrl.uploadBackupFile, customersCtrl.importUploadedBackupHandler);
router.get('/customer-backups/:file', requireAgency, customersCtrl.downloadBackupHandler);
router.delete('/customer-backups/:file', requireAgency, customersCtrl.deleteBackupHandler);
router.post('/customer-backups/:file/import', requireAgency, customersCtrl.importSavedBackupHandler);

// AI Block Architecture (agency only): the block graph that drives each generation workflow.
// ?scope=global edits the agency default; otherwise the selected customer's own pipeline.
router.get('/ai-pipelines', requireAgency, pipelinesCtrl.getPipelines);
router.put('/ai-pipelines/:workflow', requireAgency, pipelinesCtrl.putPipeline);
router.delete('/ai-pipelines/:workflow', requireAgency, pipelinesCtrl.deletePipeline);
router.post('/ai-pipelines/:workflow/preview', requireAgency, pipelinesCtrl.previewPipeline);

// Industry segments (shared across customers)
router.get('/industries', requireAgency, industriesCtrl.list);
router.post('/industries', requireAgency, industriesCtrl.create);
router.patch('/industries/:id', requireAgency, industriesCtrl.update);
router.delete('/industries/:id', requireAgency, industriesCtrl.remove);

// AI usage (scoped to the selected customer, or all customers with X-Customer-Id: all)
router.get('/ai-usage/users', requireAgency, settingsCtrl.getUsageByUsers);
router.get('/ai-usage/summary', requireAgency, settingsCtrl.getUsageSummary);
router.get('/ai-usage/customers', requireAgency, settingsCtrl.getUsageByCustomers);
router.get('/ai-usage/models', requireAgency, settingsCtrl.getUsageByModels);
router.get('/ai-usage/export.csv', requireAgency, settingsCtrl.exportUsageCsv);
router.get('/ai-usage', requireAgency, settingsCtrl.getUsageLogs);
router.get('/ai-usage/:id', requireAgency, settingsCtrl.getUsageLogDetail); // keep after the fixed /ai-usage/... routes above

// Usage estimator + AI pricing
router.get('/estimator', requireAgency, settingsCtrl.getEstimatorSettings);
router.post('/estimator/estimate', requireAgency, settingsCtrl.postUsageEstimate);
// Email templates (agency-wide; used for every email the app sends)
router.get('/email-templates', requireAgency, emailTplCtrl.listTemplates);
router.post('/email-templates/:key/preview', requireAgency, emailTplCtrl.previewTemplate);
router.post('/email-templates/:key/test', requireAgency, emailTplCtrl.testTemplate);
router.put('/email-templates/:key', requireAgency, emailTplCtrl.saveTemplate);
router.delete('/email-templates/:key', requireAgency, emailTplCtrl.resetTemplate);

router.get('/pricing', requireAgency, settingsCtrl.getSavedPricing);
router.post('/pricing/fetch', requireAgency, settingsCtrl.fetchPricingProposal);
router.put('/pricing', requireAgency, settingsCtrl.savePricingSettings);
router.delete('/pricing', requireAgency, settingsCtrl.resetPricingSettings);

export default router;
