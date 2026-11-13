// Comprehensive catalog of social media post formats: platform + placement
// combinations, each with the correct aspect ratio for that specific
// placement (not just "Instagram" as one generic shape). `mediums` on a
// Post now stores an array of these format ids (e.g. "instagram_feed"),
// not bare platform names.
//
// `size` maps to the 3 actual dimensions gpt-image-1 supports - square
// (1024x1024), portrait (1024x1536, which is exactly a 2:3 ratio), and
// landscape (1536x1024). Every IMAGE format below maps to whichever of
// those 3 is the closest real match for its aspect ratio; multiple formats
// legitimately share the same underlying image size while differing in
// platform, label, and caption style notes.
//
// VIDEO formats (isVideo:true) skip `size` (there's no image to generate)
// and instead carry `videoAspectRatio` (one of the 3 ratios every
// configured video provider - Veo/Kling/Runway - actually accepts) and
// duration guidance used when submitting a video generation job - see
// services/ai/videoRouter.js and controllers/posts.controller.js#generateVariantVideo.
// ---------------------------------------------------------------------------------------------
// ONE SIZE LIST, shared by every flow (Size Adapt, Subject Swap, Headline Switch, Adaptation, New Creative).
// SIZE_CATALOG: picker platform -> [id, label, width px, height px].
//  - ids of existing placements are reused as-is (stored posts keep working);
//  - ids marked NEW_ below are added to ADAPT_ONLY_FORMATS (print / outdoor / stationery / extra social sizes).
//  - "Custom": ids look like `custom_<W>x<H>` (16-8000 px each), resolved by getFormat() on client AND server.
// Print sizes are the trim size at 300 dpi for small items and 150 dpi for large ones (A2 and up);
// outdoor sizes keep the real aspect ratio at a practical pixel size. Bleed is not included.
// ---------------------------------------------------------------------------------------------
export const CUSTOM_MIN = 16;
export const CUSTOM_MAX = 8000;

export const IMAGE_PLATFORM_ORDER = ['Instagram', 'Facebook', 'LinkedIn', 'X (Twitter)', 'Pinterest', 'YouTube', 'TikTok', 'Google Display ads', 'Email and web', 'Leaflets and flyers', 'Posters', 'Print ads', 'Billboards', 'Outdoor', 'Stationery', 'Custom'];

