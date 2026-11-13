import {
  listAllSegments,
  createSegment,
  updateSegment,
  deleteSegment
} from '../services/industrySegmentsService.js';

export async function list(_req, res, next) {
  try {
    const segments = await listAllSegments();
    res.json({ segments });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const { name, group, order, tickers, news } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });

    const segment = await createSegment({ name, group, order, tickers, news });
    res.status(201).json({ segment });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: `An industry segment named "${req.body.name}" already exists.` });
    }
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const segment = await updateSegment(req.params.id, req.body);
    if (!segment) return res.status(404).json({ error: 'Industry segment not found.' });
    res.json({ segment });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Another industry segment already uses that name.' });
    }
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const segment = await deleteSegment(req.params.id);
    if (!segment) return res.status(404).json({ error: 'Industry segment not found.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
