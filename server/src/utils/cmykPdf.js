import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const deflate = promisify(zlib.deflate);

/**
 * Writes a one-page PDF whose page is a single full-bleed 8-bit DeviceCMYK image (no PDF library needed).
 * `raw` is the interleaved C,M,Y,K bytes (w*h*4). The page is `pageW` x `pageH` points; TrimBox sits `bleedPt` in from every edge
 * (BleedBox = MediaBox), which is how print shops read trim and bleed.
 */
export async function writeCmykPdf({ outPath, raw, width, height, pageW, pageH, bleedPt = 0, title = 'Billboard artwork' }) {
  const data = await deflate(raw, { level: 6 });
  const n = (v) => Number(v.toFixed(3));
  const esc = (s) => String(s).replace(/[()\\]/g, ' ').replace(/[^\x20-\x7e]/g, '');
  const content = `q ${n(pageW)} 0 0 ${n(pageH)} 0 0 cm /Im0 Do Q`;
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); chunks.push(buf); pos += buf.length; };
  const obj = (id, body) => { offsets[id] = pos; push(`${id} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] /BleedBox [0 0 ${n(pageW)} ${n(pageH)}] /TrimBox [${n(bleedPt)} ${n(bleedPt)} ${n(pageW - bleedPt)} ${n(pageH - bleedPt)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  offsets[5] = pos;
  push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`);
  push(data);
  push('\nendstream\nendobj\n');
  obj(6, `<< /Title (${esc(title)}) /Producer (Automatr) >>`);
  const xref = pos;
  let table = `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i += 1) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  await fs.writeFile(outPath, Buffer.concat(chunks));
}
