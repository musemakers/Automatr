/**
 * Backfills a placeholder image onto any existing IndustrySegment news items
 * that don't have one yet. Needed because `image` was added to the schema
 * after the original seed data was already written to the database on some
 * installs - the one-time seeder (seedIndustrySegmentsIfEmpty) only runs
 * when the collection is empty, so it never touches already-seeded data.
 *
 * Safe to re-run any time: it only fills in items where `image` is missing
 * or blank, and never overwrites one that's already set (including ones an
 * admin deliberately typed in).
 *
 * Usage:
 *   cd server
 *   node src/scripts/backfillNewsImages.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import IndustrySegment from '../models/IndustrySegment.js';

function slugify(text) {
  return (text || 'news').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
}

async function main() {
  await connectDB();

  const segments = await IndustrySegment.find({ 'news.0': { $exists: true } });
  let updatedSegments = 0;
  let updatedItems = 0;

  for (const segment of segments) {
    let changed = false;
    segment.news = segment.news.map((item) => {
      if (item.image && item.image.trim()) return item;
      changed = true;
      updatedItems++;
      return { ...item.toObject(), image: `https://picsum.photos/seed/${encodeURIComponent(slugify(item.title))}/160/160` };
    });
    if (changed) {
      await segment.save();
      updatedSegments++;
    }
  }

  console.log(`[backfill:news-images] Updated ${updatedItems} news item(s) across ${updatedSegments} segment(s).`);
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill:news-images] failed:', err.message);
  process.exit(1);
});
