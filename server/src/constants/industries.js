/**
 * Single source of truth for industry segments. Organized into groups so the
 * registration dropdown can render <optgroup>s instead of one giant flat
 * list, but every consumer that just needs "all valid values" (the Mongoose
 * enum, industry-data fallback, etc.) uses the flattened INDUSTRY_LIST.
 */
export const INDUSTRY_GROUPS = [
  {
    group: 'Retail & E-commerce',
    items: [
      'Retail & E-commerce',
      'Fashion & Apparel',
      'Beauty & Cosmetics',
      'Jewelry & Accessories',
      'Home & Furniture',
      'Toys & Kids Products',
      'Pet Care & Products',
      'Grocery & Consumer Packaged Goods'
    ]
  },
  {
    group: 'Food, Beverage & Hospitality',
    items: [
      'Food & Beverage',
      'Restaurants & QSR',
      'Travel & Hospitality',
      'Hotels & Lodging',
      'Bars, Nightlife & Events'
    ]
  },
  {
    group: 'Technology & Software',
    items: [
      'Technology',
      'Software & SaaS',
      'Consumer Electronics',
      'Telecommunications',
      'Gaming & Esports',
      'Artificial Intelligence & Data',
      'Cybersecurity'
    ]
  },
  {
    group: 'Health, Wellness & Life Sciences',
    items: [
      'Health & Wellness',
      'Fitness & Sports',
      'Pharmaceuticals & Biotech',
      'Medical & Healthcare Providers',
      'Mental Health & Therapy'
    ]
  },
  {
    group: 'Financial & Professional Services',
    items: [
      'Financial Services',
      'Banking',
      'Insurance',
      'Real Estate',
      'Legal Services',
      'Accounting & Tax Services',
      'Consulting & Professional Services',
      'Human Resources & Recruiting',
      'Marketing & Advertising Agencies'
    ]
  },
  {
    group: 'Media, Entertainment & Creative',
    items: [
      'Media & Entertainment',
      'Music & Audio',
      'Publishing & News',
      'Film & TV Production',
      'Photography & Creative Services',
      'Influencer & Creator Economy'
    ]
  },
  {
    group: 'Industrial, Energy & Infrastructure',
    items: [
      'Manufacturing & Industrial',
      'Automotive',
      'Energy & Utilities',
      'Construction & Architecture',
      'Logistics & Supply Chain',
      'Agriculture & Farming'
    ]
  },
  {
    group: 'Education & Public Sector',
    items: [
      'Education & E-Learning',
      'Government & Public Sector',
      'Non-Profit & Social Impact',
      'Religious & Community Organizations'
    ]
  },
  {
    group: 'Other',
    items: ['Event Management', 'Other']
  }
];

/**
 * Segments added after launch. Existing databases get these through
 * ensureAdditionalSegments() (insert-only: never edits or re-enables anything
 * that already exists); brand-new databases get them in the first seed.
 */
export const ADDITIONAL_INDUSTRY_GROUPS = [
  {
    group: 'Household & Personal Care',
    items: [
      'Home Care, Cleaning & Hygiene',
      'Personal Care & Toiletries',
      'Baby & Maternity Care',
      'Salon, Spa & Grooming',
      'Fragrances & Perfumes',
      'Sanitisers, Disinfectants & Antiseptics'
    ]
  },
  {
    group: 'Retail & E-commerce',
    items: [
      'Footwear & Leather Goods',
      'Eyewear & Watches',
      'Sports Goods & Equipment',
      'Stationery, Books & Gifting',
      'Home Appliances & Electricals',
      'Marketplaces & Quick Commerce'
    ]
  },
  {
    group: 'Food, Beverage & Hospitality',
    items: [
      'Packaged Foods & Snacks',
      'Dairy & Frozen Foods',
      'Beverages (Non-Alcoholic)',
      'Alcohol & Spirits',
      'Tea & Coffee',
      'Bakery & Confectionery',
      'Cloud Kitchens & Food Delivery'
    ]
  },
  {
    group: 'Health, Wellness & Life Sciences',
    items: [
      'Nutrition & Supplements',
      'Ayurveda & Natural Wellness',
      'Hospitals & Clinics',
      'Diagnostics & Pathology Labs',
      'Dental & Eye Care',
      'Medical Devices & Equipment',
      'Veterinary & Animal Health',
      'Yoga & Meditation'
    ]
  },
  {
    group: 'Technology & Software',
    items: ['IT Services & Outsourcing', 'Fintech & Payments', 'HealthTech', 'EdTech', 'E-commerce Platforms & D2C Tech', 'Web Hosting & Cloud Services']
  },
  {
    group: 'Financial & Professional Services',
    items: ['Mutual Funds & Wealth Management', 'Stock Broking & Trading', 'NBFC & Lending', 'Facility Management Services', 'Wedding & Lifestyle Services']
  },
  {
    group: 'Industrial, Energy & Infrastructure',
    items: [
      'Chemicals & Paints',
      'Textiles & Garments Manufacturing',
      'Packaging & Printing',
      'Building Materials & Hardware',
      'Aviation & Aerospace',
      'Electric Vehicles & Mobility',
      'Renewable Energy & Solar',
      'Mining, Metals & Steel',
      'Waste Management & Recycling'
    ]
  },
  {
    group: 'Education & Public Sector',
    items: ['Coaching & Test Preparation', 'Schools & Universities', 'Skill Development & Vocational Training']
  },
  {
    group: 'Travel & Tourism',
    items: ['Airlines & Airports', 'Tour Operators & Travel Agencies', 'Cruises & Resorts']
  }
];

export const ALL_INDUSTRY_GROUPS = [...INDUSTRY_GROUPS, ...ADDITIONAL_INDUSTRY_GROUPS];

export const INDUSTRY_LIST = ALL_INDUSTRY_GROUPS.flatMap((g) => g.items);
