// What each tab and box of the Brand Assets screen holds. Mirrors the reference prototype (brand-profile.js), plus the boxes
// the older screen had that the prototype did not (preferred layouts, colour roles, sub-brands, photography guide).
export const FONT_ROLES = ['Headline', 'Sub headline'];
export const CASES = ['As written', 'Title case', 'All caps', 'Lowercase'];
export const COLOUR_ROLES = ['', 'Background', 'Text', 'Button or call to action', 'Highlight or accent'];
export const LOGO_VERSIONS = [['', 'Not set'], ['primary', 'Primary'], ['secondary', 'Secondary'], ['icon', 'Icon or symbol'], ['horizontal', 'Horizontal'], ['stacked', 'Stacked'], ['white', 'White (for dark backgrounds)'], ['black', 'Black'], ['one-colour', 'One colour']];
export const SPEC = {"cyrillic": "Умные стали для яркого будущего", "cyrillic-ext": "Умные стали для яркого будущего", "greek": "Πιο έξυπνος χάλυβας για ένα λαμπρότερο μέλλον", "hebrew": "פלדה חכמה יותר לעתיד בהיר יותר", "arabic": "فولاذ أذكى لمستقبل أكثر إشراقًا", "devanagari": "उज्ज्वल भविष्य के लिए स्मार्ट इस्पात", "bengali": "উজ্জ্বল ভবিষ্যতের জন্য আরও স্মার্ট ইস্পাত", "gujarati": "ઉજ્જવળ ભવિષ્ય માટે વધુ સ્માર્ટ સ્ટીલ", "gurmukhi": "ਰੌਸ਼ਨ ਭਵਿੱਖ ਲਈ ਹੋਰ ਸਮਾਰਟ ਸਟੀਲ", "kannada": "ಉಜ್ವಲ ಭವಿಷ್ಯಕ್ಕಾಗಿ ಹೆಚ್ಚು ಸ್ಮಾರ್ಟ್ ಉಕ್ಕು", "malayalam": "ശോഭനമായ ഭാവിക്കായി കൂടുതൽ മികച്ച ഉരുക്ക്", "tamil": "ஒளிமயமான எதிர்காலத்திற்கான சிறந்த எஃகு", "telugu": "ఉజ్వల భవిష్యత్తు కోసం మరింత స్మార్ట్ ఉక్కు", "oriya": "ଉଜ୍ଜ୍ୱଳ ଭବିଷ୍ୟତ ପାଇଁ ସ୍ମାର୍ଟ ଇସ୍ପାତ", "sinhala": "ආයුබෝවන්", "thai": "เหล็กกล้าที่ฉลาดกว่า เพื่ออนาคตที่สดใส", "lao": "ສະບາຍດີ", "khmer": "សួស្តី", "myanmar": "မင်္ဂလာပါ", "tibetan": "བཀྲ་ཤིས་བདེ་ལེགས", "ethiopic": "ሰላም", "armenian": "Ավելի խելացի պողպատ ավելի պայծառ ապագայի համար", "georgian": "უფრო ჭკვიანი ფოლადი უკეთესი მომავლისთვის", "chinese-simplified": "为更光明的未来打造更智能的钢铁", "chinese-traditional": "為更光明的未來打造更智慧的鋼鐵", "chinese-hongkong": "為更光明的未來打造更智慧的鋼鐵", "japanese": "より明るい未来のための、よりスマートな鉄鋼", "korean": "더 밝은 미래를 위한 더 스마트한 철강", "vietnamese": "Thép thông minh hơn cho tương lai tươi sáng hơn"};
export const LSPEC = {"es": "Acero más inteligente para un futuro más brillante", "fr": "Un acier plus intelligent pour un avenir plus brillant", "de": "Intelligenterer Stahl für eine hellere Zukunft", "it": "Acciaio più intelligente per un futuro più luminoso", "pt": "Aço mais inteligente para um futuro mais brilhante", "nl": "Slimmer staal voor een stralendere toekomst", "sv": "Smartare stål för en ljusare framtid", "da": "Smartere stål til en lysere fremtid", "no": "Smartere stål for en lysere fremtid", "fi": "Älykkäämpää terästä valoisampaan tulevaisuuteen", "is": "Snjallara stál fyrir bjartari framtíð", "ca": "Acer més intel·ligent per a un futur més brillant", "gl": "Aceiro máis intelixente para un futuro máis brillante", "id": "Baja yang lebih cerdas untuk masa depan yang lebih cerah", "ms": "Keluli yang lebih bijak untuk masa depan yang lebih cerah", "fil": "Mas matalinong bakal para sa mas maliwanag na kinabukasan", "sw": "Chuma mahiri zaidi kwa mustakabali angavu zaidi", "af": "Slimmer staal vir 'n helderder toekoms", "tr": "Daha parlak bir gelecek için daha akıllı çelik", "az": "Daha parlaq gələcək üçün daha ağıllı polad", "uz": "Yorqinroq kelajak uchun aqlliroq po'lat", "sq": "Çelik më i zgjuar për një të ardhme më të ndritshme", "et": "Nutikam teras helgema tuleviku jaoks", "lv": "Gudrāks tērauds gaišākai nākotnei", "lt": "Išmanesnis plienas šviesesnei ateičiai", "hu": "Okosabb acél egy fényesebb jövőért", "pl": "Mądrzejsza stal na jaśniejszą przyszłość", "cs": "Chytřejší ocel pro světlejší budoucnost", "sk": "Múdrejšia oceľ pre svetlejšiu budúcnosť", "sl": "Pametnejše jeklo za svetlejšo prihodnost", "hr": "Pametniji čelik za svjetliju budućnost", "bs": "Pametniji čelik za svjetliju budućnost", "ro": "Oțel mai inteligent pentru un viitor mai luminos", "uk": "Розумніша сталь для світлішого майбутнього", "bg": "По-умна стомана за по-светло бъдеще", "sr": "Паметнији челик за светлију будућност", "mk": "Попаметен челик за посветла иднина", "be": "Разумнейшая сталь для светлай будучыні", "kk": "Жарқын болашаққа арналған ақылды болат", "mn": "Илүү ухаалаг ган, илүү гэгээлэг ирээдүйд", "fa": "فولاد هوشمندتر برای آینده‌ای روشن‌تر", "ur": "روشن مستقبل کے لیے اسمارٹ اسٹیل", "mr": "उज्ज्वल भविष्यासाठी स्मार्ट पोलाद", "ne": "उज्यालो भविष्यका लागि स्मार्ट इस्पात"};
export const SAMPLE = { 'Sub headline': 'Built on strength, shaped by what comes next', def: 'Smarter steels for a brighter future' };

