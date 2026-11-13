// Languages a workspace can write its post copy, headlines and sub-headlines in (Brand Assets -> Languages).
// `name` is what is stored and sent to the writing model; `native` is shown next to it in the UI.
// English is always available and is the default when nothing else is set.
export const DEFAULT_LANGUAGE = 'English';

export const LANGUAGES = [
  ['English', 'English'], ['Hindi', 'हिन्दी'], ['Marathi', 'मराठी'], ['Gujarati', 'ગુજરાતી'], ['Bengali', 'বাংলা'], ['Tamil', 'தமிழ்'],
  ['Telugu', 'తెలుగు'], ['Kannada', 'ಕನ್ನಡ'], ['Malayalam', 'മലയാളം'], ['Punjabi', 'ਪੰਜਾਬੀ'], ['Odia', 'ଓଡ଼ିଆ'], ['Assamese', 'অসমীয়া'],
  ['Urdu', 'اردو'], ['Nepali', 'नेपाली'], ['Sinhala', 'සිංහල'], ['Konkani', 'कोंकणी'],
  ['Arabic', 'العربية'], ['Hebrew', 'עברית'], ['Persian', 'فارسی'], ['Turkish', 'Türkçe'],
  ['Spanish', 'Español'], ['Portuguese', 'Português'], ['French', 'Français'], ['German', 'Deutsch'], ['Italian', 'Italiano'], ['Dutch', 'Nederlands'],
  ['Swedish', 'Svenska'], ['Norwegian', 'Norsk'], ['Danish', 'Dansk'], ['Finnish', 'Suomi'], ['Polish', 'Polski'], ['Czech', 'Čeština'],
  ['Slovak', 'Slovenčina'], ['Hungarian', 'Magyar'], ['Romanian', 'Română'], ['Bulgarian', 'Български'], ['Greek', 'Ελληνικά'], ['Ukrainian', 'Українська'],
  ['Russian', 'Русский'], ['Serbian', 'Српски'], ['Croatian', 'Hrvatski'],
  ['Chinese (Simplified)', '简体中文'], ['Chinese (Traditional)', '繁體中文'], ['Japanese', '日本語'], ['Korean', '한국어'],
  ['Thai', 'ไทย'], ['Vietnamese', 'Tiếng Việt'], ['Indonesian', 'Bahasa Indonesia'], ['Malay', 'Bahasa Melayu'], ['Filipino', 'Filipino'],
  ['Swahili', 'Kiswahili'], ['Afrikaans', 'Afrikaans'], ['Amharic', 'አማርኛ'], ['Hausa', 'Hausa'], ['Zulu', 'isiZulu'],
  ['Icelandic', 'Íslenska'], ['Irish', 'Gaeilge'], ['Welsh', 'Cymraeg'], ['Catalan', 'Català'], ['Basque', 'Euskara'], ['Galician', 'Galego'], ['Yoruba', 'Yorùbá'], ['Igbo', 'Igbo'], ['Somali', 'Soomaali'], ['Azerbaijani', 'Azərbaycanca'], ['Uzbek', 'Oʻzbekcha'], ['Albanian', 'Shqip'], ['Estonian', 'Eesti'], ['Latvian', 'Latviešu'], ['Lithuanian', 'Lietuvių'], ['Slovenian', 'Slovenščina'], ['Bosnian', 'Bosanski'], ['Maltese', 'Malti'], ['Macedonian', 'Македонски'], ['Belarusian', 'Беларуская'], ['Kazakh', 'Қазақша'], ['Kyrgyz', 'Кыргызча'], ['Mongolian', 'Монгол'], ['Tajik', 'Тоҷикӣ'], ['Armenian', 'Հայերեն'], ['Georgian', 'ქართული'], ['Pashto', 'پښتو'], ['Sanskrit', 'संस्कृतम्'], ['Lao', 'ລາວ'], ['Khmer', 'ខ្មែរ'], ['Burmese', 'မြန်မာ'], ['Tibetan', 'བོད་སྐད་'], ['Cantonese (Hong Kong)', '廣東話']
].map(([name, native]) => ({ name, native }));

const NAMES = new Set(LANGUAGES.map((l) => l.name));
export const isKnownLanguage = (n) => NAMES.has(n);

// ISO-style code per language, used for the per-language font boxes on Brand Assets (fonts-<code>).
export const LANGUAGE_CODES = {"English": "en", "Spanish": "es", "French": "fr", "German": "de", "Italian": "it", "Portuguese": "pt", "Dutch": "nl", "Swedish": "sv", "Danish": "da", "Norwegian": "no", "Finnish": "fi", "Icelandic": "is", "Irish": "ga", "Welsh": "cy", "Catalan": "ca", "Basque": "eu", "Galician": "gl", "Indonesian": "id", "Malay": "ms", "Filipino": "fil", "Swahili": "sw", "Afrikaans": "af", "Zulu": "zu", "Hausa": "ha", "Yoruba": "yo", "Igbo": "ig", "Somali": "so", "Turkish": "tr", "Azerbaijani": "az", "Uzbek": "uz", "Albanian": "sq", "Estonian": "et", "Latvian": "lv", "Lithuanian": "lt", "Hungarian": "hu", "Polish": "pl", "Czech": "cs", "Slovak": "sk", "Slovenian": "sl", "Croatian": "hr", "Bosnian": "bs", "Romanian": "ro", "Maltese": "mt", "Vietnamese": "vi", "Russian": "ru", "Ukrainian": "uk", "Bulgarian": "bg", "Serbian": "sr", "Macedonian": "mk", "Belarusian": "be", "Kazakh": "kk", "Kyrgyz": "ky", "Mongolian": "mn", "Tajik": "tg", "Greek": "el", "Armenian": "hy", "Georgian": "ka", "Hebrew": "he", "Arabic": "ar", "Persian": "fa", "Urdu": "ur", "Pashto": "ps", "Hindi": "hi", "Marathi": "mr", "Nepali": "ne", "Sanskrit": "sa", "Bengali": "bn", "Assamese": "as", "Gujarati": "gu", "Punjabi": "pa", "Kannada": "kn", "Malayalam": "ml", "Tamil": "ta", "Telugu": "te", "Odia": "or", "Sinhala": "si", "Thai": "th", "Lao": "lo", "Khmer": "km", "Burmese": "my", "Tibetan": "bo", "Amharic": "am", "Chinese (Simplified)": "zh-CN", "Chinese (Traditional)": "zh-TW", "Cantonese (Hong Kong)": "zh-HK", "Japanese": "ja", "Korean": "ko"};
export const languageCode = (name) => LANGUAGE_CODES[name] || String(name || 'en').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12) || 'en';