// [id, label, w, h, group of the NEW entry (omit when the id already exists)]
export const SIZE_CATALOG = {
  'Instagram': [['instagram_feed', 'Feed (4:5)', 1080, 1350], ['instagram_square', 'Square (1:1)', 1080, 1080], ['instagram_feed_landscape', 'Feed landscape (1.91:1)', 1080, 566, 'Instagram'], ['instagram_story', 'Story / Reel cover (9:16)', 1080, 1920]],
  'Facebook': [['facebook_feed', 'Feed (1.91:1)', 1200, 628], ['facebook_square', 'Feed square (1:1)', 1080, 1080], ['facebook_feed_portrait', 'Feed portrait (4:5)', 1080, 1350, 'Facebook'], ['facebook_story', 'Story (9:16)', 1080, 1920], ['facebook_cover', 'Page cover', 1640, 624], ['facebook_event_cover', 'Event cover', 1920, 1005, 'Facebook']],
  'LinkedIn': [['linkedin_feed', 'Post landscape (1.91:1)', 1200, 627], ['linkedin_square', 'Post square (1:1)', 1080, 1080], ['linkedin_feed_portrait', 'Post portrait (4:5)', 1080, 1350, 'LinkedIn'], ['linkedin_company_cover', 'Company page cover', 1128, 191, 'LinkedIn'], ['linkedin_banner', 'Personal banner', 1584, 396]],
  'X (Twitter)': [['x_feed', 'Post (16:9)', 1600, 900], ['x_square', 'Post square (1:1)', 1080, 1080], ['x_header', 'Profile header', 1500, 500]],
  'Pinterest': [['pinterest_pin', 'Standard pin (2:3)', 1000, 1500], ['pinterest_square', 'Square pin (1:1)', 1000, 1000], ['pinterest_long', 'Long pin (1:2.1)', 1000, 2100, 'Pinterest']],
  'YouTube': [['youtube_thumbnail', 'Thumbnail (16:9)', 1280, 720], ['youtube_channel_banner', 'Channel banner', 2560, 1440]],
  'TikTok': [['tiktok_cover', 'Video / cover (9:16)', 1080, 1920, 'TikTok']],
  'Google Display ads': [['gads_medium_rectangle', 'Medium rectangle (300 × 250)', 300, 250], ['gads_large_rectangle', 'Large rectangle (336 × 280)', 336, 280], ['gads_leaderboard', 'Leaderboard (728 × 90)', 728, 90], ['gads_large_mobile', 'Large mobile banner (320 × 100)', 320, 100], ['gads_half_page', 'Half page (300 × 600)', 300, 600], ['gads_wide_skyscraper', 'Skyscraper (160 × 600)', 160, 600], ['gads_billboard', 'Billboard (970 × 250)', 970, 250]],
  'Email and web': [['email_header_600', 'Email header', 600, 200, 'Email'], ['web_hero_standard', 'Website hero (16:9)', 1920, 1080], ['web_og_image', 'Blog or share image (1.91:1)', 1200, 630]],
  'Leaflets and flyers': [['leaflet_a6', 'A6 (105 × 148 mm)', 1240, 1748, 'Leaflets and flyers'], ['leaflet_a5', 'A5 (148 × 210 mm)', 1748, 2480, 'Leaflets and flyers'], ['leaflet_a4', 'A4 (210 × 297 mm)', 2480, 3508, 'Leaflets and flyers'], ['leaflet_dl', 'DL (99 × 210 mm)', 1170, 2480, 'Leaflets and flyers'], ['leaflet_us_letter', 'US Letter (8.5 × 11 in)', 2550, 3300, 'Leaflets and flyers'], ['leaflet_trifold_panel', 'Tri-fold panel (DL)', 1170, 2480, 'Leaflets and flyers']],
  'Posters': [['poster_a3', 'A3 (297 × 420 mm)', 3508, 4961, 'Posters'], ['poster_a2', 'A2 (420 × 594 mm)', 2480, 3508, 'Posters'], ['poster_a1', 'A1 (594 × 841 mm)', 3508, 4961, 'Posters'], ['poster_18x24', '18 × 24 in', 2700, 3600, 'Posters'], ['poster_24x36', '24 × 36 in', 3600, 5400, 'Posters']],
  'Print ads': [['printad_magazine_a4', 'Magazine full page (A4)', 2480, 3508, 'Print ads'], ['printad_magazine_us', 'Magazine full page (US)', 2550, 3300, 'Print ads'], ['printad_magazine_half_landscape', 'Magazine half page, landscape', 2480, 1748, 'Print ads'], ['printad_magazine_half_portrait', 'Magazine half page, portrait', 1240, 3508, 'Print ads'], ['printad_magazine_spread', 'Magazine double-page spread', 4961, 3508, 'Print ads'], ['printad_newspaper_full', 'Newspaper full page (tabloid)', 3300, 5100, 'Print ads'], ['printad_newspaper_half', 'Newspaper half page', 3300, 2550, 'Print ads'], ['printad_newspaper_quarter', 'Newspaper quarter page', 1650, 2550, 'Print ads']],
  'Billboards': [['billboard_20x10', '20 × 10 ft billboard (2:1)', 2400, 1200, 'Billboards'], ['billboard_30x10', '30 × 10 ft billboard (3:1)', 3600, 1200, 'Billboards'], ['billboard_30x15', '30 × 15 ft billboard (2:1)', 2400, 1200, 'Billboards'], ['billboard_30x20', '30 × 20 ft billboard (3:2)', 2400, 1600, 'Billboards'], ['billboard_40x20', '40 × 20 ft billboard (2:1)', 2400, 1200, 'Billboards'], ['billboard_40x30', '40 × 30 ft billboard (4:3)', 2400, 1800, 'Billboards'], ['billboard_60x20', '60 × 20 ft billboard (3:1)', 3600, 1200, 'Billboards'], ['billboard_60x30', '60 × 30 ft billboard (2:1)', 2400, 1200, 'Billboards'], ['billboard_20x20', '20 × 20 ft square billboard (1:1)', 1800, 1800, 'Billboards'], ['billboard_10x20', '10 × 20 ft portrait billboard (1:2)', 1200, 2400, 'Billboards'], ['billboard_6x4', '6 × 4 ft small format / kiosk (3:2)', 1800, 1200, 'Billboards'], ['outdoor_billboard_48', '48 × 14 ft bulletin (48-sheet)', 4800, 1400, 'Billboards']],
  'Outdoor': [['outdoor_poster_30', '30-sheet poster', 3000, 1500, 'Outdoor'], ['outdoor_bus_shelter', '6-sheet / bus shelter', 2000, 3000, 'Outdoor'], ['outdoor_digital_landscape', 'Digital billboard, landscape (16:9)', 1920, 1080, 'Outdoor'], ['outdoor_digital_portrait', 'Digital billboard, portrait (9:16)', 1080, 1920, 'Outdoor'], ['outdoor_rollup_banner', 'Roll-up banner', 1700, 4000, 'Outdoor']],
  'Stationery': [['stationery_bizcard_eu', 'Business card (EU, 85 × 55 mm)', 1004, 650, 'Stationery'], ['stationery_bizcard_us', 'Business card (US, 3.5 × 2 in)', 1050, 600, 'Stationery'], ['stationery_postcard', 'Postcard (6 × 4 in)', 1800, 1200, 'Stationery'], ['stationery_letterhead', 'Letterhead / envelope DL (220 × 110 mm)', 2598, 1299, 'Stationery']],
  'Custom': []
};