export const TABS = [
  { id: 'guidelines', label: 'Guidelines', title: 'Brand guidelines', lead: 'Upload your guidelines PDF. We read it and fill in every tab. Everything in these boxes is what Automatr follows when it makes a creative, so keep each note clear and specific.', boxes: [
    { id: 'essence', title: 'Brand essence', desc: 'Who the brand is: vision, values, personality, tagline.', kind: 'fact', add: 'Add a point' },
    { id: 'voice', title: 'Voice and messaging', desc: 'How the brand sounds and what it says.', kind: 'text', tags: ['Tone', 'Narrative', 'Key Messaging', 'Headlines', 'Sub Headlines', 'Post Copy'], ph: 'e.g. Keep headlines short and confident. No exclamation marks.' },
    { id: 'layout', title: 'Layout and grid', desc: 'Grid, margins and where each element sits in a creative. Upload a preferred layout and the AI starts from that composition.', kind: 'text', files: 'layoutFiles', ph: 'e.g. Keep a 5% margin on every edge.' },
    { id: 'audiences', title: 'Target audiences', desc: 'Who the brand is talking to.', kind: 'text', fl: 'Audience', add: 'Add an audience', ph: 'e.g. Construction and infrastructure buyers, aged 30 to 55.' },
    { id: 'alwaysDo', title: 'Always do', desc: 'Things every creative must do.', kind: 'text', row: 'do', fl: 'Rule', add: 'Add a rule', ph: 'e.g. Show the logo on every creative.' },
    { id: 'neverDo', title: 'Never do', desc: 'Things no creative may do.', kind: 'text', row: 'do', fl: 'Rule', add: 'Add a rule', ph: 'e.g. Never stretch or recolor the logo.' },
    { id: 'preferredWords', title: 'Preferred words', desc: 'Words and phrases to use.', kind: 'text', row: 'words', short: true, fl: 'Word or phrase', add: 'Add a word', ph: 'e.g. Smarter' },
    { id: 'avoidWords', title: 'Words to avoid', desc: 'Words and phrases to keep out.', kind: 'text', row: 'words', short: true, fl: 'Word or phrase', add: 'Add a word', ph: 'e.g. Cheap' },
    { id: 'taglines', title: 'Taglines', desc: 'Approved taglines and when each is used.', kind: 'text', short: true, fl: 'Tagline', add: 'Add a tagline', ph: 'e.g. Smarter steels, brighter futures' },
    { id: 'mandatory', title: 'Mandatory line', desc: 'Disclaimer or legal text that must appear on creatives.', kind: 'text', short: true, fl: 'Line', add: 'Add a line', ph: 'e.g. Terms and conditions apply.' }
  ] },
  { id: 'assets', label: 'Assets', title: 'Assets', lead: 'Upload your logo, image and graphic files, and write how they should be used. Everything you add also appears in the asset library at the bottom.', boxes: [
    { id: 'logo', title: 'Logo', desc: 'Logo versions, plus rules for placement, spacing and size.', kind: 'text', files: 'logoFiles', mention: ['logoFiles', 'imageFiles', 'graphicFiles'], mentionNoun: 'file', ph: 'e.g. Use the white logo on dark backgrounds. Logo is never smaller than 20 mm wide.' },
    { id: 'images', title: 'Images', desc: 'Photos and product shots Automatr can use in creatives, plus rules for using them.', kind: 'text', files: 'imageFiles', mention: ['logoFiles', 'imageFiles', 'graphicFiles'], mentionNoun: 'file', ph: 'e.g. Use product shots on a clean light background.' },
    { id: 'graphic', title: 'Graphics & Icons', desc: 'Graphics, icons and patterns, plus rules for using them.', kind: 'text', files: 'graphicFiles', mention: ['logoFiles', 'imageFiles', 'graphicFiles'], mentionNoun: 'file', ph: 'e.g. Use the brand stroke at most once per creative.' },
    { id: 'websites', title: 'Website URL', desc: 'Where the brand lives online.', kind: 'url', add: 'Add a website' }
  ] },
  { id: 'colors', label: 'Colors', title: 'Colors', lead: 'Your brand palette and how to use it.', boxes: [
    { id: 'colourUse', title: 'Colors', desc: 'Palette colors, plus rules for using them.', kind: 'text', files: 'colourSwatches', mention: ['colourSwatches'], mentionNoun: 'color', ph: 'e.g. Use @Smart Red for calls to action only.' }
  ] },
  { id: 'imagery', label: 'Imagery', title: 'Imagery', lead: 'What photos and illustrations should look like.', boxes: [
    { id: 'refs', title: 'Photography Styling', desc: 'Example photos that show the look to aim for. We write a brief for AI image creation from them.', note: 'Note: none of these images will be used as actual assets.', kind: 'text', noInstr: true, files: 'refFiles', mention: ['refFiles', 'illustrationFiles'], mentionNoun: 'image' },
    { id: 'illustration', title: 'Illustration Styling', desc: 'Example illustrations that show the look to aim for. We write a brief for AI illustration creation from them.', note: 'Note: none of these images will be used as actual assets.', kind: 'text', noInstr: true, files: 'illustrationFiles', mention: ['refFiles', 'illustrationFiles'], mentionNoun: 'image', ph: 'e.g. Flat shapes in earthy, subtle colors.' }
  ] },
  { id: 'languages', label: 'Languages & Fonts', title: 'Languages & Fonts', lead: 'The languages creatives are made in, and the fonts used for each. Add a language to get its own set of fonts.', boxes: [
    { id: 'languages', title: 'Languages', desc: 'Languages the brand communicates in. The default language is used unless a creative says otherwise.', kind: 'lang', add: 'Add a language' },
    { id: 'translation', title: 'Translation and localisation rules', desc: 'What stays in English, what gets translated, and how.', kind: 'text', ph: 'e.g. Never translate the brand name or tagline.' }
  ] }
];

