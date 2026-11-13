import mongoose from 'mongoose';
import { redactConnectedAccounts } from './schemas/workspaceFields.js';

// admin         - agency staff (Musemakers): sees every customer, can switch between them
// customerAdmin - the customer's own admin: manages that one customer's settings, library, team
// member        - regular user inside one customer
export const ROLES = ['admin', 'customerAdmin', 'member'];

// Fine-grained access flags on top of role. Admins implicitly have every
// permission regardless of these flags (see middleware/auth.js#requirePermission).
// Members get a sensible default set - a team lead can dial individual
// teammates up or down from the admin panel without changing their role.
const DEFAULT_PERMISSIONS = {
  manageBrand: true,
  generateContent: true,
  approvePosts: true,
  publishPosts: true,
  manageTeam: false,
  manageIndustries: false
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Forgot-password flow: only the sha256 of the emailed one-time token is stored.
    resetTokenHash: { type: String, default: null, index: true },
    resetTokenExpires: { type: Date, default: null },
    resetRequestedAt: { type: Date, default: null },

    role: { type: String, enum: ROLES, default: 'member' },
    // Which customer this user belongs to. Agency admins ('admin') may leave it
    // empty - they pick a customer per request (X-Customer-Id) - or set it as
    // their default workspace.
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    permissions: {
      manageBrand: { type: Boolean, default: DEFAULT_PERMISSIONS.manageBrand },
      generateContent: { type: Boolean, default: DEFAULT_PERMISSIONS.generateContent },
      approvePosts: { type: Boolean, default: DEFAULT_PERMISSIONS.approvePosts },
      publishPosts: { type: Boolean, default: DEFAULT_PERMISSIONS.publishPosts },
      manageTeam: { type: Boolean, default: DEFAULT_PERMISSIONS.manageTeam },
      manageIndustries: { type: Boolean, default: DEFAULT_PERMISSIONS.manageIndustries }
    },
    isActive: { type: Boolean, default: true }, // soft-disable instead of hard delete from the admin panel

    company: {
      name: { type: String, trim: true, default: '' },
      designation: { type: String, trim: true, default: '' },
      // Not a hard Mongoose enum anymore - industry segments are now
      // admin-editable data in the IndustrySegment collection rather than a
      // fixed list baked into the schema. Validity is checked at the
      // controller level against the live segment list instead.
      industry: { type: String, default: 'Technology' }
    },
    // Dashboard's "Competitor Watch" panel - either AI-detected (via web
    // search, see competitorService.js) or manually entered/edited by the
    // user afterward. Kept simple (name + optional site) since this is
    // just enough to ground the news search, not a full CRM record.
    competitors: {
      type: [
        {
          name: { type: String, required: true, trim: true },
          website: { type: String, default: '' },
          _id: false
        }
      ],
      default: []
    },
    competitorsDetectedAt: { type: Date, default: null },
    brandKit: {
      colors: { type: [String], default: ['#0F2A5C', '#2E5EFF', '#EEF3FF', '#0A0E17', '#FFFFFF'] },
      fonts: {
        display: { type: String, default: 'Space Grotesk' },
        body: { type: String, default: 'IBM Plex Sans' },
        // AI's best-guess font suggestions from analyzing an uploaded asset.
        // Deliberately separate from the fields above: those are the actual
        // fonts the app renders with, and blindly overwriting them from an
        // image guess could break typography if that font isn't loaded. The
        // user reviews these in the UI and explicitly applies them if they
        // want to adopt them.
        suggestedDisplay: { type: String, default: '' },
        suggestedBody: { type: String, default: '' }
      },
      // AI-derived "design language" from the most recently analyzed brand
      // asset - reused as extra context when generating new media/copy
      // (see services/ai/designService.js, captionService.js).
      designLanguage: {
        colorRoles: {
          primary: { type: String, default: '' },
          secondary: { type: String, default: '' },
          accent: { type: String, default: '' },
          neutral: { type: String, default: '' }
        },
        logoType: { type: String, default: '' },
        typographyImpression: { type: String, default: '' },
        moodTags: { type: [String], default: [] },
        imageryStyle: { type: String, default: '' },
        voiceTone: { type: String, default: '' },
        // Where the tone of voice came from: 'guideline' (stated in an uploaded brand guideline), 'web' (found by searching the web), 'manual' (typed in by the team).
        voiceToneSource: { type: String, default: '' },
        // Fields a person has edited by hand; a re-analysis of an uploaded asset never overwrites these.
        editedFields: { type: [String], default: [] },
        summary: { type: String, default: '' },
        lastAnalyzedAsset: { type: mongoose.Schema.Types.ObjectId, ref: 'BrandAsset', default: null },
        lastAnalyzedAt: { type: Date, default: null },
        modelUsed: { type: String, default: '' }
      }
    },
    teammates: [
      {
        name: String,
        email: String,
        designation: String
      }
    ],

    // OAuth connections to social platforms, used by publishConnectors.js to
    // actually post on the user's behalf instead of simulating it. Only
    // LinkedIn is wired up for real so far - see server/README or the
    // publishConnectors.js header comment for how to add the others.
    connectedAccounts: {
      linkedin: {
        accessToken: { type: String, default: '' },
        refreshToken: { type: String, default: '' },
        expiresAt: { type: Date, default: null },
        personURN: { type: String, default: '' }, // e.g. "urn:li:person:abc123"
        name: { type: String, default: '' },
        email: { type: String, default: '' },
        connectedAt: { type: Date, default: null }
      },
      // One Meta (Facebook Login) connection powers both the Instagram and
      // Facebook connectors - a single Page access token can publish to the
      // Facebook Page itself and to whichever Instagram professional
      // account is linked to that Page.
      meta: {
        userAccessToken: { type: String, default: '' }, // long-lived (~60 day) user token
        expiresAt: { type: Date, default: null },
        pageId: { type: String, default: '' },
        pageName: { type: String, default: '' },
        pageAccessToken: { type: String, default: '' }, // derived from the user token - effectively non-expiring while the user token is valid
        instagramBusinessId: { type: String, default: '' }, // '' if the Page has no linked Instagram professional account
        instagramUsername: { type: String, default: '' },
        connectedAt: { type: Date, default: null }
      },
      x: {
        accessToken: { type: String, default: '' },
        refreshToken: { type: String, default: '' },
        expiresAt: { type: Date, default: null },
        userId: { type: String, default: '' },
        username: { type: String, default: '' },
        connectedAt: { type: Date, default: null }
      },
      youtube: {
        accessToken: { type: String, default: '' },
        refreshToken: { type: String, default: '' },
        expiresAt: { type: Date, default: null },
        channelId: { type: String, default: '' },
        channelTitle: { type: String, default: '' },
        connectedAt: { type: Date, default: null }
      }
    }
  },
  { timestamps: true }
);

