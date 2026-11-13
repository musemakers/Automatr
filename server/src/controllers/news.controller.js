import { getIndustrySnapshot, generateFreshTrendBlurb } from '../services/industryData.js';
import { getGroupedActiveSegments, getFlatActiveSegmentNames, prependNewsItem } from '../services/industrySegmentsService.js';

// The Industry Segment the person chose in Settings (user.company.industry) wins; the
// workspace's industry is only the fallback. (It used to be the other way round, so changing
// the segment in Settings never changed the news - the customer's industry always overrode it.)
function resolveIndustry(req, explicit) {
  return explicit || req.user?.company?.industry || req.customer?.industry;
}

// The workspace's country (set on the customer). Blank = India.
function resolveCountry(req) {
  return req.customer?.country || '';
}

export async function snapshot(req, res, next) {
  try {
    const industry = resolveIndustry(req, req.query.industry);
    const data = await getIndustrySnapshot(industry, { fresh: req.query.fresh === '1', country: resolveCountry(req) });
    res.json({ industry, country: resolveCountry(req), ...data });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    const industry = resolveIndustry(req, req.body.industry);
    const blurb = await generateFreshTrendBlurb(industry, resolveCountry(req));
    if (!blurb) return res.status(502).json({ error: 'Could not fetch a fresh news item right now. Try again shortly.' });

    // Persist it onto the segment so this is a lasting update (visible on
    // next page load, for every user on this industry) rather than only
    // appearing in the current browser tab.
    // Only for the default (India) market: the curated segment feed is shared by every customer,
    // so another country's story must not be saved into it.
    const c = resolveCountry(req).trim().toLowerCase();
    if (!c || c === 'india' || c === 'in') await prependNewsItem(industry, blurb);

    res.json({ item: blurb });
  } catch (err) {
    next(err);
  }
}

export async function industries(_req, res, next) {
  try {
    const [groups, flat] = await Promise.all([getGroupedActiveSegments(), getFlatActiveSegmentNames()]);
    res.json({ industries: flat, groups });
  } catch (err) {
    next(err);
  }
}
