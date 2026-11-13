import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// "@" tagging in a prompt box (same behaviour as the reference): typing @ lists the references the person has added
// (uploaded or from Brand Assets); picking one writes "@Name" into the text, and each tagged "@Name" gets a soft
// highlight behind it. assets = [{ name, src? }]
const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textIndent', 'textTransform', 'wordSpacing', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'];
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function MentionTextarea({ value, onChange, assets = [], className = 'fx-field', maxLength, ...rest }) {
  const ta = useRef(null);
  const mirror = useRef(null);
  const wrap = useRef(null);
  const [pop, setPop] = useState(null); // { start, q, index, rect }
  const names = assets.map((a) => a.name).filter(Boolean);
  const list = pop ? assets.filter((a) => !pop.q || norm(a.name).includes(pop.q)) : [];

  // Keep the highlight layer looking exactly like the text box.
  useLayoutEffect(() => {
    const t = ta.current, m = mirror.current, w = wrap.current;
    if (!t || !m) return;
    const cs = getComputedStyle(t);
    COPY.forEach((k) => { m.style[k] = cs[k]; });
    m.style.borderStyle = 'solid';
    m.style.borderColor = 'transparent';
    w.style.borderRadius = cs.borderRadius;
  });
  useEffect(() => { if (mirror.current && ta.current) mirror.current.scrollTop = ta.current.scrollTop; }, [value]);

  function html() {
    const sorted = [...names].sort((a, b) => b.length - a.length);
    if (!sorted.length) return null;
    const re = new RegExp(`@(${sorted.map(esc).join('|')})(?=\\s|$)`, 'g');
    const out = []; let last = 0, m;
    while ((m = re.exec(value))) {
      out.push(value.slice(last, m.index));
      out.push(<mark key={m.index} className="mention-mark">{m[0]}</mark>);
      last = m.index + m[0].length;
    }
    out.push(value.slice(last));
    return out;
  }

  function check() {
    const t = ta.current; if (!t) return;
    const before = t.value.slice(0, t.selectionStart);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    if (!m) { setPop(null); return; }
    setPop({ start: t.selectionStart - m[2].length - 1, q: norm(m[2]), index: 0, rect: t.getBoundingClientRect() });
  }
  function choose(a) {
    const t = ta.current;
    const next = `${value.slice(0, pop.start)}@${a.name} ${value.slice(t.selectionEnd ?? t.selectionStart)}`;
    if (maxLength > 0 && next.length > maxLength) { setPop(null); return; }
    const caret = pop.start + a.name.length + 2;
    onChange(next);
    setPop(null);
    requestAnimationFrame(() => { t.focus(); t.setSelectionRange(caret, caret); });
  }
  function onKeyDown(e) {
    if (!pop) return;
    const n = list.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return;
      e.preventDefault();
      setPop((p) => ({ ...p, index: (p.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n }));
    } else if ((e.key === 'Enter' || e.key === 'Tab') && n) {
      e.preventDefault(); choose(list[Math.min(pop.index, n - 1)]);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); setPop(null);
    }
  }

  // Place the list under the box (or above if there is no room).
  let style = null;
  if (pop) {
    const r = pop.rect, h = Math.min(240, 56 + list.length * 40);
    const below = r.bottom + 6 + h <= window.innerHeight || r.top - 6 - h < 0;
    style = { left: r.left, width: r.width, top: below ? r.bottom + 6 : r.top - 6 - h };
  }

  return (
    <div className="mention-field">
      <div className="mention-wrap" ref={wrap}>
        <div className="mention-mirror" ref={mirror} aria-hidden="true">{html() || value}{'\n '}</div>
        <textarea
          {...rest}
          ref={ta}
          className={className}
          value={value}
          maxLength={maxLength}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={Boolean(pop)}
          style={{ ...(rest.style || {}), backgroundColor: 'transparent' }}
          onChange={(e) => { onChange(e.target.value); requestAnimationFrame(check); }}
          onClick={check}
          onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') check(); }}
          onKeyDown={onKeyDown}
          onScroll={() => { if (mirror.current) mirror.current.scrollTop = ta.current.scrollTop; }}
          onBlur={() => setTimeout(() => setPop(null), 120)}
        />
      </div>
      {pop && createPortal(
        <div className="mention" role="listbox" style={style} onMouseDown={(e) => e.preventDefault()}>
          {!list.length ? (
            <p className="mention__empty">{assets.length ? 'No asset matches that.' : 'No assets added yet. Use From Brand Assets or Upload first.'}</p>
          ) : list.map((a, i) => (
            <button key={a.name} type="button" role="option" aria-selected={i === pop.index} className={`mention__item ${i === pop.index ? 'is-on' : ''}`.trim()} onClick={() => choose(a)}>
              <span className="mention__thumb">{a.src ? <img src={a.src} alt="" /> : (a.name || '?').charAt(0).toUpperCase()}</span>
              <span className="mention__name">{a.name}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