// Video has its own shorter list. ids are `v:<platform>:<label>` (or `custom_<W>x<H>` for Custom).
export const VIDEO_PLATFORM_ORDER = ['Instagram', 'Facebook', 'LinkedIn', 'X (Twitter)', 'Pinterest', 'YouTube', 'TikTok', 'Google and YouTube ads', 'Email and web', 'Outdoor (digital)', 'Custom'];
const V = (platform, rows) => rows.map(([label, w, h]) => ({ id: `v:${platform}:${label}`, label, w, h }));
const REEL_SET = [['Reel / Story (9:16)', 1080, 1920], ['Feed portrait (4:5)', 1080, 1350], ['Feed square (1:1)', 1080, 1080], ['Feed landscape (16:9)', 1920, 1080]];
export const VIDEO_SIZE_LIST = {
  'Instagram': V('Instagram', REEL_SET),
  'Facebook': V('Facebook', REEL_SET),
  'LinkedIn': V('LinkedIn', [['Landscape (16:9)', 1920, 1080], ['Square (1:1)', 1080, 1080], ['Portrait (4:5)', 1080, 1350], ['Vertical (9:16)', 1080, 1920]]),
  'X (Twitter)': V('X (Twitter)', [['Landscape (16:9)', 1920, 1080], ['Square (1:1)', 1080, 1080], ['Vertical (9:16)', 1080, 1920]]),
  'Pinterest': V('Pinterest', [['Standard video pin (2:3)', 1000, 1500], ['Square (1:1)', 1000, 1000], ['Vertical (9:16)', 1080, 1920]]),
  'YouTube': V('YouTube', [['Standard video (16:9)', 1920, 1080], ['Shorts (9:16)', 1080, 1920]]),
  'TikTok': V('TikTok', [['Video (9:16)', 1080, 1920]]),
  'Google and YouTube ads': V('Google and YouTube ads', [['In-stream / display video (16:9)', 1920, 1080], ['Vertical (9:16)', 1080, 1920], ['Square (1:1)', 1080, 1080]]),
  'Email and web': V('Email and web', [['Website hero video (16:9)', 1920, 1080], ['Website hero video, wide (21:9)', 2560, 1080], ['Embedded video (16:9, lighter)', 1280, 720]]),
  'Outdoor (digital)': V('Outdoor (digital)', [['Digital billboard, landscape (16:9)', 1920, 1080], ['Digital billboard, portrait (9:16)', 1080, 1920]]),
  'Custom': []
};

// Platforms that carry post copy; everything else is a plain creative.
export const SOCIAL_PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'X (Twitter)', 'Pinterest', 'YouTube', 'TikTok'];
export function isSocialPlatform(platform) {
  return SOCIAL_PLATFORMS.includes(platform === 'X' ? 'X (Twitter)' : platform);
}

const roundRatio = (n) => String(Math.round(n * 100) / 100);
export function ratioText(w, h) {
  const r = w / h;
  return r >= 1 ? `${roundRatio(r)}:1` : `1:${roundRatio(1 / r)}`;
}
const orientationOf = (w, h) => (Math.abs(w - h) / Math.max(w, h) < 0.03 ? 'square' : w > h ? 'landscape' : 'portrait');
// Size asked of the image model: long edge 1536, never thinner than 3:1 (the result is then cropped/resized to the exact px).
export function modelSizeFor(w, h) {
  const r = Math.min(3, Math.max(1 / 3, w / h));
  const snap = (n) => Math.max(512, Math.round(n / 16) * 16);
  return r >= 1 ? `1536x${snap(1536 / r)}` : `${snap(1536 * r)}x1536`;
}
const PRINT_GROUPS = ['Leaflets and flyers', 'Posters', 'Print ads', 'Stationery'];
function noteFor(group, w, h) {
  if (PRINT_GROUPS.includes(group)) return 'print';
  if (group === 'Billboards') return 'billboard';
  const r = w / h;
  return r > 2.6 || r < 0.38 ? 'safe' : undefined;
}

