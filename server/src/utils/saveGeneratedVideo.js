import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { uploadDir, uploadUrl } from './storage.js';

/**
 * Downloads a completed video from a provider's (often temporary) URL and
 * saves it locally, same pattern as saveGeneratedImage.js - so playback
 * and download links are always served from this app, not a third-party
 * URL that may expire.
 */
export async function saveGeneratedVideo(remoteUrl) {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Failed to download generated video (${res.status}).`);

  const filename = `gen-${uuidv4()}.mp4`;
  const filePath = path.join(uploadDir(), filename);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return uploadUrl(filename);
}