/**
 * @param {object} [customer] Customer doc (or plain object). When given - or when
 * requireAuth attached one as this.$customerView - brand kit, competitors and
 * social connections are taken from the customer, not the (legacy) user fields.
 */
userSchema.methods.toSafeJSON = function toSafeJSON(customer) {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.resetTokenHash;
  delete obj.resetTokenExpires;
  delete obj.resetRequestedAt;
  const c = customer || this.$customerView;
  if (c) {
    const co = typeof c.toObject === 'function' ? c.toObject() : c;
    obj.brandKit = co.brandKit;
    // The brand guide (custom prompt instructions) is the agency's own working material.
    if (obj.role !== 'admin' && obj.brandKit && (obj.brandKit.guide || obj.brandKit.profile)) obj.brandKit = { ...obj.brandKit, guide: undefined, profile: undefined };
    obj.competitors = co.competitors;
    obj.competitorsDetectedAt = co.competitorsDetectedAt;
    obj.connectedAccounts = co.connectedAccounts;
  }
  // Tokens must never reach the client - only a redacted "is it connected"
  // shape does. Use GET /api/linkedin/status for the real connection state.
  if (obj.connectedAccounts) obj.connectedAccounts = redactConnectedAccounts(obj.connectedAccounts);
  return obj;
};

export const DEFAULT_MEMBER_PERMISSIONS = DEFAULT_PERMISSIONS;
export default mongoose.model('User', userSchema);