// File and colour stores that sit inside a box (their own list under the instructions).
export const SUBS = [
  { id: 'colourSwatches', parent: 'colourUse', title: 'Colors', desc: '', kind: 'colour', swatch: true, add: 'Add color', noun: 'color' },
  { id: 'logoFiles', parent: 'logo', title: 'Logo files', desc: 'Primary, white, icon-only and any other version.', kind: 'image', asset: true, add: 'Upload logo', noun: 'logo', cap: 'e.g. Primary logo', assetKind: 'logo', logo: true },
  { id: 'imageFiles', parent: 'images', title: 'Image files', desc: '', kind: 'image', asset: true, noBg: true, add: 'Upload image', noun: 'image', cap: 'e.g. Plant at dusk', assetKind: 'product' },
  { id: 'graphicFiles', parent: 'graphic', title: 'Graphics & Icons files', desc: 'Patterns, shapes, strokes and other devices.', kind: 'image', asset: true, add: 'Upload graphic', noun: 'graphic', cap: 'e.g. Brand stroke', assetKind: 'texture' },
  { id: 'refFiles', parent: 'refs', title: 'Reference images', desc: '', kind: 'image', asset: true, noBg: true, add: 'Upload references', noun: 'reference', cap: 'e.g. Natural light portrait', assetKind: 'reference', styleGroup: 'photo' },
  { id: 'illustrationFiles', parent: 'illustration', title: 'Illustration files', desc: '', kind: 'image', asset: true, noBg: true, add: 'Upload references', noun: 'reference', cap: 'e.g. Friendly group illustration', assetKind: 'reference', styleGroup: 'illustration' },
  { id: 'layoutFiles', parent: 'layout', title: 'Preferred layouts', desc: 'The AI starts from the closest one. Hidden from the customer.', kind: 'image', asset: true, noBg: true, add: 'Upload layout', noun: 'layout', cap: 'e.g. Festive offer layout', assetKind: 'layout' }
];

