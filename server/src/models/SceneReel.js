import mongoose from 'mongoose';
import tenantPlugin from '../tenant/tenantPlugin.js';

// One document per multi-scene reel. The runner (services/ai/sceneReelService.js) writes progress here and the client
// polls GET /api/scene-reels/:id. Files are stored by NAME inside the customer's upload folder, never absolute paths.
const sceneSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    brief: { type: String, default: '' }, // what happens in the scene
    caption: { type: String, default: '' }, // optional on-screen line, drawn by code (never by the video model)
    seconds: { type: Number, default: 5 },
    transition: { type: String, default: 'fade' }, // how the scene comes in from the previous one
    ref: { type: String, default: '' }, // optional reference image: becomes the scene's starting frame
    status: { type: String, enum: ['pending', 'generating', 'done', 'failed'], default: 'pending' },
    clipFile: { type: String, default: '' }, // inside scenereel-<id>/
    frameFile: { type: String, default: '' }, // last frame of the clip (also the start of the next scene when "keep flowing" is on)
    note: { type: String, default: '' }
  },
  { _id: false }
);

const sceneReelSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'Multi-scene video' },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    stage: { type: String, default: '' },
    error: { type: String, default: '' },
    overallBrief: { type: String, default: '' },
    settings: {
      aspect: { type: String, default: '9:16' },
      totalTarget: { type: Number, default: 30 },
      continuity: { type: Boolean, default: true } // scene N+1 starts from the last frame of scene N
    },
    scenes: { type: [sceneSchema], default: [] },
    videoUrl: { type: String, default: '' },
    totalSeconds: { type: Number, default: 0 },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null } // the Saved Documents card made when the reel finishes
  },
  { timestamps: true }
);

sceneReelSchema.plugin(tenantPlugin);

export default mongoose.model('SceneReel', sceneReelSchema);
