import mongoose from 'mongoose';

// One saved AI block graph per workflow and scope. customer = null is the agency-wide default;
// a customer id is that customer's own pipeline (which wins over the agency default).
// Deliberately NOT tenant-plugged: the service always names the customer explicitly.
const aiPipelineSchema = new mongoose.Schema(
  {
    workflow: { type: String, required: true, enum: ['image', 'video', 'copy', 'multiscene'] },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
    updatedBy: { type: String, default: '' }
  },
  { timestamps: true }
);

aiPipelineSchema.index({ workflow: 1, customer: 1 }, { unique: true });

export default mongoose.model('AiPipeline', aiPipelineSchema);
