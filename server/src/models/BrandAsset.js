import mongoose from 'mongoose';
import tenantPlugin from '../tenant/tenantPlugin.js';

const brandAssetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    // null = main brand; otherwise the _id of a Customer.subBrands entry.
    subBrand: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    // logo / product / texture / template / other: placed in designs when picked in Step 02.
    // reference: images used ONLY to understand the brand's look and feel (never placed or copied).
    // layout: a preferred layout the AI starts from when composing a design.
    // Reference and layout files are managed by the super admin and hidden from the customer's asset picker.
    kind: {
      type: String,
      enum: ['logo', 'product', 'texture', 'template', 'reference', 'layout', 'other'],
      default: 'other'
    },
    // Logos only: which version this is, so several logos can live side by side.
    logoVariant: { type: String, default: '', maxlength: 30 },
    // Shown on a dark background (a white logo, say). The Brand Assets screen shows it on a dark tile.
    onDark: { type: Boolean, default: false },
    // Reference files only: which style set it belongs to. photo = Photography Styling, illustration = Illustration Styling.
    styleGroup: { type: String, enum: ['', 'photo', 'illustration'], default: '' },
    // Short name shown on the tile ("White logo", "Festive layout") and a note on when to use it.
    label: { type: String, default: '', maxlength: 80 },
    notes: { type: String, default: '', maxlength: 300 }
  },
  { timestamps: true }
);

brandAssetSchema.plugin(tenantPlugin);

export default mongoose.model('BrandAsset', brandAssetSchema);
