import * as stockPhotoService from '../services/stockPhotoService.js';

export async function search(req, res, next) {
  try {
    const { query, page, perPage, orientation } = req.query;
    if (!query) return res.status(400).json({ error: 'query is required.' });

    const result = await stockPhotoService.searchPhotos({
      query,
      page: page ? Number(page) : undefined,
      perPage: perPage ? Number(perPage) : undefined,
      orientation
    });

    res.json(result);
  } catch (err) {
    if (err.message?.includes('not configured')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message?.includes('rate limit')) {
      return res.status(429).json({ error: err.message });
    }
    next(err);
  }
}

export function status(_req, res) {
  res.json({ configured: stockPhotoService.isConfigured() });
}
