import Anthropic from '@anthropic-ai/sdk';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Used when an uploaded brand guideline does not state a tone of voice: searches the web for how the brand
 * actually speaks (its website, social posts, press) and returns a short description. Returns '' when nothing
 * reliable is found - callers leave the field empty for the team to fill in.
 */
export async function findBrandVoice({ brandName, industry }) {
  const anthropic = getClient();
  if (!anthropic || !brandName) return { voiceTone: '' };

  const model = process.env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-4-5';
  const prompt = [
    `Search the web for how the brand "${brandName}"${industry ? ` (${industry} industry)` : ''} actually writes and speaks: its own website copy, social media posts, brand/about pages and press.`,
    'Describe its tone of voice in one to two plain sentences a copywriter could follow (for example: warm and conversational, plain-spoken, a little witty, never salesy), based only on what you really found.',
    'If you cannot find enough about this specific brand to say, reply with exactly: NONE',
    'After searching, respond with ONLY the description (or NONE). No markdown, no preamble, no citations.'
  ].join(' ');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', user_location: { type: 'approximate', country: 'IN', timezone: 'Asia/Kolkata' } }],
    messages: [{ role: 'user', content: prompt }]
  });
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!text || /^none\b/i.test(text)) return { voiceTone: '' };
  return { voiceTone: text.slice(0, 500) };
}
