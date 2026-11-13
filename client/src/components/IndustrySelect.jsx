import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Searchable industry-segment picker. Click it, type to filter (matches the segment
 * name or its group), then tap a result. Works with grouped lists ({ group, items })
 * or a flat list of names.
 */
export default function IndustrySelect({ value, onChange, groups = [], items = [], placeholder = 'Search industry segments…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  const allGroups = useMemo(
    () => (groups.length ? groups : [{ group: 'All industries', items }]),
    [groups, items]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allGroups;
    return allGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.toLowerCase().includes(q) || String(g.group).toLowerCase().includes(q))
      }))
      .filter((g) => g.items.length);
  }, [allGroups, query]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (name) => { onChange(name); setOpen(false); setQuery(''); };
  const firstMatch = filtered[0]?.items?.[0];

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        value={open ? query : value || ''}
        placeholder={open ? placeholder : value ? '' : 'Select industry segment'}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (firstMatch) pick(firstMatch); }
          if (e.key === 'Escape') { setOpen(false); setQuery(''); }
        }}
      />
      {open && (
        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 50,
            maxHeight: 260, overflowY: 'auto', background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #d9d9e0)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6
          }}
        >
          {filtered.length === 0 && <div style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 14 }}>No matching segment</div>}
          {filtered.map((g) => (
            <div key={g.group}>
              {allGroups.length > 1 && (
                <div style={{ padding: '8px 10px 4px', fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--muted)' }}>{g.group}</div>
              )}
              {g.items.map((i) => (
                <div
                  key={i}
                  onMouseDown={(e) => { e.preventDefault(); pick(i); }}
                  style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: i === value ? 600 : 400, background: i === value ? 'rgba(0,0,0,0.05)' : 'transparent' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = i === value ? 'rgba(0,0,0,0.05)' : 'transparent'; }}
                >
                  {i}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
