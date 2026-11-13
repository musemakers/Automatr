import IndustrySegment from '../models/IndustrySegment.js';
import { INDUSTRY_GROUPS, ADDITIONAL_INDUSTRY_GROUPS, ALL_INDUSTRY_GROUPS } from '../constants/industries.js';

// Curated launch data for the handful of industries the original design
// shipped with - used only to seed the DB the first time the app boots.
// After that, everything (including these) is normal admin-editable data.
const SEED_TICKERS_AND_NEWS = {
  'Fashion & Apparel': {
    tickers: [
      { symbol: 'NKE', price: 92.14, change: 1.2 },
      { symbol: 'LULU', price: 342.1, change: -0.8 },
      { symbol: 'RL', price: 168.32, change: 2.1 },
      { symbol: 'GAP', price: 21.45, change: 0.4 },
      { symbol: 'VFC', price: 14.87, change: -1.5 }
    ],
    news: [
      { title: '"Slow fashion" search interest up 22% this week', desc: 'Shoppers are favoring durability and provenance over speed - a good angle for launch copy.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-1/160/160' },
      { title: "Competitor spotlight: Marlow Co.'s founder-led campaign", desc: 'Their latest push leans on behind-the-scenes footage instead of polished product shots.', source: 'MARKET SCAN', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-101/160/160' },
      { title: 'Resale marketplaces grew 3x faster than full-price retail', desc: 'Circular fashion keeps gaining share, especially with buyers under 30.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-2/160/160' }
    ]
  },
  Technology: {
    tickers: [
      { symbol: 'AAPL', price: 227.5, change: 0.6 },
      { symbol: 'MSFT', price: 441.2, change: 1.1 },
      { symbol: 'NVDA', price: 118.3, change: -2.3 },
      { symbol: 'GOOGL', price: 178.9, change: 0.3 },
      { symbol: 'CRM', price: 312.4, change: 0.9 }
    ],
    news: [
      { title: 'On-device AI features drive a fresh upgrade cycle', desc: 'Manufacturers are leaning on privacy-first messaging to justify premium pricing.', source: 'TECH WIRE', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-3/160/160' },
      { title: 'Short-form product demos outperform static posts 3:1', desc: 'Engagement data continues to favor 15-30 second clips over single images.', source: 'RETAIL PULSE', time: '6H AGO', image: 'https://picsum.photos/seed/seed-news-4/160/160' },
      { title: 'Enterprise buyers now expect an AI roadmap in every pitch', desc: 'Sales teams report longer cycles when a product lacks a clear AI story.', source: 'MARKET SCAN', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-5/160/160' }
    ]
  },
  'Food & Beverage': {
    tickers: [
      { symbol: 'KO', price: 63.2, change: 0.2 },
      { symbol: 'PEP', price: 168.4, change: -0.5 },
      { symbol: 'MCD', price: 288.1, change: 0.9 },
      { symbol: 'SBUX', price: 95.7, change: -1.1 },
      { symbol: 'CMG', price: 56.3, change: 1.4 }
    ],
    news: [
      { title: '"High-protein" claims now appear on 1 in 4 new snack launches', desc: 'Brands are reformulating existing lines rather than launching net-new SKUs.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-6/160/160' },
      { title: 'Limited-time menu drops are outperforming permanent additions', desc: 'Scarcity-driven campaigns are seeing stronger social lift this quarter.', source: 'RETAIL PULSE', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-7/160/160' },
      { title: "Competitor spotlight: Brambleberry's founder-led campaign", desc: 'Their latest push leans on behind-the-scenes kitchen footage over plated shots.', source: 'MARKET SCAN', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-102/160/160' }
    ]
  },
  'Health & Wellness': {
    tickers: [
      { symbol: 'JNJ', price: 152.3, change: 0.4 },
      { symbol: 'PFE', price: 28.6, change: -0.7 },
      { symbol: 'UNH', price: 512.8, change: 1.6 },
      { symbol: 'LULU', price: 342.1, change: -0.8 },
      { symbol: 'HIMS', price: 22.9, change: 2.8 }
    ],
    news: [
      { title: 'Wearable-driven content is outperforming studio shoots', desc: 'Real progress data resonates more than polished before/afters right now.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-8/160/160' },
      { title: '"Recovery" overtakes "performance" as the top wellness keyword', desc: 'Search interest suggests audiences want rest framed as part of the routine.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-9/160/160' },
      { title: 'Subscription wellness apps see slower Q3 renewal rates', desc: 'Category-wide churn is up, with pricing cited as the top reason.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-10/160/160' }
    ]
  },
  'Financial Services': {
    tickers: [
      { symbol: 'JPM', price: 210.4, change: 0.8 },
      { symbol: 'GS', price: 480.2, change: -0.3 },
      { symbol: 'BAC', price: 39.7, change: 0.5 },
      { symbol: 'V', price: 281.6, change: 1.0 },
      { symbol: 'SCHW', price: 71.2, change: -0.6 }
    ],
    news: [
      { title: 'Plain-language fee explainers are outperforming rate promos', desc: 'Trust-building content is getting more saves and shares than APR callouts.', source: 'MARKET SCAN', time: '4H AGO', image: 'https://picsum.photos/seed/seed-news-11/160/160' },
      { title: 'Short educational reels drive the most new-account signups', desc: '"How it works" content is converting better than product-feature posts.', source: 'TRENDWATCH', time: '10H AGO', image: 'https://picsum.photos/seed/seed-news-12/160/160' },
      { title: "Competitor spotlight: Aldergate Bank's founder-led campaign", desc: 'Their latest push leans on customer-story testimonials over rate tables.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-103/160/160' }
    ]
  },
  'Travel & Hospitality': {
    tickers: [
      { symbol: 'MAR', price: 245.6, change: 1.0 },
      { symbol: 'DAL', price: 55.3, change: -0.6 },
      { symbol: 'ABNB', price: 132.7, change: 2.0 },
      { symbol: 'BKNG', price: 4820.1, change: 0.7 },
      { symbol: 'RCL', price: 198.4, change: -1.2 }
    ],
    news: [
      { title: '"Shoulder season" bookings are up across leisure travel', desc: 'Off-peak trip content is getting stronger engagement than peak-season posts.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-13/160/160' },
      { title: 'User-generated footage is outperforming produced property tours', desc: 'Guest clips are converting better than polished amenity walkthroughs.', source: 'RETAIL PULSE', time: '7H AGO', image: 'https://picsum.photos/seed/seed-news-14/160/160' },
      { title: "Competitor spotlight: Harlow Collection's founder-led campaign", desc: 'Their latest push leans on behind-the-scenes staff stories over room shots.', source: 'MARKET SCAN', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-104/160/160' }
    ]
  },
  'Retail & E-commerce': {
    tickers: [
      { symbol: 'AMZN', price: 198.4, change: 0.7 },
      { symbol: 'TGT', price: 142.9, change: -0.4 },
      { symbol: 'WMT', price: 82.1, change: 0.3 },
      { symbol: 'ETSY', price: 54.2, change: -1.8 },
      { symbol: 'SHOP', price: 78.9, change: 1.9 }
    ],
    news: [
      { title: 'Live shopping sessions are outperforming static product drops', desc: 'Real-time Q&A formats are converting at nearly double the rate of catalog posts.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-15/160/160' },
      { title: 'Free-shipping messaging still tops the list of purchase triggers', desc: 'Shoppers cite it above discount depth in recent survey data.', source: 'RETAIL PULSE', time: '6H AGO', image: 'https://picsum.photos/seed/seed-news-16/160/160' },
      { title: "Competitor spotlight: Fernwood Goods' founder-led campaign", desc: 'Their latest push leans on unboxing footage over studio product shots.', source: 'MARKET SCAN', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-105/160/160' }
    ]
  },
  'Media & Entertainment': {
    tickers: [
      { symbol: 'DIS', price: 98.2, change: -0.9 },
      { symbol: 'NFLX', price: 680.5, change: 1.4 },
      { symbol: 'CMCSA', price: 41.3, change: 0.2 },
      { symbol: 'WBD', price: 11.6, change: -2.1 },
      { symbol: 'SPOT', price: 412.8, change: 2.3 }
    ],
    news: [
      { title: 'Behind-the-scenes clips are outperforming trailers on save rate', desc: 'Audiences are engaging more with process content than polished promos.', source: 'TRENDWATCH', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-17/160/160' },
      { title: "Short-form recaps drive most of this week's discovery traffic", desc: 'Clip compilations are outperforming full-length uploads for new viewers.', source: 'RETAIL PULSE', time: '5H AGO', image: 'https://picsum.photos/seed/seed-news-106/160/160' },
      { title: "Competitor spotlight: Northlight Studios' founder-led campaign", desc: 'Their latest push leans on cast interviews over key-art reveals.', source: 'MARKET SCAN', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-107/160/160' }
    ]
  },
  'Beauty & Cosmetics': {
    tickers: [
      { symbol: 'EL', price: 132.4, change: -0.6 },
      { symbol: 'ULTA', price: 412.8, change: 1.3 },
      { symbol: 'COTY', price: 9.85, change: 0.4 },
      { symbol: 'IPAR', price: 118.6, change: 2 },
      { symbol: 'OLPX', price: 3.15, change: -1.9 }
    ],
    news: [
      { title: 'Clean-label ingredient callouts now outperform generic "natural" claims', desc: 'Shoppers are scrutinizing ingredient lists more closely, rewarding specificity over vague marketing language.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-201/160/160' },
      { title: 'Skinfluencer routines are driving more saves than polished campaign shots', desc: 'Multi-step routine videos are converting followers into buyers faster than single hero-product posts.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-202/160/160' },
      { title: 'Competitor spotlight: Marlowe & Sage\'s founder-led campaign', desc: 'Their latest push leans on unfiltered before/after clips instead of studio beauty shots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-203/160/160' }
    ]
  },
  'Jewelry & Accessories': {
    tickers: [
      { symbol: 'CPRI', price: 18.9, change: -1.1 },
      { symbol: 'TPR', price: 42.3, change: 0.8 },
      { symbol: 'FOSL', price: 1.24, change: -2.4 },
      { symbol: 'MOV', price: 18.1, change: 0.5 },
      { symbol: 'SIG', price: 88.7, change: 1.6 }
    ],
    news: [
      { title: 'Lab-grown diamond content is outperforming mined-stone posts on engagement', desc: 'Price-transparency angles are resonating especially with younger, first-time buyers.', source: 'TRENDWATCH', time: '4H AGO', image: 'https://picsum.photos/seed/seed-news-204/160/160' },
      { title: 'Personalization and engraving add-ons are the top-requested feature in DMs', desc: 'Shoppers increasingly expect a customization option before committing to purchase.', source: 'MARKET SCAN', time: '10H AGO', image: 'https://picsum.photos/seed/seed-news-205/160/160' },
      { title: 'Competitor spotlight: Halden & Co.\'s founder-led campaign', desc: 'Their latest push leans on customer unboxing footage over studio product shots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-206/160/160' }
    ]
  },
  'Home & Furniture': {
    tickers: [
      { symbol: 'W', price: 68.2, change: 1.4 },
      { symbol: 'RH', price: 312.5, change: -2.1 },
      { symbol: 'WSM', price: 148.9, change: 0.7 },
      { symbol: 'LOVE', price: 22.3, change: -0.9 },
      { symbol: 'ETD', price: 28.6, change: 0.3 }
    ],
    news: [
      { title: 'Room-by-room transformation reels are outperforming single-item product shots', desc: 'Full-space styling content is converting better than isolated furniture photography.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-207/160/160' },
      { title: '"Dupe" and budget-alternative content is driving strong save rates', desc: 'Shoppers are actively searching for lower-cost takes on designer pieces.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-208/160/160' },
      { title: 'Competitor spotlight: Birchwood Home\'s founder-led campaign', desc: 'Their latest push leans on real-customer room tours over catalog staging.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-209/160/160' }
    ]
  },
  'Toys & Kids Products': {
    tickers: [
      { symbol: 'HAS', price: 58.4, change: 0.6 },
      { symbol: 'MAT', price: 19.2, change: -1.3 },
      { symbol: 'JAKK', price: 24.8, change: 2.1 },
      { symbol: 'FNKO', price: 3.9, change: -0.5 },
      { symbol: 'BBW', price: 28.1, change: 1 }
    ],
    news: [
      { title: 'Unboxing and "surprise reveal" formats still dominate engagement in the category', desc: 'Suspense-driven formats consistently outperform static product photography.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-210/160/160' },
      { title: 'Parent-facing safety and durability content is gaining traction on longer-form posts', desc: 'Buyers are responding to transparency about materials and testing standards.', source: 'MARKET SCAN', time: '7H AGO', image: 'https://picsum.photos/seed/seed-news-211/160/160' },
      { title: 'Competitor spotlight: Pinewood Toys\' founder-led campaign', desc: 'Their latest push leans on real kids playing over staged product shots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-212/160/160' }
    ]
  },
  'Pet Care & Products': {
    tickers: [
      { symbol: 'CHWY', price: 28.4, change: 1.2 },
      { symbol: 'FRPT', price: 98.6, change: -0.8 },
      { symbol: 'IDXX', price: 452.1, change: 0.5 },
      { symbol: 'WOOF', price: 3.2, change: -2.3 },
      { symbol: 'ZTS', price: 178.9, change: 0.9 }
    ],
    news: [
      { title: '"A day in the life" pet content is outperforming polished product photography', desc: 'Candid, routine-based clips are getting stronger saves than studio pet portraits.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-213/160/160' },
      { title: 'Subscription-based treat and food boxes are seeing renewed engagement', desc: 'Convenience-first messaging is converting better than one-time purchase framing.', source: 'MARKET SCAN', time: '6H AGO', image: 'https://picsum.photos/seed/seed-news-214/160/160' },
      { title: 'Competitor spotlight: Fetch & Co.\'s founder-led campaign', desc: 'Their latest push leans on customer pet testimonials over studio shoots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-215/160/160' }
    ]
  },
  'Grocery & Consumer Packaged Goods': {
    tickers: [
      { symbol: 'KR', price: 56.2, change: 0.4 },
      { symbol: 'PG', price: 168.3, change: 0.2 },
      { symbol: 'KHC', price: 31.5, change: -0.6 },
      { symbol: 'CL', price: 94.1, change: 0.8 },
      { symbol: 'GIS', price: 63.4, change: -0.3 }
    ],
    news: [
      { title: 'High-protein and functional-ingredient callouts continue to drive shelf attention', desc: 'Reformulated staples are outperforming net-new launches this quarter.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-216/160/160' },
      { title: 'Recipe-integration content outperforms straight product shots on save rate', desc: 'Shoppers save posts that show the product used in a full meal, not on its own.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-217/160/160' },
      { title: 'Competitor spotlight: Harvest Row\'s founder-led campaign', desc: 'Their latest push leans on kitchen behind-the-scenes footage over packaging shots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-218/160/160' }
    ]
  },
  'Restaurants & QSR': {
    tickers: [
      { symbol: 'MCD', price: 288.1, change: 0.9 },
      { symbol: 'YUM', price: 134.2, change: -0.4 },
      { symbol: 'CMG', price: 56.3, change: 1.4 },
      { symbol: 'SBUX', price: 95.7, change: -1.1 },
      { symbol: 'DPZ', price: 412.8, change: 0.6 }
    ],
    news: [
      { title: 'Limited-time menu drops are outperforming permanent additions on social lift', desc: 'Scarcity-driven campaigns are seeing stronger engagement this quarter.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-219/160/160' },
      { title: 'Behind-the-counter prep videos are converting better than plated food shots', desc: 'Process transparency is resonating more than polished food photography.', source: 'MARKET SCAN', time: '7H AGO', image: 'https://picsum.photos/seed/seed-news-220/160/160' },
      { title: 'Competitor spotlight: Cornerstone Kitchen\'s founder-led campaign', desc: 'Their latest push leans on staff and kitchen stories over plated shots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-221/160/160' }
    ]
  },
  'Hotels & Lodging': {
    tickers: [
      { symbol: 'MAR', price: 245.6, change: 1 },
      { symbol: 'HLT', price: 218.3, change: 0.5 },
      { symbol: 'H', price: 142.7, change: -0.7 },
      { symbol: 'IHG', price: 98.4, change: 0.3 },
      { symbol: 'CHH', price: 122.9, change: -1.2 }
    ],
    news: [
      { title: 'Guest-shot room tours are outperforming polished property photography', desc: 'Authentic, unedited walkthroughs are converting better than staged amenity shots.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-222/160/160' },
      { title: '"Shoulder season" bookings are up across leisure travel', desc: 'Off-peak trip content is getting stronger engagement than peak-season posts.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-223/160/160' },
      { title: 'Competitor spotlight: Aldermoor Suites\' founder-led campaign', desc: 'Their latest push leans on staff stories over amenity walkthroughs.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-224/160/160' }
    ]
  },
  'Bars, Nightlife & Events': {
    tickers: [
      { symbol: 'TAP', price: 62.4, change: 0.6 },
      { symbol: 'STZ', price: 238.1, change: -0.9 },
      { symbol: 'FIZZ', price: 12.3, change: 1.1 },
      { symbol: 'EDR', price: 5.8, change: -2 },
      { symbol: 'BUD', price: 58.9, change: 0.4 }
    ],
    news: [
      { title: 'Live, in-venue story takeovers are outperforming scheduled promo posts', desc: 'Real-time crowd energy is converting followers into same-night walk-ins.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-225/160/160' },
      { title: 'Themed one-off nights are driving stronger RSVP rates than recurring events', desc: 'Novelty and limited-run framing is outperforming standing weekly promotions.', source: 'MARKET SCAN', time: '6H AGO', image: 'https://picsum.photos/seed/seed-news-226/160/160' },
      { title: 'Competitor spotlight: The Hollow Room\'s founder-led campaign', desc: 'Their latest push leans on DJ and crowd footage over venue photography.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-227/160/160' }
    ]
  },
  'Software & SaaS': {
    tickers: [
      { symbol: 'CRM', price: 312.4, change: 0.9 },
      { symbol: 'NOW', price: 862.3, change: 1.2 },
      { symbol: 'WDAY', price: 248.7, change: -0.5 },
      { symbol: 'ADBE', price: 521.6, change: 0.3 },
      { symbol: 'TEAM', price: 198.4, change: -1.4 }
    ],
    news: [
      { title: 'Product-led demo clips are outperforming feature-list carousels', desc: 'Short screen-recorded walkthroughs are converting better than static feature graphics.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-228/160/160' },
      { title: 'Enterprise buyers now expect an AI roadmap in every pitch', desc: 'Sales teams report longer cycles when a product lacks a clear AI story.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-229/160/160' },
      { title: 'Competitor spotlight: Fieldstone Software\'s founder-led campaign', desc: 'Their latest push leans on customer-story testimonials over feature announcements.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-230/160/160' }
    ]
  },
  'Consumer Electronics': {
    tickers: [
      { symbol: 'AAPL', price: 227.5, change: 0.6 },
      { symbol: 'SONY', price: 89.2, change: -0.3 },
      { symbol: 'SONO', price: 13.8, change: 1.5 },
      { symbol: 'GPRO', price: 1.1, change: -2.8 },
      { symbol: 'DELL', price: 112.4, change: 0.7 }
    ],
    news: [
      { title: 'On-device AI features are driving a fresh upgrade cycle', desc: 'Manufacturers are leaning on privacy-first messaging to justify premium pricing.', source: 'TECH WIRE', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-231/160/160' },
      { title: 'Teardown and repairability content is outperforming spec-sheet posts', desc: 'Audiences are rewarding transparency about build quality over marketing specs.', source: 'MARKET SCAN', time: '7H AGO', image: 'https://picsum.photos/seed/seed-news-232/160/160' },
      { title: 'Short-form product demos still outperform static posts 3:1', desc: 'Engagement data continues to favor 15-30 second clips over single images.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-233/160/160' }
    ]
  },
  'Telecommunications': {
    tickers: [
      { symbol: 'T', price: 21.8, change: 0.3 },
      { symbol: 'VZ', price: 43.2, change: -0.5 },
      { symbol: 'TMUS', price: 198.6, change: 1.1 },
      { symbol: 'CMCSA', price: 41.3, change: 0.2 },
      { symbol: 'CHTR', price: 362.4, change: -1 }
    ],
    news: [
      { title: 'Plain-language plan comparisons are outperforming discount-only promos', desc: 'Trust-building explainer content is getting more saves than price callouts.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-234/160/160' },
      { title: 'Network-coverage proof posts are converting better than speed-test claims', desc: 'Real-world coverage maps and customer clips are resonating over lab benchmarks.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-235/160/160' },
      { title: 'Competitor spotlight: Northline Mobile\'s founder-led campaign', desc: 'Their latest push leans on customer switch-over stories over rate tables.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-236/160/160' }
    ]
  },
  'Gaming & Esports': {
    tickers: [
      { symbol: 'EA', price: 148.2, change: 0.5 },
      { symbol: 'TTWO', price: 178.9, change: -0.8 },
      { symbol: 'RBLX', price: 52.3, change: 2.4 },
      { symbol: 'NTES', price: 98.7, change: -0.3 },
      { symbol: 'MSFT', price: 441.2, change: 1.1 }
    ],
    news: [
      { title: 'Live co-op streams are outperforming scheduled trailer drops', desc: 'Real-time audience reaction is converting into wishlist adds faster than cinematics.', source: 'TRENDWATCH', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-237/160/160' },
      { title: 'Short clip highlight reels are driving most new-player discovery', desc: 'Compilation-style uploads are outperforming full-match VODs for reach.', source: 'MARKET SCAN', time: '5H AGO', image: 'https://picsum.photos/seed/seed-news-238/160/160' },
      { title: 'Competitor spotlight: Ironvale Games\' founder-led campaign', desc: 'Their latest push leans on dev-diary content over polished cinematic trailers.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-239/160/160' }
    ]
  },
  'Artificial Intelligence & Data': {
    tickers: [
      { symbol: 'NVDA', price: 118.3, change: -2.3 },
      { symbol: 'MSFT', price: 441.2, change: 1.1 },
      { symbol: 'PLTR', price: 38.6, change: 3.2 },
      { symbol: 'AI', price: 24.1, change: -1.7 },
      { symbol: 'GOOGL', price: 178.9, change: 0.3 }
    ],
    news: [
      { title: 'Plain-language "how it actually works" explainers are outperforming hype posts', desc: 'Audiences are rewarding demystified, concrete examples over abstract claims.', source: 'TECH WIRE', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-240/160/160' },
      { title: 'Enterprise buyers now expect a clear data-governance story alongside AI features', desc: 'Sales teams report friction when a product lacks a compliance narrative.', source: 'MARKET SCAN', time: '6H AGO', image: 'https://picsum.photos/seed/seed-news-241/160/160' },
      { title: 'Benchmark transparency posts are getting more engagement than raw capability claims', desc: 'Sharing methodology alongside results is building more trust than headline numbers alone.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-242/160/160' }
    ]
  },
  'Cybersecurity': {
    tickers: [
      { symbol: 'CRWD', price: 298.4, change: 1.6 },
      { symbol: 'PANW', price: 368.2, change: -0.9 },
      { symbol: 'FTNT', price: 88.6, change: 0.4 },
      { symbol: 'ZS', price: 198.3, change: 2.1 },
      { symbol: 'OKTA', price: 92.7, change: -1.2 }
    ],
    news: [
      { title: 'Plain-language breach post-mortems are outperforming feature-list content', desc: 'Audiences trust vendors more when they explain incidents clearly instead of only marketing prevention.', source: 'TECH WIRE', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-243/160/160' },
      { title: 'Zero-trust explainer content is converting better than checklist-style posts', desc: 'Concrete architecture walkthroughs are resonating over generic best-practice lists.', source: 'MARKET SCAN', time: '7H AGO', image: 'https://picsum.photos/seed/seed-news-244/160/160' },
      { title: 'Competitor spotlight: Redline Security\'s founder-led campaign', desc: 'Their latest push leans on customer incident-response stories over product screenshots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-245/160/160' }
    ]
  },
  'Fitness & Sports': {
    tickers: [
      { symbol: 'NKE', price: 92.1, change: 1.2 },
      { symbol: 'LULU', price: 342.1, change: -0.8 },
      { symbol: 'PTON', price: 6.8, change: 2.9 },
      { symbol: 'PLNT', price: 82.4, change: -0.5 },
      { symbol: 'DKS', price: 218.6, change: 0.7 }
    ],
    news: [
      { title: 'Wearable-driven progress content is outperforming studio shoots', desc: 'Real data snapshots resonate more than polished before/after photography.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-246/160/160' },
      { title: '"Recovery" content is overtaking "performance" as the top-engaging angle', desc: 'Audiences are responding to rest and mobility framing over intensity-only messaging.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-247/160/160' },
      { title: 'Competitor spotlight: Ironclad Athletics\' founder-led campaign', desc: 'Their latest push leans on real member transformations over studio photography.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-248/160/160' }
    ]
  },
  'Pharmaceuticals & Biotech': {
    tickers: [
      { symbol: 'PFE', price: 28.6, change: -0.7 },
      { symbol: 'MRK', price: 102.4, change: 0.4 },
      { symbol: 'LLY', price: 892.3, change: 1.8 },
      { symbol: 'ABBV', price: 178.9, change: 0.6 },
      { symbol: 'GILD', price: 82.1, change: -0.3 }
    ],
    news: [
      { title: 'Plain-language mechanism-of-action explainers are outperforming brand-only posts', desc: 'Audiences engage more with clear, accessible science than tagline-driven creative.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-249/160/160' },
      { title: 'Patient-story content is converting better than clinical data callouts on social', desc: 'Personal outcome narratives are resonating more than trial statistics alone.', source: 'MARKET SCAN', time: '10H AGO', image: 'https://picsum.photos/seed/seed-news-250/160/160' },
      { title: 'Compliance-reviewed educational series are seeing steady engagement growth', desc: 'Long-form explainer formats continue to outperform single-image claims in this category.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-251/160/160' }
    ]
  },
  'Medical & Healthcare Providers': {
    tickers: [
      { symbol: 'UNH', price: 512.8, change: 1.6 },
      { symbol: 'HCA', price: 368.2, change: -0.4 },
      { symbol: 'CVS', price: 62.3, change: 0.5 },
      { symbol: 'CI', price: 312.6, change: -0.8 },
      { symbol: 'THC', price: 118.9, change: 1.1 }
    ],
    news: [
      { title: 'Plain-language procedure explainers are outperforming facility photography', desc: 'Patients engage more with clear expectations content than glossy building shots.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-252/160/160' },
      { title: 'Provider-introduction videos are converting better than generic service listings', desc: 'A face and a voice ahead of a visit is resonating more than a service page alone.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-253/160/160' },
      { title: 'Wait-time transparency posts are getting more saves than promotional content', desc: 'Practical, actionable information is outperforming brand messaging in this category.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-254/160/160' }
    ]
  },
  'Mental Health & Therapy': {
    tickers: [
      { symbol: 'TDOC', price: 9.2, change: -1.5 },
      { symbol: 'LFMD', price: 6.8, change: 2.3 },
      { symbol: 'UNH', price: 512.8, change: 1.6 },
      { symbol: 'CVS', price: 62.3, change: 0.5 },
      { symbol: 'PRVA', price: 22.4, change: 0.9 }
    ],
    news: [
      { title: 'Destigmatizing, plain-language content is outperforming clinical-only messaging', desc: 'Audiences respond more to accessible framing than technical or formal tone.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-255/160/160' },
      { title: 'Short "what to expect in a first session" clips are converting well', desc: 'Reducing uncertainty ahead of a first appointment is resonating strongly.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-256/160/160' },
      { title: 'Provider-credential transparency posts are building more trust than testimonials alone', desc: 'Clear licensing and background information is outperforming vague trust badges.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-257/160/160' }
    ]
  },
  'Banking': {
    tickers: [
      { symbol: 'JPM', price: 210.4, change: 0.8 },
      { symbol: 'BAC', price: 39.7, change: 0.5 },
      { symbol: 'WFC', price: 68.2, change: -0.3 },
      { symbol: 'C', price: 71.4, change: 0.6 },
      { symbol: 'USB', price: 48.9, change: -0.7 }
    ],
    news: [
      { title: 'Plain-language fee explainers are outperforming rate promos', desc: 'Trust-building content is getting more saves and shares than APR callouts.', source: 'MARKET SCAN', time: '4H AGO', image: 'https://picsum.photos/seed/seed-news-258/160/160' },
      { title: 'Short educational reels drive the most new-account signups', desc: '"How it works" content is converting better than product-feature posts.', source: 'TRENDWATCH', time: '10H AGO', image: 'https://picsum.photos/seed/seed-news-259/160/160' },
      { title: 'Competitor spotlight: Aldergate Bank\'s founder-led campaign', desc: 'Their latest push leans on customer-story testimonials over rate tables.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-260/160/160' }
    ]
  },
  'Insurance': {
    tickers: [
      { symbol: 'PGR', price: 238.6, change: 0.9 },
      { symbol: 'ALL', price: 198.4, change: -0.5 },
      { symbol: 'TRV', price: 248.1, change: 0.6 },
      { symbol: 'MET', price: 78.9, change: -0.3 },
      { symbol: 'AIG', price: 78.2, change: 0.4 }
    ],
    news: [
      { title: 'Plain-language claims-process explainers are outperforming discount promos', desc: 'Clarity on what happens after a claim is resonating more than price-only messaging.', source: 'MARKET SCAN', time: '5H AGO', image: 'https://picsum.photos/seed/seed-news-261/160/160' },
      { title: 'Real customer claim-story content is converting better than rate comparisons', desc: 'Concrete outcomes are building more trust than abstract coverage lists.', source: 'TRENDWATCH', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-262/160/160' },
      { title: 'Competitor spotlight: Northbridge Mutual\'s founder-led campaign', desc: 'Their latest push leans on customer testimonials over premium comparisons.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-263/160/160' }
    ]
  },
  'Real Estate': {
    tickers: [
      { symbol: 'Z', price: 58.2, change: 1.3 },
      { symbol: 'RDFN', price: 9.8, change: -1.9 },
      { symbol: 'CBRE', price: 118.4, change: 0.6 },
      { symbol: 'O', price: 56.3, change: -0.2 },
      { symbol: 'AMT', price: 198.7, change: 0.8 }
    ],
    news: [
      { title: 'Unedited walkthrough videos are outperforming staged listing photography', desc: 'Buyers are responding to authenticity over polished, staged shots this quarter.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-264/160/160' },
      { title: 'Neighborhood-life content is converting better than listing-only posts', desc: 'Context about the surrounding area is driving more saves than property specs alone.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-265/160/160' },
      { title: 'Competitor spotlight: Harrow & Vale Realty\'s founder-led campaign', desc: 'Their latest push leans on agent-led neighborhood tours over listing photos.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-266/160/160' }
    ]
  },
  'Legal Services': {
    tickers: [
      { symbol: 'TRI', price: 168.2, change: 0.4 },
      { symbol: 'RELX', price: 48.9, change: 0.6 },
      { symbol: 'DOCU', price: 68.3, change: -1.1 },
      { symbol: 'WK', price: 98.7, change: 0.3 },
      { symbol: 'LZ', price: 9.8, change: -0.5 }
    ],
    news: [
      { title: 'Plain-language "know your rights" explainers are outperforming firm-branding posts', desc: 'Practical, accessible legal information is resonating more than credential-only content.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-267/160/160' },
      { title: 'Short case-outcome summaries are converting better than generic practice-area posts', desc: 'Specific, anonymized results are building more trust than broad service descriptions.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-268/160/160' },
      { title: 'Competitor spotlight: Ashcombe & Reid\'s founder-led campaign', desc: 'Their latest push leans on client-story testimonials over attorney headshots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-269/160/160' }
    ]
  },
  'Accounting & Tax Services': {
    tickers: [
      { symbol: 'INTU', price: 628.4, change: 0.7 },
      { symbol: 'HRB', price: 52.3, change: -0.4 },
      { symbol: 'WK', price: 98.7, change: 0.3 },
      { symbol: 'ADP', price: 248.6, change: 0.5 },
      { symbol: 'PAYX', price: 128.9, change: -0.2 }
    ],
    news: [
      { title: 'Plain-language deadline reminders are outperforming generic service promos', desc: 'Timely, practical content is getting more saves than brand-awareness posts.', source: 'TRENDWATCH', time: '4H AGO', image: 'https://picsum.photos/seed/seed-news-270/160/160' },
      { title: 'Short "common mistakes" explainer clips are converting well this season', desc: 'Specific, actionable tips are resonating more than broad service overviews.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-271/160/160' },
      { title: 'Competitor spotlight: Hollowell & Finch\'s founder-led campaign', desc: 'Their latest push leans on client testimonials over service-listing graphics.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-272/160/160' }
    ]
  },
  'Consulting & Professional Services': {
    tickers: [
      { symbol: 'ACN', price: 368.2, change: 0.6 },
      { symbol: 'IT', price: 498.7, change: -0.3 },
      { symbol: 'CTSH', price: 78.4, change: 0.4 },
      { symbol: 'BAH', price: 148.9, change: -0.8 },
      { symbol: 'EXLS', price: 38.2, change: 1.1 }
    ],
    news: [
      { title: 'Short case-study breakdowns are outperforming generic capability decks', desc: 'Concrete before/after outcomes are converting better than broad service lists.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-273/160/160' },
      { title: 'Founder and partner-led thought leadership is outperforming brand-only posts', desc: 'Named, credentialed voices are resonating more than anonymous company content.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-274/160/160' },
      { title: 'Competitor spotlight: Marrow Bridge Consulting\'s founder-led campaign', desc: 'Their latest push leans on partner-led commentary over polished case studies.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-275/160/160' }
    ]
  },
  'Human Resources & Recruiting': {
    tickers: [
      { symbol: 'ADP', price: 248.6, change: 0.5 },
      { symbol: 'PAYX', price: 128.9, change: -0.2 },
      { symbol: 'RHI', price: 48.3, change: -1 },
      { symbol: 'MAN', price: 52.7, change: 0.6 },
      { symbol: 'UPWK', price: 12.4, change: 1.8 }
    ],
    news: [
      { title: 'Employee-perspective content is outperforming employer-branding-only posts', desc: 'Real team member takes are converting better than curated culture photography.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-276/160/160' },
      { title: 'Salary-transparency posts are driving stronger candidate engagement', desc: 'Direct compensation information is resonating more than generic "great culture" messaging.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-277/160/160' },
      { title: 'Competitor spotlight: Fieldstone Talent\'s founder-led campaign', desc: 'Their latest push leans on candidate success stories over generic job-post graphics.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-278/160/160' }
    ]
  },
  'Marketing & Advertising Agencies': {
    tickers: [
      { symbol: 'OMC', price: 98.4, change: 0.5 },
      { symbol: 'IPG', price: 28.6, change: -0.7 },
      { symbol: 'WPP', price: 48.2, change: -0.3 },
      { symbol: 'TTD', price: 68.9, change: 1.4 },
      { symbol: 'CRTO', price: 32.1, change: -1.1 }
    ],
    news: [
      { title: 'Behind-the-strategy breakdowns are outperforming polished campaign reveals', desc: 'Audiences are engaging more with process and rationale than finished creative alone.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-279/160/160' },
      { title: 'Results-first case studies are converting better than portfolio showcases', desc: 'Leading with measurable outcomes is resonating more than visual portfolio pieces.', source: 'MARKET SCAN', time: '7H AGO', image: 'https://picsum.photos/seed/seed-news-280/160/160' },
      { title: 'Competitor spotlight: Fernbrook Creative\'s founder-led campaign', desc: 'Their latest push leans on client-result breakdowns over polished reel highlights.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-281/160/160' }
    ]
  },
  'Music & Audio': {
    tickers: [
      { symbol: 'SPOT', price: 412.8, change: 2.3 },
      { symbol: 'WMG', price: 32.6, change: -0.5 },
      { symbol: 'SIRI', price: 3.8, change: 0.4 },
      { symbol: 'LYV', price: 118.9, change: 1.1 },
      { symbol: 'TME', price: 12.3, change: -0.8 }
    ],
    news: [
      { title: 'Behind-the-scenes studio clips are outperforming polished music-video teasers', desc: 'Audiences are engaging more with process content than finished promo material.', source: 'TRENDWATCH', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-282/160/160' },
      { title: 'Short-form recaps drive most of this week’s discovery traffic', desc: 'Clip compilations are outperforming full-length uploads for new-listener reach.', source: 'RETAIL PULSE', time: '5H AGO', image: 'https://picsum.photos/seed/seed-news-283/160/160' },
      { title: 'Competitor spotlight: Lowlight Records\' founder-led campaign', desc: 'Their latest push leans on artist interviews over polished single-art reveals.', source: 'MARKET SCAN', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-284/160/160' }
    ]
  },
  'Publishing & News': {
    tickers: [
      { symbol: 'NYT', price: 54.2, change: 0.6 },
      { symbol: 'NWSA', price: 28.9, change: -0.4 },
      { symbol: 'GCI', price: 3.1, change: -1.7 },
      { symbol: 'PSO', price: 13.8, change: 0.5 },
      { symbol: 'SCHL', price: 28.4, change: 0.8 }
    ],
    news: [
      { title: 'Reporter-led explainer clips are outperforming headline-only social posts', desc: 'A named voice walking through a story is converting better than link-only shares.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-285/160/160' },
      { title: 'Subscriber-only behind-the-story content is driving stronger retention', desc: 'Exclusive process content is resonating more than public-facing recaps.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-286/160/160' },
      { title: 'Competitor spotlight: The Ridgeline Post\'s founder-led campaign', desc: 'Their latest push leans on reporter Q&As over polished headline graphics.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-287/160/160' }
    ]
  },
  'Film & TV Production': {
    tickers: [
      { symbol: 'DIS', price: 98.2, change: -0.9 },
      { symbol: 'NFLX', price: 680.5, change: 1.4 },
      { symbol: 'WBD', price: 11.6, change: -2.1 },
      { symbol: 'PARA', price: 12.8, change: 0.3 },
      { symbol: 'LGF.A', price: 9.4, change: -0.6 }
    ],
    news: [
      { title: 'Behind-the-scenes clips are outperforming trailers on save rate', desc: 'Audiences are engaging more with process content than polished promos.', source: 'TRENDWATCH', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-288/160/160' },
      { title: 'Short-form recaps drive most of this week’s discovery traffic', desc: 'Clip compilations are outperforming full-length uploads for new viewers.', source: 'RETAIL PULSE', time: '5H AGO', image: 'https://picsum.photos/seed/seed-news-289/160/160' },
      { title: 'Competitor spotlight: Northlight Studios\' founder-led campaign', desc: 'Their latest push leans on cast interviews over key-art reveals.', source: 'MARKET SCAN', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-290/160/160' }
    ]
  },
  'Photography & Creative Services': {
    tickers: [
      { symbol: 'ADBE', price: 521.6, change: 0.3 },
      { symbol: 'SHUT', price: 32.4, change: -1.2 },
      { symbol: 'GETY', price: 3.2, change: 0.6 },
      { symbol: 'KODK', price: 4.8, change: -0.4 },
      { symbol: 'FUJIY', price: 48.9, change: 0.5 }
    ],
    news: [
      { title: 'Raw, unedited process clips are outperforming polished final-image reveals', desc: 'Audiences are engaging more with the "how" than the finished frame alone.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-291/160/160' },
      { title: 'Client-session behind-the-scenes content is converting better than portfolio-only posts', desc: 'Showing the shoot itself is resonating more than curated gallery uploads.', source: 'MARKET SCAN', time: '7H AGO', image: 'https://picsum.photos/seed/seed-news-292/160/160' },
      { title: 'Competitor spotlight: Grayline Studio\'s founder-led campaign', desc: 'Their latest push leans on client testimonials over polished portfolio pieces.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-293/160/160' }
    ]
  },
  'Influencer & Creator Economy': {
    tickers: [
      { symbol: 'META', price: 598.2, change: 0.8 },
      { symbol: 'GOOGL', price: 178.9, change: 0.3 },
      { symbol: 'FVRR', price: 24.6, change: -1.5 },
      { symbol: 'IZEA', price: 1.1, change: 2.2 },
      { symbol: 'BZFD', price: 1.8, change: -0.9 }
    ],
    news: [
      { title: 'Unscripted, day-in-the-life content is outperforming produced brand deals', desc: 'Audiences are rewarding authenticity over polished sponsored segments.', source: 'TRENDWATCH', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-294/160/160' },
      { title: 'Rate-transparency posts among creators are driving stronger community engagement', desc: 'Openness about brand-deal pricing is resonating more than vague "collab" posts.', source: 'MARKET SCAN', time: '6H AGO', image: 'https://picsum.photos/seed/seed-news-295/160/160' },
      { title: 'Competitor spotlight: Nova Creator Collective\'s founder-led campaign', desc: 'Their latest push leans on creator testimonials over polished platform ads.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-296/160/160' }
    ]
  },
  'Manufacturing & Industrial': {
    tickers: [
      { symbol: 'GE', price: 178.4, change: 0.6 },
      { symbol: 'HON', price: 218.9, change: -0.3 },
      { symbol: 'MMM', price: 128.6, change: 0.4 },
      { symbol: 'CAT', price: 368.2, change: 1.1 },
      { symbol: 'ITW', price: 248.7, change: -0.5 }
    ],
    news: [
      { title: 'Shop-floor process videos are outperforming polished product-catalog shots', desc: 'Audiences are engaging more with real production footage than staged imagery.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-297/160/160' },
      { title: 'Safety-culture content is converting better than pure capability showcases', desc: 'Transparency about standards is building more trust than output-only messaging.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-298/160/160' },
      { title: 'Competitor spotlight: Ironbridge Manufacturing\'s founder-led campaign', desc: 'Their latest push leans on floor-team stories over polished machinery shots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-299/160/160' }
    ]
  },
  'Automotive': {
    tickers: [
      { symbol: 'TSLA', price: 248.6, change: 2.1 },
      { symbol: 'F', price: 11.2, change: -0.8 },
      { symbol: 'GM', price: 48.9, change: 0.5 },
      { symbol: 'TM', price: 198.4, change: 0.3 },
      { symbol: 'STLA', price: 12.6, change: -1.4 }
    ],
    news: [
      { title: 'Real-owner review clips are outperforming manufacturer-produced showcases', desc: 'Unfiltered driving footage is converting better than studio-lit reveals.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-300/160/160' },
      { title: 'Total cost-of-ownership breakdowns are driving stronger engagement than spec sheets', desc: 'Practical, numbers-based content is resonating more than performance-only messaging.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-301/160/160' },
      { title: 'Competitor spotlight: Alden Motors\' founder-led campaign', desc: 'Their latest push leans on customer road-trip stories over studio photography.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-302/160/160' }
    ]
  },
  'Energy & Utilities': {
    tickers: [
      { symbol: 'XOM', price: 118.4, change: 0.4 },
      { symbol: 'CVX', price: 158.2, change: -0.3 },
      { symbol: 'NEE', price: 78.6, change: 0.6 },
      { symbol: 'DUK', price: 118.9, change: -0.2 },
      { symbol: 'SO', price: 88.4, change: 0.3 }
    ],
    news: [
      { title: 'Plain-language rate and billing explainers are outperforming brand-only posts', desc: 'Clarity on costs is resonating more than general sustainability messaging.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-303/160/160' },
      { title: 'Behind-the-grid infrastructure content is converting better than logo-led posts', desc: 'Audiences are engaging with how the system actually works over abstract branding.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-304/160/160' },
      { title: 'Outage-communication transparency is building more trust than proactive-only messaging', desc: 'Clear, timely updates during disruptions are outperforming reassurance-only posts.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-305/160/160' }
    ]
  },
  'Construction & Architecture': {
    tickers: [
      { symbol: 'VMC', price: 248.6, change: 0.5 },
      { symbol: 'MLM', price: 548.2, change: -0.4 },
      { symbol: 'MAS', price: 68.9, change: 0.6 },
      { symbol: 'BLDR', price: 148.3, change: -1.2 },
      { symbol: 'PWR', price: 298.7, change: 1 }
    ],
    news: [
      { title: 'Time-lapse build progress content is outperforming static rendering posts', desc: 'Audiences are engaging more with real progression than polished final renders.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-306/160/160' },
      { title: 'Before/after site transformations are converting better than portfolio-only posts', desc: 'Showing the full process is resonating more than finished-project photography alone.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-307/160/160' },
      { title: 'Competitor spotlight: Thornecrest Builders\' founder-led campaign', desc: 'Their latest push leans on crew-led site walkthroughs over rendered visuals.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-308/160/160' }
    ]
  },
  'Logistics & Supply Chain': {
    tickers: [
      { symbol: 'UPS', price: 132.4, change: 0.3 },
      { symbol: 'FDX', price: 268.9, change: -0.6 },
      { symbol: 'XPO', price: 98.4, change: 1.2 },
      { symbol: 'JBHT', price: 168.2, change: -0.3 },
      { symbol: 'CHRW', price: 88.7, change: 0.5 }
    ],
    news: [
      { title: 'Behind-the-warehouse process content is outperforming brand-only posts', desc: 'Audiences are engaging with real fulfillment footage over logo-led messaging.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-309/160/160' },
      { title: 'Delivery-transparency tracking content is converting better than promise-only messaging', desc: 'Concrete, real-time visibility is resonating more than generic reliability claims.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-310/160/160' },
      { title: 'Competitor spotlight: Meridian Freight\'s founder-led campaign', desc: 'Their latest push leans on driver and warehouse-team stories over fleet photography.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-311/160/160' }
    ]
  },
  'Agriculture & Farming': {
    tickers: [
      { symbol: 'DE', price: 398.2, change: 0.6 },
      { symbol: 'ADM', price: 58.9, change: -0.4 },
      { symbol: 'BG', price: 78.3, change: 0.5 },
      { symbol: 'CTVA', price: 58.6, change: -0.2 },
      { symbol: 'MOS', price: 28.4, change: 0.3 }
    ],
    news: [
      { title: 'Field-to-market process content is outperforming packaged-product-only posts', desc: 'Audiences are engaging with real growing-season footage over finished-goods photography.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-312/160/160' },
      { title: 'Sustainability-practice explainers are converting better than certification-badge-only posts', desc: 'Concrete practice descriptions are resonating more than logo-based trust signals.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-313/160/160' },
      { title: 'Competitor spotlight: Ashgrove Farms\' founder-led campaign', desc: 'Their latest push leans on real harvest footage over polished packaging shots.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-314/160/160' }
    ]
  },
  'Education & E-Learning': {
    tickers: [
      { symbol: 'CHGG', price: 1.1, change: -2.5 },
      { symbol: 'COUR', price: 9.8, change: 1.3 },
      { symbol: 'TWOU', price: 0.8, change: -3.1 },
      { symbol: 'DUOL', price: 298.6, change: 2 },
      { symbol: 'LRN', price: 118.4, change: 0.5 }
    ],
    news: [
      { title: 'Short "what you’ll actually learn" preview clips are outperforming enrollment-only ads', desc: 'Concrete curriculum previews are converting better than generic promotional messaging.', source: 'TRENDWATCH', time: '2H AGO', image: 'https://picsum.photos/seed/seed-news-315/160/160' },
      { title: 'Student-outcome stories are driving stronger engagement than course-feature lists', desc: 'Real learner results are resonating more than syllabus-style content.', source: 'MARKET SCAN', time: '8H AGO', image: 'https://picsum.photos/seed/seed-news-316/160/160' },
      { title: 'Competitor spotlight: Brightpath Learning\'s founder-led campaign', desc: 'Their latest push leans on student testimonials over course-catalog graphics.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-317/160/160' }
    ]
  },
  'Government & Public Sector': {
    tickers: [
      { symbol: 'LDOS', price: 168.2, change: 0.4 },
      { symbol: 'BAH', price: 148.9, change: -0.8 },
      { symbol: 'SAIC', price: 118.6, change: 0.3 },
      { symbol: 'CACI', price: 498.7, change: -0.5 },
      { symbol: 'PLTR', price: 38.6, change: 3.2 }
    ],
    news: [
      { title: 'Plain-language service explainers are outperforming procedural-only announcements', desc: 'Clear, accessible guidance is resonating more than formal notice-style posts.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-318/160/160' },
      { title: 'Behind-the-program transparency content is converting better than outcome-only messaging', desc: 'Audiences engage more when process and progress are shown, not just results.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-319/160/160' },
      { title: 'Response-time and service-status updates are building more trust than general announcements', desc: 'Timely, specific information is outperforming broad reassurance messaging.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-320/160/160' }
    ]
  },
  'Non-Profit & Social Impact': {
    tickers: [
      { symbol: 'ESGU', price: 82.4, change: 0.3 },
      { symbol: 'ICLN', price: 12.6, change: -0.8 },
      { symbol: 'SUSA', price: 118.9, change: 0.4 },
      { symbol: 'DSI', price: 68.2, change: -0.3 },
      { symbol: 'KRMA', price: 48.7, change: 0.6 }
    ],
    news: [
      { title: 'Direct-impact storytelling is outperforming general awareness posts', desc: 'Specific, traceable outcomes are converting better than broad mission statements.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-321/160/160' },
      { title: 'Transparency on fund allocation is driving stronger donor engagement', desc: 'Clear "where the money goes" content is resonating more than emotional appeals alone.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-322/160/160' },
      { title: 'Competitor spotlight: Willowmere Foundation\'s founder-led campaign', desc: 'Their latest push leans on beneficiary stories over polished gala photography.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-323/160/160' }
    ]
  },
  'Religious & Community Organizations': {
    tickers: [
      { symbol: 'PYPL', price: 68.9, change: -0.4 },
      { symbol: 'GPN', price: 98.2, change: 0.3 },
      { symbol: 'FIS', price: 78.6, change: -0.6 },
      { symbol: 'MA', price: 478.2, change: 0.5 },
      { symbol: 'V', price: 281.6, change: 1 }
    ],
    news: [
      { title: 'Short, personal reflection clips are outperforming event-announcement-only posts', desc: 'Audiences engage more with individual voices than logistics-focused messaging.', source: 'TRENDWATCH', time: '3H AGO', image: 'https://picsum.photos/seed/seed-news-324/160/160' },
      { title: 'Behind-the-community service content is converting better than promotional-only posts', desc: 'Showing real gatherings and service work resonates more than flyer-style graphics.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/seed-news-325/160/160' },
      { title: 'Competitor spotlight: Fellowship Hall\'s community outreach campaign', desc: 'Their latest push leans on member testimonials over event-poster graphics.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-326/160/160' }
    ]
  },
  'Event Management': {
    tickers: [
      { symbol: 'LYV', price: 118.9, change: 1.1 },
      { symbol: 'EDR', price: 5.8, change: -2 },
      { symbol: 'TKO', price: 118.4, change: 0.7 },
      { symbol: 'CHDN', price: 132.6, change: -0.5 },
      { symbol: 'VICI', price: 28.9, change: 0.3 }
    ],
    news: [
      { title: 'Live, real-time event coverage is outperforming pre-event promo-only posts', desc: 'In-the-moment footage is converting better than scheduled announcement graphics.', source: 'TRENDWATCH', time: '1H AGO', image: 'https://picsum.photos/seed/seed-news-327/160/160' },
      { title: 'Behind-the-planning content is driving stronger engagement than polished final-event photos', desc: 'Audiences are responding to setup and process content, not just the finished event.', source: 'MARKET SCAN', time: '6H AGO', image: 'https://picsum.photos/seed/seed-news-328/160/160' },
      { title: 'Competitor spotlight: Fairhaven Events\' founder-led campaign', desc: 'Their latest push leans on client testimonials over polished venue photography.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/seed-news-329/160/160' }
    ]
  }
};

/**
 * Runs once at boot. If the IndustrySegment collection is empty, populate it
 * from the static group/segment list (+ curated ticker/news data for the
 * original 8 industries). Safe to call every boot - it's a no-op once seeded.
 */
export async function seedIndustrySegmentsIfEmpty() {
  const count = await IndustrySegment.estimatedDocumentCount();
  if (count > 0) return;

  const docs = [];
  ALL_INDUSTRY_GROUPS.forEach((g, groupIdx) => {
    g.items.forEach((name, itemIdx) => {
      const seed = SEED_TICKERS_AND_NEWS[name];
      docs.push({
        name,
        group: g.group,
        order: groupIdx * 100 + itemIdx,
        active: true,
        tickers: seed?.tickers || [],
        news: seed?.news || []
      });
    });
  });

  await IndustrySegment.insertMany(docs, { ordered: false }).catch((err) => {
    console.warn('[industrySegments] seed insertMany had partial failures (likely benign dupes):', err.message);
  });

  console.log(`[industrySegments] seeded ${docs.length} industry segments across ${ALL_INDUSTRY_GROUPS.length} groups`);
}

/**
 * Safe to run on every boot, on top of an already-seeded database.
 *
 * Originally SEED_TICKERS_AND_NEWS only had curated data for 8 of the ~50+
 * industries, so any segment created for one of the others (including ones
 * seeded before this curated data existed) was left with empty tickers/news
 * arrays and silently fell back to the generic sample data in
 * industryData.js - meaning most industries looked identical to each other
 * and to whatever the previous industry was, since nothing about the
 * industry choice actually changed what was shown.
 *
 * This fills in curated data for any segment that's still empty (never
 * overwrites a segment that already has tickers/news, whether that came from
 * this seed data or from an admin editing it directly), so switching
 * industries produces genuinely different content instead of the same
 * fallback for dozens of industries.
 */
export async function backfillMissingCuratedData() {
  const names = Object.keys(SEED_TICKERS_AND_NEWS);
  const candidates = await IndustrySegment.find({ name: { $in: names } });

  let updated = 0;
  for (const segment of candidates) {
    const seed = SEED_TICKERS_AND_NEWS[segment.name];
    if (!seed) continue;
    const needsTickers = !segment.tickers?.length;
    const needsNews = !segment.news?.length;
    if (!needsTickers && !needsNews) continue;

    if (needsTickers) segment.tickers = seed.tickers;
    if (needsNews) segment.news = seed.news;
    await segment.save();
    updated += 1;
  }

  if (updated > 0) {
    console.log(`[industrySegments] backfilled curated tickers/news for ${updated} previously-empty segment(s)`);
  }
}

/**
 * Safe to run on every boot. Inserts any segment from ADDITIONAL_INDUSTRY_GROUPS that
 * isn't in the database yet. Insert-only: existing segments (active or hidden, edited
 * or not) are never changed, so customers, news and tickers are untouched.
 */
export async function ensureAdditionalSegments() {
  const existing = new Set((await IndustrySegment.find({}, 'name').lean()).map((s) => s.name));
  const docs = [];
  ADDITIONAL_INDUSTRY_GROUPS.forEach((g, groupIdx) => {
    g.items.forEach((name, itemIdx) => {
      if (existing.has(name)) return;
      existing.add(name);
      docs.push({ name, group: g.group, order: 1000 + groupIdx * 100 + itemIdx, active: true, tickers: [], news: [] });
    });
  });
  if (!docs.length) return;
  await IndustrySegment.insertMany(docs, { ordered: false }).catch((err) => {
    console.warn('[industrySegments] adding new segments had partial failures (likely benign dupes):', err.message);
  });
  console.log(`[industrySegments] added ${docs.length} new industry segment(s)`);
}

export async function getGroupedActiveSegments() {
  const segments = await IndustrySegment.find({ active: true }).sort({ order: 1, name: 1 }).lean();
  const byGroup = new Map();
  for (const s of segments) {
    if (!byGroup.has(s.group)) byGroup.set(s.group, []);
    byGroup.get(s.group).push(s.name);
  }
  return [...byGroup.entries()].map(([group, items]) => ({ group, items }));
}

export async function getFlatActiveSegmentNames() {
  const segments = await IndustrySegment.find({ active: true }, 'name').lean();
  return segments.map((s) => s.name);
}

export async function isValidActiveSegment(name) {
  if (!name) return false;
  const found = await IndustrySegment.findOne({ name, active: true }, '_id').lean();
  return Boolean(found);
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------
export async function listAllSegments() {
  return IndustrySegment.find().sort({ order: 1, group: 1, name: 1 });
}

export async function createSegment({ name, group, order, tickers, news }) {
  return IndustrySegment.create({
    name,
    group: group || 'Other',
    order: order ?? 0,
    tickers: tickers || [],
    news: news || []
  });
}

export async function updateSegment(id, updates) {
  const allowed = ['name', 'group', 'order', 'active', 'tickers', 'news'];
  const set = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) set[key] = updates[key];
  }
  return IndustrySegment.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true });
}

export async function deleteSegment(id) {
  return IndustrySegment.findByIdAndDelete(id);
}

/**
 * Prepends a freshly-fetched news item (from a live/AI refresh) onto the
 * matching industry segment's curated news, so it persists and shows up for
 * everyone on that industry, not just in the current user's browser tab.
 * Trims to the most recent MAX_NEWS_ITEMS so the list doesn't grow forever.
 * No-ops quietly if the industry doesn't match an existing segment.
 */
const MAX_NEWS_ITEMS = 8;

export async function prependNewsItem(industry, item) {
  const segment = await IndustrySegment.findOne({ name: industry, active: true });
  if (!segment) return null;

  segment.news = [item, ...segment.news].slice(0, MAX_NEWS_ITEMS);
  await segment.save();
  return segment;
}
