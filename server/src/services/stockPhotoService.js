// Stock photo search, via the Pexels API (https://www.pexels.com/api/).
// Free, no per-request cost, and Pexels' CDN serves images with permissive
// CORS - so the client can fetch a chosen photo directly and stage it into
// the exact same reference-creative pipeline as a locally uploaded file,
// without the server ever downloading or storing the image itself.
const PEXELS_BASE_URL = 'https://api.pexels.com/v1';

export function isConfigured() {
  return Boolean(process.env.PEXELS_API_KEY);
}

/**
 * @param {{ query: string, page?: number, perPage?: number, orientation?: string }} args
 * @returns {Promise<{ photos: Array, page: number, perPage: number, totalResults: number }>}
 */
export async function searchPhotos({ query, page = 1, perPage = 15, orientation }) {
  if (!isConfigured()) {
    throw new Error('Stock photo search is not configured (missing PEXELS_API_KEY).');
  }
  if (!query || !query.trim()) {
    throw new Error('A search query is required.');
  }

  const params = new URLSearchParams({
    query: query.trim(),
    page: String(page),
    per_page: String(Math.min(Math.max(perPage, 1), 80)) // Pexels caps per_page at 80
  });
  if (orientation) params.set('orientation', orientation); // 'landscape' | 'portrait' | 'square'

  const response = await fetch(`${PEXELS_BASE_URL}/search?${params.toString()}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY }
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error('Stock photo search rate limit reached - try again shortly.');
    throw new Error(`Pexels API returned ${response.status}.`);
  }

  const data = await response.json();

  const photos = (data.photos || []).map((p) => ({
    id: p.id,
    width: p.width,
    height: p.height,
    alt: p.alt || '',
    avgColor: p.avg_color || '',
    // "large2x" is a good balance of quality vs. download size for a
    // reference image (~1880px wide) - "original" is unnecessarily huge for
    // this purpose, and both are hotlinkable directly by the browser.
    previewUrl: p.src?.medium,
    fullUrl: p.src?.large2x || p.src?.large || p.src?.original,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    pexelsUrl: p.url
  }));

  return {
    photos,
    page: data.page || page,
    perPage: data.per_page || perPage,
    totalResults: data.total_results || 0
  };
}
