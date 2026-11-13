import Post from '../models/Post.js';
import { deliverPost } from '../services/deliveryService.js';

/** POST /api/posts/:id/deliver - send this post's finished creative to the customer's destination. */
export async function deliver(req, res, next) {
  try {
    const isStaff = req.user.role === 'admin' || req.user.role === 'customerAdmin';
    const filter = { _id: req.params.id };
    if (!isStaff) filter.user = req.user._id; // members only deliver their own posts; customer is scoped automatically
    const post = await Post.findOne(filter);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (!req.customer) return res.status(400).json({ error: 'Pick a customer workspace first.' });
    const result = await deliverPost(post, req.customer);
    res.json({ delivered: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