export const LIBS = [
  { id: 'lib2', tab: 'assets', noun: 'file', title: 'Asset library', addLabel: 'Add more assets', groups: ['logoFiles', 'imageFiles', 'graphicFiles'], labels: { logoFiles: 'Logos', imageFiles: 'Images', graphicFiles: 'Graphics & Icons' } },
  { id: 'lib3', tab: 'imagery', noun: 'image', title: 'Reference library', addLabel: 'Add more references', groups: ['refFiles', 'illustrationFiles'], labels: { refFiles: 'Photography Styling', illustrationFiles: 'Illustration Styling' } }
];

export const BOX = {};
TABS.forEach((t) => t.boxes.forEach((b) => { b.tab = t.id; BOX[b.id] = b; }));
SUBS.forEach((s) => { s.tab = BOX[s.parent].tab; BOX[s.id] = s; });

// ---------- small helpers ----------
export const uid = () => `i${Math.random().toString(36).slice(2, 9)}`;
export const fmtSize = (b) => (!b ? '' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export function normUrl(v) {
  v = String(v || '').trim();
  if (!v || /\s/.test(v)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !(u.hostname.indexOf('.') > 0 || u.hostname === 'localhost')) return null; return u.origin + (u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash); } catch { return null; }
}
export function normHex(v) {
  v = String(v || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.replace(/(.)/g, '$1$1');
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : null;
}
export function ago(t) {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString();
}
export function badge(it) {
  if (it.from === 'user') return 'Added by you';
  const s = it.from === 'system' && !it.edited ? 'Built in' : it.edited ? 'Edited by you' : it.from === 'migrated' ? 'From the earlier guide' : 'From Guideline';
  return s + (it.p ? ` \u00b7 p. ${it.p}` : '');
}
export const primaryText = (b, it) => it.url || it.text || it.value || it.name || it.family || it.caption || '';
