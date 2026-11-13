import mongoose from 'mongoose';
import tenantPlugin from '../tenant/tenantPlugin.js';

// One document per "Multi-scene Video" run. The pipeline runs server-side
// (see services/ai/multiSceneVideoService.js) and writes progress here; the
// client only polls GET /api/multi-scene-video/:id.
const sceneSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['hero', 'look', 'end'], required: true },
    title: { type: String, default: '' },
    label: { type: String, default: '' }, // look: day/occasion label. hero: kicker line
    subline: { type: String, default: '' }, // hero only
    seconds: { type: Number, default: 0 },
    stillPrompt: { type: String, default: '' },
    motionPrompt: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'still', 'animating', 'done', 'failed'], default: 'pending' },
    stillUrl: { type: String, default: '' },
    note: { type: String, default: '' }
  },
  { _id: false }
);

const multiSceneJobSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['planning', 'storyboard', 'running', 'stitching', 'completed', 'failed'], default: 'planning' },
    stage: { type: String, default: '' }, // human-readable current step
    error: { type: String, default: '' },
    brief: { type: Object, default: {} },
    capSeconds: { type: Number, default: 10 },
    totalSeconds: { type: Number, default: 0 },
    scenes: { type: [sceneSchema], default: [] },
    endCard: { type: Object, default: {} }, // { cta, urlText }
    files: { type: Object, default: {} }, // server-side paths of uploaded product/logo files
    videoUrl: { type: String, default: '' }
  },
  { timestamps: true }
);

multiSceneJobSchema.plugin(tenantPlugin);

export default mongoose.model('MultiSceneJob', multiSceneJobSchema);