export const POST_FORMATS = [
  // --------------------------- Instagram ---------------------------
  { id: 'instagram_feed', platform: 'Instagram', label: 'Instagram Feed', ratio: '4:5', orientation: 'portrait', size: '1024x1280' },
  { id: 'instagram_square', platform: 'Instagram', label: 'Instagram Square', ratio: '1:1', orientation: 'square', size: '1024x1024' },
  { id: 'instagram_story', platform: 'Instagram', label: 'Instagram Story', ratio: '9:16', orientation: 'portrait', size: '864x1536' },
  {
    id: 'instagram_carousel',
    platform: 'Instagram',
    label: 'Instagram Carousel',
    ratio: '4:5',
    orientation: 'portrait',
    size: '1024x1280',
    isCarousel: true,
    minSlides: 2,
    maxSlides: 10 // Instagram's own cap on a single carousel post
  },
  { id: 'instagram_reel', platform: 'Instagram', label: 'Instagram Reel', ratio: '9:16', orientation: 'portrait', isVideo: true, videoAspectRatio: '9:16', maxDurationSeconds: 90, recommendedDurationSeconds: 15 },
  { id: 'instagram_story_video', platform: 'Instagram', label: 'Instagram Story (Video)', ratio: '9:16', orientation: 'portrait', isVideo: true, videoAspectRatio: '9:16', maxDurationSeconds: 60, recommendedDurationSeconds: 10 },
  { id: 'instagram_feed_video', platform: 'Instagram', label: 'Instagram Feed Video', ratio: '4:5', orientation: 'portrait', isVideo: true, videoAspectRatio: '9:16', maxDurationSeconds: 60, recommendedDurationSeconds: 20 },

  // --------------------------- Facebook ---------------------------
  { id: 'facebook_feed', platform: 'Facebook', label: 'Facebook Feed', ratio: '1.91:1', orientation: 'landscape', size: '1520x800' },
  { id: 'facebook_square', platform: 'Facebook', label: 'Facebook Square', ratio: '1:1', orientation: 'square', size: '1024x1024' },
  { id: 'facebook_story', platform: 'Facebook', label: 'Facebook Story', ratio: '9:16', orientation: 'portrait', size: '864x1536' },
  {
    id: 'facebook_carousel',
    platform: 'Facebook',
    label: 'Facebook Carousel',
    ratio: '1:1',
    orientation: 'square',
    size: '1024x1024',
    isCarousel: true,
    minSlides: 2,
    maxSlides: 10
  },
  { id: 'facebook_reel', platform: 'Facebook', label: 'Facebook Reel', ratio: '9:16', orientation: 'portrait', isVideo: true, videoAspectRatio: '9:16', maxDurationSeconds: 90, recommendedDurationSeconds: 15 },
  { id: 'facebook_story_video', platform: 'Facebook', label: 'Facebook Story (Video)', ratio: '9:16', orientation: 'portrait', isVideo: true, videoAspectRatio: '9:16', maxDurationSeconds: 60, recommendedDurationSeconds: 10 },
  { id: 'facebook_feed_video', platform: 'Facebook', label: 'Facebook Feed Video', ratio: '16:9', orientation: 'landscape', isVideo: true, videoAspectRatio: '16:9', maxDurationSeconds: 240, recommendedDurationSeconds: 20 },

  // --------------------------- LinkedIn ---------------------------
  { id: 'linkedin_feed', platform: 'LinkedIn', label: 'LinkedIn Feed', ratio: '1.91:1', orientation: 'landscape', size: '1520x800' },
  { id: 'linkedin_square', platform: 'LinkedIn', label: 'LinkedIn Square', ratio: '1:1', orientation: 'square', size: '1024x1024' },
  {
    id: 'linkedin_carousel',
    platform: 'LinkedIn',
    label: 'LinkedIn Carousel',
    ratio: '1:1',
    orientation: 'square',
    size: '1024x1024',
    isCarousel: true,
    minSlides: 2,
    maxSlides: 10 // matches LinkedIn's multi-image Posts API content type
  },
  { id: 'linkedin_video', platform: 'LinkedIn', label: 'LinkedIn Video', ratio: '16:9', orientation: 'landscape', isVideo: true, videoAspectRatio: '16:9', maxDurationSeconds: 600, recommendedDurationSeconds: 20 },
  { id: 'linkedin_video_square', platform: 'LinkedIn', label: 'LinkedIn Video (Square)', ratio: '1:1', orientation: 'square', isVideo: true, videoAspectRatio: '1:1', maxDurationSeconds: 600, recommendedDurationSeconds: 20 },

  // ------------------------------ X ------------------------------
  { id: 'x_feed', platform: 'X', label: 'X Post', ratio: '16:9', orientation: 'landscape', size: '1536x864' },
  { id: 'x_square', platform: 'X', label: 'X Square', ratio: '1:1', orientation: 'square', size: '1024x1024' },
  {
    id: 'x_carousel',
    platform: 'X',
    label: 'X Multi-Image Post',
    ratio: '1:1',
    orientation: 'square',
    size: '1024x1024',
    isCarousel: true,
    minSlides: 2,
    maxSlides: 4, // X attaches up to 4 images to one post - a grid, not a swipe, but the closest equivalent it has
    notSwipeable: true // distinguishes X's grid-of-4 from a true swipeable carousel, surfaced in the UI copy
  },
  { id: 'x_video', platform: 'X', label: 'X Video', ratio: '16:9', orientation: 'landscape', isVideo: true, videoAspectRatio: '16:9', maxDurationSeconds: 140, recommendedDurationSeconds: 15 },

  // ---------------------------- TikTok ----------------------------
  { id: 'tiktok_video', platform: 'TikTok', label: 'TikTok Video', ratio: '9:16', orientation: 'portrait', isVideo: true, videoAspectRatio: '9:16', maxDurationSeconds: 600, recommendedDurationSeconds: 15 },

  // --------------------------- Pinterest ---------------------------
  { id: 'pinterest_pin', platform: 'Pinterest', label: 'Pinterest Pin', ratio: '2:3', orientation: 'portrait', size: '1024x1536' },
  { id: 'pinterest_video_pin', platform: 'Pinterest', label: 'Pinterest Video Pin', ratio: '9:16', orientation: 'portrait', isVideo: true, videoAspectRatio: '9:16', maxDurationSeconds: 900, recommendedDurationSeconds: 15 },

  // ---------------------------- YouTube ----------------------------
  { id: 'youtube_thumbnail', platform: 'YouTube', label: 'YouTube Thumbnail', ratio: '16:9', orientation: 'landscape', size: '1536x864' },
  { id: 'youtube_shorts', platform: 'YouTube', label: 'YouTube Shorts', ratio: '9:16', orientation: 'portrait', isVideo: true, videoAspectRatio: '9:16', maxDurationSeconds: 180, recommendedDurationSeconds: 15 },
  { id: 'youtube_video', platform: 'YouTube', label: 'YouTube Video (long-form)', ratio: '16:9', orientation: 'landscape', isVideo: true, videoAspectRatio: '16:9', maxDurationSeconds: 43200, recommendedDurationSeconds: 30 }
];


