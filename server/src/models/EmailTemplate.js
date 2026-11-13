import mongoose from 'mongoose';

// The agency's edited version of a transactional email (welcome, password reset, ...). One document
// per template key; a template with no document uses the built-in default in
// services/emailTemplateService.js. Global (not per customer) - deliberately not tenant-plugged.
const emailTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    subject: { type: String, required: true, maxlength: 200 },
    heading: { type: String, required: true, maxlength: 150 },
    body: { type: String, required: true, maxlength: 5000 },
    buttonLabel: { type: String, default: '', maxlength: 60 },
    updatedBy: { type: String, default: '' }
  },
  { timestamps: true }
);

export default mongoose.model('EmailTemplate', emailTemplateSchema);
