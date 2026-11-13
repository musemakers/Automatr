import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'node:fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

console.log('Using model:', model);
console.log('Key loaded:', Boolean(process.env.OPENAI_API_KEY), '- length:', process.env.OPENAI_API_KEY?.length);

try {
  const response = await openai.images.generate({
    model,
    prompt: 'a simple test image of a red alloy wheel on a white background',
    size: '1024x1536',
    quality: 'high',
    n: 1
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image data returned in response.');

  fs.writeFileSync('test-output.png', Buffer.from(b64, 'base64'));
  console.log('✅ Success — saved test-output.png');
} catch (err) {
  console.error('❌ Failed:', err.status || '', err.message);
  if (err.error) console.error(JSON.stringify(err.error, null, 2));
}