// Extra placements that exist ONLY in "Adapt Creative" (porting a finished still to
// another size): website banners, Google Display sizes, email, print, outdoor and a
// few more social placements. They are deliberately not in POST_FORMATS so they never
// show up in the New Creative platform picker. `px` is the exact deliverable size in
// pixels; `size` is what the image model is asked for (long edge <= 3:1, since models
// can't draw 8:1 banners), after which the result is cropped and resized to `px`.
// adaptNote: 'safe' = very wide/thin strip, keep the key content in the centre band;
// 'print' = print piece, generous margins and legible type.
const LEGACY_ADAPT_ONLY_FORMATS = [
  { id: 'facebook_cover', platform: 'Facebook', label: 'Facebook Cover Photo', ratio: '2.63:1', orientation: 'landscape', size: '1536x592', px: '1640x624', adaptOnly: true, adaptNote: 'safe' },
  { id: 'linkedin_banner', platform: 'LinkedIn', label: 'LinkedIn Profile Banner', ratio: '4:1', orientation: 'landscape', size: '1536x512', px: '1584x396', adaptOnly: true, adaptNote: 'safe' },
  { id: 'x_header', platform: 'X', label: 'X Header Image', ratio: '3:1', orientation: 'landscape', size: '1536x512', px: '1500x500', adaptOnly: true, adaptNote: 'safe' },
  { id: 'youtube_channel_banner', platform: 'YouTube', label: 'YouTube Channel Banner', ratio: '16:9', orientation: 'landscape', size: '1536x864', px: '2560x1440', adaptOnly: true },
  { id: 'pinterest_square', platform: 'Pinterest', label: 'Pinterest Square Pin', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '1000x1000', adaptOnly: true },
  { id: 'whatsapp_status', platform: 'WhatsApp', label: 'WhatsApp Status', ratio: '9:16', orientation: 'portrait', size: '864x1536', px: '1080x1920', adaptOnly: true },
  { id: 'whatsapp_share', platform: 'WhatsApp', label: 'WhatsApp Share Image', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '1080x1080', adaptOnly: true },
  { id: 'snapchat_ad', platform: 'Snapchat', label: 'Snapchat Snap Ad', ratio: '9:16', orientation: 'portrait', size: '864x1536', px: '1080x1920', adaptOnly: true },
  { id: 'web_hero_wide', platform: 'Website', label: 'Website Hero Banner (horizontal)', ratio: '16:5', orientation: 'landscape', size: '1536x512', px: '1920x600', adaptOnly: true, adaptNote: 'safe' },
  { id: 'web_hero_standard', platform: 'Website', label: 'Website Hero Banner (16:9)', ratio: '16:9', orientation: 'landscape', size: '1536x864', px: '1920x1080', adaptOnly: true },
  { id: 'web_hero_mobile', platform: 'Website', label: 'Website Hero Banner (mobile)', ratio: '4:5', orientation: 'portrait', size: '1232x1536', px: '1080x1350', adaptOnly: true },
  { id: 'web_blog_header', platform: 'Website', label: 'Website Blog / Article Header', ratio: '1.91:1', orientation: 'landscape', size: '1536x800', px: '1200x628', adaptOnly: true },
  { id: 'web_og_image', platform: 'Website', label: 'Website Link Preview (Open Graph)', ratio: '1.90:1', orientation: 'landscape', size: '1536x800', px: '1200x630', adaptOnly: true },
  { id: 'web_square_tile', platform: 'Website', label: 'Website Square Tile / Card', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '1080x1080', adaptOnly: true },
  { id: 'web_strip', platform: 'Website', label: 'Website Slim Promo Strip', ratio: '6.40:1', orientation: 'landscape', size: '1536x512', px: '1920x300', adaptOnly: true, adaptNote: 'safe' },
  { id: 'gads_medium_rectangle', platform: 'Google Ads', label: 'Google Ads Medium Rectangle', ratio: '6:5', orientation: 'landscape', size: '1536x1280', px: '300x250', adaptOnly: true },
  { id: 'gads_large_rectangle', platform: 'Google Ads', label: 'Google Ads Large Rectangle', ratio: '6:5', orientation: 'landscape', size: '1536x1280', px: '336x280', adaptOnly: true },
  { id: 'gads_leaderboard', platform: 'Google Ads', label: 'Google Ads Leaderboard', ratio: '8.09:1', orientation: 'landscape', size: '1536x512', px: '728x90', adaptOnly: true, adaptNote: 'safe' },
  { id: 'gads_large_leaderboard', platform: 'Google Ads', label: 'Google Ads Large Leaderboard', ratio: '10.78:1', orientation: 'landscape', size: '1536x512', px: '970x90', adaptOnly: true, adaptNote: 'safe' },
  { id: 'gads_billboard', platform: 'Google Ads', label: 'Google Ads Billboard', ratio: '3.88:1', orientation: 'landscape', size: '1536x512', px: '970x250', adaptOnly: true, adaptNote: 'safe' },
  { id: 'gads_half_page', platform: 'Google Ads', label: 'Google Ads Half Page', ratio: '1:2', orientation: 'portrait', size: '768x1536', px: '300x600', adaptOnly: true },
  { id: 'gads_portrait', platform: 'Google Ads', label: 'Google Ads Portrait', ratio: '2:7', orientation: 'portrait', size: '512x1536', px: '300x1050', adaptOnly: true },
  { id: 'gads_skyscraper', platform: 'Google Ads', label: 'Google Ads Skyscraper', ratio: '1:5', orientation: 'portrait', size: '512x1536', px: '120x600', adaptOnly: true },
  { id: 'gads_wide_skyscraper', platform: 'Google Ads', label: 'Google Ads Wide Skyscraper', ratio: '4:15', orientation: 'portrait', size: '512x1536', px: '160x600', adaptOnly: true },
  { id: 'gads_banner', platform: 'Google Ads', label: 'Google Ads Banner', ratio: '7.80:1', orientation: 'landscape', size: '1536x512', px: '468x60', adaptOnly: true, adaptNote: 'safe' },
  { id: 'gads_large_mobile', platform: 'Google Ads', label: 'Google Ads Large Mobile Banner', ratio: '16:5', orientation: 'landscape', size: '1536x512', px: '320x100', adaptOnly: true, adaptNote: 'safe' },
  { id: 'gads_mobile_banner', platform: 'Google Ads', label: 'Google Ads Mobile Banner', ratio: '6.40:1', orientation: 'landscape', size: '1536x512', px: '320x50', adaptOnly: true, adaptNote: 'safe' },
  { id: 'gads_square', platform: 'Google Ads', label: 'Google Ads Square', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '250x250', adaptOnly: true },
  { id: 'gads_small_square', platform: 'Google Ads', label: 'Google Ads Small Square', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '200x200', adaptOnly: true },
  { id: 'gads_responsive_landscape', platform: 'Google Ads', label: 'Google Ads Responsive Landscape', ratio: '1.91:1', orientation: 'landscape', size: '1536x800', px: '1200x628', adaptOnly: true },
  { id: 'gads_responsive_square', platform: 'Google Ads', label: 'Google Ads Responsive Square', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '1200x1200', adaptOnly: true },
  { id: 'gads_responsive_portrait', platform: 'Google Ads', label: 'Google Ads Responsive Portrait', ratio: '4:5', orientation: 'portrait', size: '1232x1536', px: '960x1200', adaptOnly: true },
  { id: 'email_header', platform: 'Email', label: 'Email Emailer Header Banner', ratio: '3:1', orientation: 'landscape', size: '1536x512', px: '1200x400', adaptOnly: true, adaptNote: 'safe' },
  { id: 'email_hero', platform: 'Email', label: 'Email Emailer Hero', ratio: '3:2', orientation: 'landscape', size: '1536x1024', px: '1200x800', adaptOnly: true },
  { id: 'email_full', platform: 'Email', label: 'Email Emailer Full Creative', ratio: '4:5', orientation: 'portrait', size: '1232x1536', px: '1200x1500', adaptOnly: true },
  { id: 'email_square', platform: 'Email', label: 'Email Emailer Square Block', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '1200x1200', adaptOnly: true },
  { id: 'email_newsletter_header', platform: 'Email', label: 'Email Newsletter Masthead', ratio: '4:1', orientation: 'landscape', size: '1536x512', px: '1200x300', adaptOnly: true, adaptNote: 'safe' },
  { id: 'print_a4_portrait', platform: 'Print', label: 'Print A4 Pamphlet / Flyer (portrait)', ratio: '1:1.41', orientation: 'portrait', size: '1088x1536', px: '1240x1754', adaptOnly: true, adaptNote: 'print' },
  { id: 'print_a4_landscape', platform: 'Print', label: 'Print A4 Pamphlet (landscape)', ratio: '1.41:1', orientation: 'landscape', size: '1536x1088', px: '1754x1240', adaptOnly: true, adaptNote: 'print' },
  { id: 'print_a5_flyer', platform: 'Print', label: 'Print A5 Flyer', ratio: '1:1.42', orientation: 'portrait', size: '1088x1536', px: '874x1240', adaptOnly: true, adaptNote: 'print' },
  { id: 'print_a3_poster', platform: 'Print', label: 'Print A3 Poster', ratio: '1:1.41', orientation: 'portrait', size: '1088x1536', px: '1754x2480', adaptOnly: true, adaptNote: 'print' },
  { id: 'print_dl_flyer', platform: 'Print', label: 'Print DL Flyer / Leaflet', ratio: '1:2.12', orientation: 'portrait', size: '720x1536', px: '585x1240', adaptOnly: true, adaptNote: 'print' },
  { id: 'print_rollup', platform: 'Print', label: 'Print Roll-up Standee', ratio: '1:2.35', orientation: 'portrait', size: '656x1536', px: '680x1600', adaptOnly: true, adaptNote: 'print' },
  { id: 'outdoor_portrait', platform: 'Outdoor', label: 'Outdoor Poster / Bus Shelter (portrait)', ratio: '1:1.48', orientation: 'portrait', size: '1040x1536', px: '1080x1600', adaptOnly: true },
  { id: 'amazon_main', platform: 'Amazon', label: 'Amazon Main Product Image', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '2000x2000', adaptOnly: true },
  { id: 'amazon_portrait', platform: 'Amazon', label: 'Amazon Product Image (portrait 4:5)', ratio: '4:5', orientation: 'portrait', size: '1232x1536', px: '1600x2000', adaptOnly: true },
  { id: 'amazon_aplus_header', platform: 'Amazon', label: 'Amazon A+ Standard Header Image', ratio: '1.62:1', orientation: 'landscape', size: '1536x944', px: '970x600', adaptOnly: true },
  { id: 'amazon_aplus_wide', platform: 'Amazon', label: 'Amazon A+ Image & Dark Text Banner', ratio: '3.23:1', orientation: 'landscape', size: '1536x512', px: '970x300', adaptOnly: true, adaptNote: 'safe' },
  { id: 'amazon_aplus_premium', platform: 'Amazon', label: 'Amazon A+ Premium Full-width Banner', ratio: '2.44:1', orientation: 'landscape', size: '1536x624', px: '1464x600', adaptOnly: true, adaptNote: 'safe' },
  { id: 'amazon_aplus_square', platform: 'Amazon', label: 'Amazon A+ Square Module', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '300x300', adaptOnly: true },
  { id: 'amazon_brand_story', platform: 'Amazon', label: 'Amazon A+ Brand Story Background', ratio: '2.34:1', orientation: 'landscape', size: '1536x656', px: '1464x625', adaptOnly: true, adaptNote: 'safe' },
  { id: 'amazon_store_hero', platform: 'Amazon', label: 'Amazon Brand Store Hero (desktop)', ratio: '5:1', orientation: 'landscape', size: '1536x512', px: '3000x600', adaptOnly: true, adaptNote: 'safe' },
  { id: 'amazon_store_hero_mobile', platform: 'Amazon', label: 'Amazon Brand Store Hero (mobile)', ratio: '2.76:1', orientation: 'landscape', size: '1536x560', px: '1242x450', adaptOnly: true },
  { id: 'amazon_sponsored_brands', platform: 'Amazon', label: 'Amazon Sponsored Brands Custom Image', ratio: '1.91:1', orientation: 'landscape', size: '1536x800', px: '1200x628', adaptOnly: true },
  { id: 'flipkart_product', platform: 'Flipkart', label: 'Flipkart Product Image (square)', ratio: '1:1', orientation: 'square', size: '1024x1024', px: '1000x1000', adaptOnly: true },
  { id: 'flipkart_product_portrait', platform: 'Flipkart', label: 'Flipkart Product Image (portrait 4:5)', ratio: '4:5', orientation: 'portrait', size: '1232x1536', px: '1000x1250', adaptOnly: true },
  { id: 'flipkart_banner_desktop', platform: 'Flipkart', label: 'Flipkart Brand Banner (desktop)', ratio: '3.84:1', orientation: 'landscape', size: '1536x512', px: '1920x500', adaptOnly: true, adaptNote: 'safe' },
  { id: 'flipkart_banner_mobile', platform: 'Flipkart', label: 'Flipkart Brand Banner (mobile)', ratio: '2:1', orientation: 'landscape', size: '1536x768', px: '1080x540', adaptOnly: true }
];

