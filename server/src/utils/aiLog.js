// Loud, hard-to-miss server logs for every AI call: which model, what it is doing, how long it took.
//   ⟦AI⟧ 14:02:11  VIDEO ▶ veo-3.1-lite-generate-preview (Google Veo) · submitting job · 9:16 · 8s
// The "⟦AI⟧" marker is plain text, so `| grep AI` finds these lines even with colours off.
// Env: AI_LOG=off hides them · NO_COLOR=1 or AI_LOG_COLOR=0 removes colours.

const OFF = /^(off|0|false)$/i.test(process.env.AI_LOG || '');
const COLOR = !process.env.NO_COLOR && process.env.AI_LOG_COLOR !== '0';
const esc = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);

const KIND = {
  text:   { label: ' TEXT   ', bg: '44;97' },   // white on blue
  image:  { label: ' IMAGE  ', bg: '42;30' },   // black on green
  vision: { label: ' VISION ', bg: '46;30' },   // black on cyan
  video:  { label: ' VIDEO  ', bg: '43;30' },   // black on yellow
  prompt: { label: ' PROMPT ', bg: '45;97' },   // white on magenta
  lock:   { label: ' LOCK   ', bg: '47;30' }    // black on white
};
const STATUS = {
  start: { sym: '▶', color: '1;96' },
  done:  { sym: '✔', color: '1;92' },
  fail:  { sym: '✖', color: '1;91' },
  retry: { sym: '↻', color: '1;93' },
  info:  { sym: '•', color: '1;97' }
};

function stamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * aiLog('video', 'start', { provider, model, msg, ms, extra })
 * provider/model are shown as "model (Provider)"; ms is shown as elapsed time.
 */
export function aiLog(kind, status, { provider, model, msg, ms, extra } = {}) {
  if (OFF) return;
  const k = KIND[kind] || KIND.text;
  const s = STATUS[status] || STATUS.info;
  const who = model ? `${esc('1', model)}${provider ? esc('2', ` (${provider})`) : ''}` : provider ? esc('1', provider) : '';
  const bits = [
    esc('1;97;45', ' ⟦AI⟧ '),
    esc('2', stamp()),
    esc(k.bg, k.label) + ' ' + esc(s.color, s.sym),
    who,
    msg ? esc(status === 'fail' ? '91' : '0', `— ${msg}`) : '',
    typeof ms === 'number' ? esc('93', `· ${ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'}`) : '',
    extra ? esc('2', `· ${extra}`) : ''
  ].filter(Boolean);
  console.log(bits.join(' '));
}

/** const t = aiLogTimer('image', {...}); t.done('saved'); t.fail(err); t.retry('black band'); */
export function aiLogTimer(kind, base = {}) {
  const t0 = Date.now();
  aiLog(kind, 'start', base);
  return {
    done: (msg, extra) => aiLog(kind, 'done', { ...base, msg: msg || 'finished', extra, ms: Date.now() - t0 }),
    fail: (err, extra) => aiLog(kind, 'fail', { ...base, msg: String(err?.message || err || 'failed').slice(0, 220), extra, ms: Date.now() - t0 }),
    retry: (msg, extra) => aiLog(kind, 'retry', { ...base, msg, extra, ms: Date.now() - t0 }),
    info: (msg, extra) => aiLog(kind, 'info', { ...base, msg, extra })
  };
}
