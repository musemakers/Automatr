// Turns an uploaded Markdown photography guide into numbered "units" (one sentence, list item, table row or code line each) and
// builds the editable fields back from a chosen set of unit numbers. The wording is NEVER changed: units are formatted (markdown
// symbols removed, table rows turned into plain phrases) and copied through exactly as the file has them. The AI's only job
// (services/ai/photographyService.js) is to say which unit numbers belong in which field.

const MAX_UNITS = 600;

const strip = (s) =>
  String(s || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:]|$)/g, '$1$2')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const endsLikeSentence = (s) => /[.!?:]$/.test(s);
const splitSentences = (para) => para.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((s) => s.trim()).filter(Boolean);

const isSeparatorRow = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => strip(c));

/** A table row as a plain phrase: "Hair: Dark, healthy... (phrases: ...)". Two columns read "A: B". */
function rowText(_headers, cells) {
  const clean = cells.filter((c) => c);
  if (!clean.length) return '';
  const [first, ...rest] = cells;
  const stopEach = (c) => (/[.!?]$/.test(c) ? c : `${c}.`);
  // Columns after the second read as further sentences of the same row ("Hair: <direction>. <example phrases>."), wording untouched.
  const body = rest.filter(Boolean).map((c) => stopEach(c.replace(/\s·\s/g, '; '))).join(' ');
  return first && body ? `${first}: ${body}` : stopEach(first || body);
}

/**
 * Returns [{ id, section, kind: 'text'|'code', text }] in document order.
 * section = the nearest heading (and bold label above, if any), so the AI can tell what each unit belongs to.
 */
export function splitUnits(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const units = [];
  let h = '';
  let label = '';
  let para = [];
  let fence = null; // { lines, section }
  let table = null; // { headers }

  const section = () => [h, label].filter(Boolean).join(' / ');
  const push = (kind, text) => {
    const t = kind === 'code' ? text.replace(/\s+/g, ' ').trim() : strip(text);
    if (t && units.length < MAX_UNITS) units.push({ id: units.length, section: section(), kind, text: t });
  };
  const flushPara = () => {
    if (!para.length) return;
    const joined = strip(para.join(' '));
    para = [];
    for (const s of splitSentences(joined)) push('text', s);
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (fence) {
      if (/^\s*```/.test(line)) { push('code', fence.lines.join(' ')); fence = null; label = ''; } else fence.lines.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { flushPara(); table = null; fence = { lines: [] }; continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { flushPara(); table = null; h = strip(heading[2]); label = ''; continue; }
    if (!line.trim()) { flushPara(); table = null; continue; }
    if (/^\s*\|/.test(line)) {
      flushPara();
      if (!table) { table = { headers: cellsOf(line) }; continue; }
      if (isSeparatorRow(line)) continue;
      push('text', rowText(table.headers, cellsOf(line)));
      continue;
    }
    // A line that is only a bold label (e.g. **Casting**) names the group of lines below it.
    const onlyBold = line.match(/^\s*\*\*([^*]+)\*\*:?\s*$/);
    if (onlyBold) {
      flushPara();
      const t = strip(onlyBold[1]);
      // A short bold line with no full stop ("Casting", "Locked suffix for model images") names the group below it; a bold sentence is content of its own and is kept as a unit.
      if (t.split(' ').length > 12 || /[.!?]$/.test(t)) push('text', endsLikeSentence(t) ? t : `${t}.`);
      else label = t;
      continue;
    }
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (item) {
      flushPara();
      const t = strip(item[1]);
      // a list item may itself hold several sentences; keep it whole so a rule is never split from its example
      if (t) push('text', endsLikeSentence(t) ? t : `${t}.`);
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  if (fence?.lines.length) push('code', fence.lines.join(' '));
  return units;
}

const validIds = (arr, max) => [...new Set((Array.isArray(arr) ? arr : []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n < max))].sort((a, b) => a - b);

/**
 * Builds the fields from the AI's choice of unit numbers. selection = { look, people, product, avoid: [ids], modelSuffix, productSuffix: id|null }.
 * Prose fields are the chosen units, in file order, joined as written. Suffix / avoid come from code blocks and keep their commas.
 * Returns { fields, usedIds } (usedIds = every unit that went into some field).
 */
export function assembleFields(units, selection = {}) {
  const max = units.length;
  const used = new Set();
  const prose = (ids) => {
    const list = validIds(ids, max);
    list.forEach((i) => used.add(i));
    return list.map((i) => units[i].text).join(' ');
  };
  const one = (id) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 0 || n >= max) return '';
    used.add(n);
    return units[n].text;
  };
  const fields = {
    look: prose(selection.look),
    people: prose(selection.people),
    product: prose(selection.product),
    avoid: validIds(selection.avoid, max).map((i) => { used.add(i); return units[i].text; }).join(', '),
    modelSuffix: one(selection.modelSuffix),
    productSuffix: one(selection.productSuffix)
  };
  return { fields, usedIds: used };
}