// NEW entries from SIZE_CATALOG (print / outdoor / stationery / extra social sizes), same shape as the entries above.
const CATALOG_ENTRIES = [];
for (const rows of Object.values(SIZE_CATALOG)) {
  for (const [id, label, w, h, group] of rows) {
    if (!group) continue;
    const e = { id, platform: group, label: `${group} ${label}`, ratio: ratioText(w, h), orientation: orientationOf(w, h), size: modelSizeFor(w, h), px: `${w}x${h}`, adaptOnly: true };
    const note = noteFor(group, w, h);
    if (note) e.adaptNote = note;
    CATALOG_ENTRIES.push(e);
  }
}

export const ADAPT_ONLY_FORMATS = [...LEGACY_ADAPT_ONLY_FORMATS, ...CATALOG_ENTRIES];


// ---- Custom sizes: `custom_<W>x<H>` ----
export function customFormatId(w, h) { return `custom_${Math.round(w)}x${Math.round(h)}`; }
export function isValidCustomSize(w, h) {
  return Number.isFinite(w) && Number.isFinite(h) && w >= CUSTOM_MIN && w <= CUSTOM_MAX && h >= CUSTOM_MIN && h <= CUSTOM_MAX;
}
export function parseCustomId(id) {
  const m = /^custom_(\d{2,4})x(\d{2,4})$/.exec(typeof id === 'string' ? id : '');
  if (!m) return null;
  const w = +m[1], h = +m[2];
  return isValidCustomSize(w, h) ? { w, h } : null;
}
function customFormat(id, w, h) {
  const f = { id, platform: 'Custom', label: `${w} \u00D7 ${h} px`, ratio: ratioText(w, h), orientation: orientationOf(w, h), size: modelSizeFor(w, h), px: `${w}x${h}`, adaptOnly: true, custom: true };
  const note = noteFor('Custom', w, h);
  if (note) f.adaptNote = note;
  return f;
}

