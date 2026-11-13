import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { connectDB } from './config/db.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { uploadDirPath, storageInfo } from './middleware/upload.js';
import { seedIndustrySegmentsIfEmpty, backfillMissingCuratedData, ensureAdditionalSegments } from './services/industrySegmentsService.js';
import { seedDefaultAdminIfNone } from './services/adminSeedService.js';
import { providerStatus } from './services/ai/router.js';
import { APP_VERSION, BUILD_DATE } from './version.js';

import authRoutes from './routes/auth.routes.js';
import brandAssetsRoutes from './routes/brandAssets.routes.js';
import postsRoutes from './routes/posts.routes.js';
import newsRoutes from './routes/news.routes.js';
import aiRoutes from './routes/ai.routes.js';
import adminRoutes from './routes/admin.routes.js';
import stockPhotosRoutes from './routes/stockPhotos.routes.js';
import linkedinRoutes from './routes/linkedin.routes.js';
import metaRoutes from './routes/meta.routes.js';
import xRoutes from './routes/x.routes.js';
import youtubeRoutes from './routes/youtube.routes.js';
import competitorsRoutes from './routes/competitors.routes.js';
import customFeaturesRoutes from './routes/customFeatures.routes.js';
import mediaRoutes from './routes/media.routes.js';
import billboardRoutes from './routes/billboard.routes.js';
import sceneReelRoutes from './routes/sceneReel.routes.js';
import { recoverStaleSceneReels } from './services/ai/sceneReelService.js';
import { recoverStaleFeatureRuns } from './services/ai/customFeatureService.js';
import { loadPricingCache } from './services/pricingService.js';
import { loadBlanketRules } from './services/blanketRulesService.js';
import { runTenantMigration } from './services/tenantMigration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // server/src

const app = express();

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'automatr-api', version: APP_VERSION, buildDate: BUILD_DATE }));

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '15mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(uploadDirPath));

app.use('/api/auth', authRoutes);
app.use('/api/brand-assets', brandAssetsRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stock-photos', stockPhotosRoutes);
app.use('/api/linkedin', linkedinRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/x', xRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/competitors', competitorsRoutes);
app.use('/api/custom-features', customFeaturesRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/billboard', billboardRoutes);
app.use('/api/scene-reels', sceneReelRoutes);

// ---------------------------------------------------------------------------
// Single-service deployment support (e.g. Railway): if the client has been
// built (client/dist exists - `npm run build` at repo root), serve it as
// static files and fall back to index.html for any non-API route so React
// Router's client-side routes (e.g. /dashboard, /settings) work on a hard
// refresh or direct link. No-ops if the client hasn't been built (e.g. you're
// running the API standalone), so this never breaks pure-API usage.
// ---------------------------------------------------------------------------
const clientDistPath = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
  console.log('[server] Serving built client from', clientDistPath);
}

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5050;

async function start() {
  try {
    await connectDB();
    // Multi-customer upgrade: creates the first customer and assigns existing data to it (once; idempotent).
    await runTenantMigration();
    await seedIndustrySegmentsIfEmpty();
    await backfillMissingCuratedData();
    await ensureAdditionalSegments().catch((e) => console.warn('[server] could not add new industry segments:', e.message));
    await seedDefaultAdminIfNone();
    await loadPricingCache(); // admin-saved AI pricing (Admin -> Usage Estimator); never throws
    await loadBlanketRules();
    // Same for custom-feature runs (Brief Studio): finished images are kept, "Try again" fills in the rest.
    await recoverStaleSceneReels().catch((e) => console.warn('[server] could not recover interrupted reels:', e.message));
    await recoverStaleFeatureRuns().catch((e) => console.warn('[server] could not recover interrupted custom-feature runs:', e.message));
    const storage = storageInfo();
    console.log(`[server] File storage: ${storage.dir} (${storage.source})${storage.writable ? '' : ' - NOT WRITABLE'}`);
    if (!storage.writable) {
      console.error('[server] ERROR: the upload folder is not writable - generated images/videos cannot be saved. On Railway set RAILWAY_RUN_UID=0 so the app can write to the mounted volume.');
    }
    if (storage.onRailway && !storage.persistent) {
      console.warn('[server] WARNING: running on Railway WITHOUT a persistent volume - every redeploy deletes all uploaded and generated files. Attach a volume (Service > Settings > Volumes) mounted at /data.');
    }
    app.listen(PORT, () => {
      console.log(`[server] AUTOMATr API v${APP_VERSION} (build ${BUILD_DATE}) listening on http://localhost:${PORT}`);
      const status = providerStatus();
      const configuredList = Object.entries(status).filter(([, v]) => v).map(([k]) => k);
      console.log(
        configuredList.length
          ? `[server] AI providers configured: ${configuredList.join(', ')}`
          : '[server] WARNING: no AI providers are configured (no OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY found) - text/image generation will use placeholders.'
      );
      if (!status.openai && !status.gemini) {
        console.log('[server] NOTE: image generation specifically needs OPENAI_API_KEY or GEMINI_API_KEY - Claude/Anthropic cannot generate images.');
      }
    });
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

start();
