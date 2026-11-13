// Hand a finished creative from one flow to the next ("Adapt now" / "Convert now" cards) so the person does
// not upload it again. The image is kept in sessionStorage as a URL (same-origin asset or data/blob URL turned
// into a data URL) and consumed once by the receiving editor on mount.
//
//   sender:    startNextFlow(navigate, 'resize' | 'convert', imageUrl)
//   receiver:  const file = await takeHandoffFile('resize')   // File | null; null when nothing was handed over
import { resolveAssetUrl } from '../api/client.js';

const KEY = 'automatr:handoff';

async function toDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ dataUrl: r.result, type: blob.type || 'image/png' });
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function startNextFlow(navigate, kind, imageUrl) {
  const abs = resolveAssetUrl(imageUrl);
  const { dataUrl, type } = await toDataUrl(abs);
  try { sessionStorage.setItem(KEY, JSON.stringify({ kind, dataUrl, type, at: Date.now() })); } catch { /* storage full or blocked */ }
  navigate('/generate', { state: { start: kind } });
}

export function hasHandoff(kind) {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return Boolean(v && v.kind === kind); } catch { return false; }
}

export async function takeHandoffFile(kind) {
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
  if (!v || v.kind !== kind) return null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  const blob = await (await fetch(v.dataUrl)).blob();
  const ext = (v.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([blob], `creative.${ext}`, { type: v.type });
}