export const ADAPT_PLATFORM_ORDER = [
  // legacy platform names (as stored on the entries) in the new display order, then the rest
  'Instagram', 'Facebook', 'LinkedIn', 'X', 'Pinterest', 'YouTube', 'TikTok', 'Google Ads', 'Email', 'Website',
  'Leaflets and flyers', 'Posters', 'Print ads', 'Billboards', 'Outdoor', 'Print', 'Stationery', 'WhatsApp', 'Snapchat', 'Amazon', 'Flipkart', 'Custom'
];

const BY_ID = Object.fromEntries([...POST_FORMATS, ...ADAPT_ONLY_FORMATS].map((f) => [f.id, f]));

export function getFormat(id) {
  if (BY_ID[id]) return BY_ID[id];
  const c = parseCustomId(id);
  if (c) return customFormat(id, c.w, c.h);
  return BY_ID.instagram_feed;
}

export function isCarouselFormat(id) {
  return Boolean(BY_ID[id]?.isCarousel);
}

export function isVideoFormat(id) {
  return Boolean(BY_ID[id]?.isVideo);
}

// ---- Size picker helpers ----
const CATALOG_BY_ID = {};
for (const [platform, rows] of Object.entries(SIZE_CATALOG)) for (const [id, label, w, h] of rows) CATALOG_BY_ID[id] = { platform, label, w, h };
const VIDEO_BY_ID = {};
for (const [platform, rows] of Object.entries(VIDEO_SIZE_LIST)) for (const r of rows) VIDEO_BY_ID[r.id] = { platform, ...r };

