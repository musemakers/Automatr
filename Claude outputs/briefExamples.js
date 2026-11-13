// Example text for the New Creative input boxes (shown as placeholders), tuned to the brand's category.
// The category comes from the account's company industry; the brand name is used when "Follow brand guidelines" is on.
// Placeholders are display-only: nothing here is ever sent to the AI.

const PACKS = [
  {
    match: /food|beverage|restaurant|cafe|coffee|bakery|dining|grocery|f&b|hospitality/i,
    product: 'the new cold coffee range',
    audience: 'young professionals',
    context: 'Launching our new festive menu this weekend. Aimed at families and office groups, it should make people hungry and nudge them to book a table.',
    key: 'Fresh, handmade and ready when you are.',
    visual: 'Close-up of a steaming plate on a rustic wooden table, soft window light, a hand reaching in',
    include: 'the dish, our logo, a steam wisp',
    avoid: 'stock-looking smiles, cluttered tables',
    people: 'friends sharing a meal at a cafe table, casual clothing',
    stock: 'coffee shop morning light'
  },
  {
    match: /beauty|cosmetic|skin|hair|makeup|personal care|wellness|salon|spa/i,
    product: 'the new vitamin C serum',
    audience: 'women aged 25 to 40',
    context: 'Launching our new vitamin C serum for glowing skin. Aimed at women 25 to 40 who want a simple routine, it should feel clean, trusted and premium.',
    key: 'Visible glow in two weeks, gentle on every skin type.',
    visual: 'Serum bottle on a pale marble surface with a few water droplets and soft golden light',
    include: 'the product bottle, the label clearly legible',
    avoid: 'before and after photos, heavy filters',
    people: 'a woman in her late twenties with natural glowing skin, minimal makeup',
    stock: 'skincare flat lay soft light'
  },
  {
    match: /real estate|property|construction|housing|developer|infrastructure|architecture/i,
    product: 'the new 3 BHK residences',
    audience: 'young families',
    context: 'Announcing the launch of our new 3 BHK residences. Aimed at young families looking to buy, it should feel aspirational and invite site visits this month.',
    key: 'Spacious homes designed around the way your family lives.',
    visual: 'Tower at golden hour with a landscaped podium garden and a family walking in the foreground',
    include: 'the building, the project name, the RERA number',
    avoid: 'crowded streets, unfinished construction',
    people: 'a young family on a balcony at sunset, casual clothing',
    stock: 'modern apartment building golden hour'
  },
  {
    match: /fashion|apparel|cloth|garment|jewel|lifestyle|accessor|footwear|textile/i,
    product: 'the festive collection',
    audience: 'style-led shoppers aged 20 to 35',
    context: 'Showcasing our new festive collection. Aimed at style-led shoppers aged 20 to 35, it should feel confident, colourful and easy to shop.',
    key: 'Dress for the moment. The festive edit is here.',
    visual: 'Model mid-stride in the new outfit against a bold coloured backdrop, editorial lighting',
    include: 'the full outfit, our logo, the new collection tag',
    avoid: 'muted colours, busy backgrounds',
    people: 'a stylish model in her twenties, confident pose, studio setting',
    stock: 'fashion editorial colourful backdrop'
  },
  {
    match: /tech|software|saas|it services|digital|app|startup|ai\b|electronics|telecom/i,
    product: 'the new analytics dashboard',
    audience: 'operations and marketing teams',
    context: 'Announcing our new analytics dashboard. Aimed at operations and marketing teams, it should feel clear, credible and invite a demo request.',
    key: 'See every metric that matters in one place.',
    visual: 'Laptop and phone showing the clean dashboard on a bright desk, subtle blue gradient background',
    include: 'the product screens, our logo, a clear call to action',
    avoid: 'stock handshake photos, tiny unreadable screens',
    people: 'a small team gathered around a laptop in a modern office',
    stock: 'team working on laptop modern office'
  },
  {
    match: /health|medical|pharma|hospital|clinic|fitness|gym|nutrition|care/i,
    product: 'the new wellness programme',
    audience: 'adults looking to build healthy habits',
    context: 'Promoting our new 30-day wellness programme. Aimed at busy adults who want to build healthy habits, it should feel reassuring, energetic and easy to start.',
    key: 'Small daily habits, real lasting change.',
    visual: 'Person stretching in bright morning light by a window, fresh fruit and water bottle in the frame',
    include: 'the programme name, our logo, a booking prompt',
    avoid: 'clinical settings, exaggerated claims',
    people: 'an adult in comfortable activewear exercising at home, relaxed and smiling',
    stock: 'morning yoga natural light'
  },
  {
    match: /education|school|college|university|training|learning|coaching|edtech/i,
    product: 'the new certification course',
    audience: 'working professionals and graduates',
    context: 'Opening admissions for our new certification course. Aimed at graduates and working professionals, it should feel credible, encouraging and drive sign-ups.',
    key: 'Learn job-ready skills in 12 weeks.',
    visual: 'Student at a bright desk with a laptop and notes, warm daylight, campus window behind',
    include: 'the course name, admission deadline, our logo',
    avoid: 'stock graduation caps, dark moody tones',
    people: 'a group of students studying together, casual clothing',
    stock: 'students studying bright classroom'
  },
  {
    match: /financ|bank|insurance|invest|loan|fintech|wealth/i,
    product: 'the new savings plan',
    audience: 'salaried professionals',
    context: 'Launching our new savings plan. Aimed at salaried professionals planning ahead, it should feel trustworthy, simple and prompt people to learn more.',
    key: 'Grow your savings with a plan that is simple and secure.',
    visual: 'Clean desk with a phone showing the app, a small plant and warm natural light',
    include: 'the plan name, our logo, the disclaimer line',
    avoid: 'piles of cash, stock handshake photos',
    people: 'a couple reviewing plans on a phone at home, relaxed',
    stock: 'couple planning finances at home'
  },
  {
    match: /auto|car|vehicle|motor|bike|mobility|ev\b/i,
    product: 'the new SUV',
    audience: 'urban families and weekend travellers',
    context: 'Launching our new SUV. Aimed at urban families and weekend travellers, it should feel bold, safe and adventurous, and drive test-drive bookings.',
    key: 'Built for the city, ready for every weekend.',
    visual: 'SUV on a coastal road at golden hour, dynamic low angle, light reflecting off the bodywork',
    include: 'the vehicle, our logo, the model name',
    avoid: 'traffic jams, other brands visible',
    people: 'a family loading bags into the car for a weekend trip',
    stock: 'suv coastal road sunset'
  },
  {
    match: /travel|tourism|hotel|resort|airline|holiday/i,
    product: 'the new island getaway package',
    audience: 'couples and small groups',
    context: 'Promoting our new island getaway package. Aimed at couples and small groups, it should feel relaxing, inviting and nudge people to book before the season fills up.',
    key: 'Your escape is closer than you think.',
    visual: 'Beach villa at sunrise with turquoise water, hammock and a breakfast tray in the foreground',
    include: 'the resort, the package price, our logo',
    avoid: 'crowded beaches, grey skies',
    people: 'a couple relaxing on a villa deck, summer clothing',
    stock: 'tropical beach resort sunrise'
  },
  {
    match: /retail|e-?commerce|consumer|fmcg|shop|store|home|furniture|decor|goods/i,
    product: 'the new seasonal range',
    audience: 'everyday shoppers',
    context: 'Promoting our festive sale on the new seasonal range. Aimed at everyday shoppers, it should feel exciting and make the offer unmissable.',
    key: 'Festive favourites at their best prices, this week only.',
    visual: 'Product range arranged on a bright coloured backdrop with festive props and confetti',
    include: 'the product, the offer, our logo',
    avoid: 'cluttered layouts, tiny text',
    people: 'a happy shopper unboxing a gift at home',
    stock: 'festive shopping gifts colourful'
  }
];

