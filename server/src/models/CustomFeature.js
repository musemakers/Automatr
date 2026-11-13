import mongoose from 'mongoose';

// A "custom feature" built by a super admin in Brief Studio (Admin -> Brief Studio) and offered
// inside Generate Media. It belongs to the AGENCY, not to a customer, so it is deliberately NOT
// tenant-scoped: availability says which customers (or all) may use it once it is published.
//
//   draft      being designed; only the agency sees it
//   testing    spec has been generated / edited; agency can run test runs
//   published  live for the customers named in `availability`
//   archived   switched off; old runs stay viewable
export const FEATURE_STATUSES = ['draft', 'testing', 'published', 'archived'];
export const AVAILABILITY_MODES = ['none', 'all', 'selected'];

const customFeatureSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: '', maxlength: 200 },
    icon: { type: String, default: '✨', maxlength: 8 },
    brief: { type: String, default: '', maxlength: 6000 }, // the plain-English brief the admin wrote
    status: { type: String, enum: FEATURE_STATUSES, default: 'draft', index: true },

    // The generated, validated spec (see constants/customFeature.js#normalizeSpec).
    spec: { type: Object, default: {} },
    // Bumped on every change to `spec`. A test run records the version it ran against, and a feature
    // can only be published when its CURRENT version has had a successful test.
    specVersion: { type: Number, default: 1 },
    lastTestedVersion: { type: Number, default: 0 },
    lastTestedAt: { type: Date, default: null },

    availability: {
      mode: { type: String, enum: AVAILABILITY_MODES, default: 'none' },
      customers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }], default: [] }
    },
    publishedAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Optional reference image/video the admin uploaded: only the AI's written analysis is kept.
    referenceKind: { type: String, enum: ['', 'image', 'video'], default: '' },
    referenceName: { type: String, default: '', maxlength: 160 },
    referenceAnalysis: { type: String, default: '', maxlength: 6000 },
    // Image references only: a downsized copy kept as a layout / style guide for the image model (never sent to customers).
    referenceImage: { type: Buffer, select: false },
    referenceHasImage: { type: Boolean, default: false },
    // Image references only: the printed text blocks found on it (position + style), reused when rebuilding.
    referenceLayout: { type: Object, default: null },
    // Last note from the AI designer (e.g. "AI unavailable - starter template used").
    designNote: { type: String, default: '', maxlength: 400 }
  },
  { timestamps: true }
);

/** Is this feature usable by the given customer right now? */
customFeatureSchema.methods.isAvailableTo = function isAvailableTo(customerId) {
  if (this.status !== 'published') return false;
  if (this.availability?.mode === 'all') return true;
  if (this.availability?.mode === 'selected') {
    return (this.availability.customers || []).some((c) => String(c) === String(customerId));
  }
  return false;
};

export default mongoose.model('CustomFeature', customFeatureSchema);