/** Sizes for a picker platform: [{ id, label, w, h }]. mode 'video' uses the shorter video list. 'Custom' has none (the user types one). */
export function sizesForPlatform(platform, mode = 'image') {
  if (mode === 'video') return VIDEO_SIZE_LIST[platform] || [];
  return (SIZE_CATALOG[platform] || []).map(([id, label, w, h]) => ({ id, label, w, h }));
}
export function platformsFor(mode = 'image') { return mode === 'video' ? VIDEO_PLATFORM_ORDER : IMAGE_PLATFORM_ORDER; }
/** Which picker platform an id belongs to ('' when it is not in the picker list, e.g. WhatsApp or Amazon sizes). */
export function catalogPlatformOf(id) {
  if (VIDEO_BY_ID[id]) return VIDEO_BY_ID[id].platform;
  if (parseCustomId(id)) return 'Custom';
  return CATALOG_BY_ID[id]?.platform || '';
}
const DEFAULT_PX = { '4:5': [1080, 1350], '1:1': [1080, 1080], '9:16': [1080, 1920], '16:9': [1600, 900], '1.91:1': [1200, 628], '2:3': [1000, 1500] };
/** Exact output size in px for any id (catalog, legacy placements, custom, video). null if unknown. */
export function formatPx(id) {
  if (VIDEO_BY_ID[id]) return { w: VIDEO_BY_ID[id].w, h: VIDEO_BY_ID[id].h };
  const c = parseCustomId(id);
  if (c) return c;
  if (CATALOG_BY_ID[id]) return { w: CATALOG_BY_ID[id].w, h: CATALOG_BY_ID[id].h };
  const f = BY_ID[id];
  if (!f) return null;
  const px = typeof f.px === 'string' && /^\d+x\d+$/.test(f.px) ? f.px.split('x').map(Number) : DEFAULT_PX[f.ratio];
  return px ? { w: px[0], h: px[1] } : null;
}
/** "Instagram Feed (4:5)" style label for any id. */
export function formatLabel(id) {
  if (VIDEO_BY_ID[id]) return `${VIDEO_BY_ID[id].platform} ${VIDEO_BY_ID[id].label}`;
  const c = parseCustomId(id);
  if (c) return `Custom ${c.w} \u00D7 ${c.h} px`;
  if (CATALOG_BY_ID[id]) return `${CATALOG_BY_ID[id].platform} ${CATALOG_BY_ID[id].label}`;
  const f = BY_ID[id];
  return f ? `${f.platform} ${f.label}` : '';
}

// Video providers accept three aspect ratios; pick the closest one to a chosen video size.
const VIDEO_ASPECTS = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1]];
export function nearestVideoAspect(w, h) {
  const r = w / h;
  let best = VIDEO_ASPECTS[0];
  for (const a of VIDEO_ASPECTS) if (Math.abs(Math.log(r / a[1])) < Math.abs(Math.log(r / best[1]))) best = a;
  return best[0];
}

// Per-platform copywriting notes, now specific to placement where it
// actually changes tone (a Story caption reads very differently from a
// polished Feed caption, even on the same platform).
export const FORMAT_COPY_NOTES = {
  instagram_feed: 'Punchy, visual-first, 1-2 short sentences, light emoji OK.',
  instagram_square: 'Punchy, visual-first, 1-2 short sentences, light emoji OK.',
  instagram_story: 'Very short, casual, hook-first - written like on-screen Story text, not a polished feed caption.',
  instagram_carousel: 'Punchy opening line written to make someone stop and swipe - the rest can unpack the idea across slides like a mini narrative.',
  instagram_reel: 'Hook in the first line (this doubles as on-screen text/spoken hook) - casual, trend-aware, short.',
  instagram_story_video: 'Very short, casual, hook-first - written like on-screen Story text, not a polished feed caption.',
  instagram_feed_video: 'Hook-first opening line, casual but a touch more polished than a Reel caption - this plays in-feed alongside static posts.',
  facebook_feed: 'Conversational, 1-3 sentences, clear call to action.',
  facebook_square: 'Conversational, 1-3 sentences, clear call to action.',
  facebook_story: 'Very short, casual, hook-first - written like on-screen Story text.',
  facebook_carousel: 'Conversational opening that works as a hook for a swipeable set - clear call to action by the final slide.',
  facebook_reel: 'Hook in the first line, casual and trend-aware, short.',
  facebook_story_video: 'Very short, casual, hook-first - written like on-screen Story text.',
  facebook_feed_video: 'Conversational hook-first opening, clear call to action - this plays in-feed alongside static posts.',
  linkedin_feed: 'Professional but human, can be 2-4 sentences, no emoji spam.',
  linkedin_square: 'Professional but human, can be 2-4 sentences, no emoji spam.',
  linkedin_carousel: 'Professional, hook-first opening line - carousels on LinkedIn read like a short structured story or how-to across slides.',
  linkedin_video: 'Professional hook-first opening line - LinkedIn video performs best when the first 2 seconds state the point plainly.',
  linkedin_video_square: 'Professional hook-first opening line - LinkedIn video performs best when the first 2 seconds state the point plainly.',
  x_feed: 'Extremely tight, under 200 characters, no hashtags unless essential.',
  x_square: 'Extremely tight, under 200 characters, no hashtags unless essential.',
  x_carousel: 'Extremely tight, under 200 characters - the images do most of the work, this is a grid of up to 4 images in one post, not a swipeable carousel.',
  x_video: 'Extremely tight, under 200 characters - lead with the hook, the video does the rest.',
  tiktok_video: 'Casual, hook-first, written like on-screen caption text.',
  pinterest_pin: 'Descriptive and keyword-rich (Pinterest doubles as search) - 1-2 sentences, clear on what the pin is about.',
  pinterest_video_pin: 'Descriptive and keyword-rich (Pinterest doubles as search) - 1-2 sentences, clear on what the video is about.',
  youtube_thumbnail: 'N/A - thumbnails don\'t carry caption copy; keep this brief and treat it as a title suggestion instead.',
  youtube_shorts: 'Casual, hook-first, written like on-screen caption text.',
  youtube_video: 'Written like a video description: a hook-first opening line or two, can be slightly longer than a Shorts caption.'
};