const GENERIC = {
  product: 'the new range',
  audience: 'your target customers',
  context: 'Launching our new range this month. Aimed at our core customers, it should feel confident and clear, and nudge people to take one next step.',
  key: 'The one thing we want people to remember.',
  visual: 'The product centred on a clean surface with soft shadows and natural light',
  include: 'the product, our logo',
  avoid: 'cluttered backgrounds, competitor colours',
  people: 'a customer using the product at home, casual clothing',
  stock: 'product on a clean surface soft light'
};

/** Placeholder examples for the brief boxes. industry = account's company industry; brandName only used when follow-brand is on. */
export function briefExamples({ industry = '', brandName = '', followBrand = true } = {}) {
  const pack = PACKS.find((p) => p.match.test(industry || '')) || GENERIC;
  const brand = followBrand ? String(brandName || '').trim() : '';
  const withBrand = (t) => (brand ? t.replace(/^Launching our /, `Launching ${brand}’s `).replace(/^Announcing our /, `Announcing ${brand}’s `) : t);
  return {
    purposeOther: 'e.g. ' + (pack.product === GENERIC.product ? 'Store opening weekend' : `Introducing ${pack.product}`),
    context: 'e.g. ' + withBrand(pack.context),
    key: 'e.g. ' + pack.key,
    visual: 'e.g. ' + pack.visual,
    include: 'e.g. ' + pack.include,
    avoid: 'e.g. ' + pack.avoid,
    people: 'e.g. ' + pack.people,
    stock: 'e.g. ' + pack.stock
  };
}
