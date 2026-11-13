import React from 'react';

/** The one AI link used across the app: the word "Suggest" with the AI icon, or "Improve" once the box already has text. */
export function AiIcon({ size = 14 }) {
  return (
    <svg className="ai-link__ico" viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}

/** The "Undo" link that sits on the same line as Suggest / Improve, at the right. Shown only after a suggestion has been applied. */
export function UndoLink({ onClick, label = 'Undo' }) {
  return (
    <button
      type="button"
      className="ai-link ai-link--undo"
      onClick={onClick}
      aria-label={label}
      style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, background: 'none', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink-3, #6B7186)' }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></svg>
      <span>Undo</span>
    </button>
  );
}

/**
 * Remembers what a field held before a suggestion was applied, so the person can put it back.
 *   const undo = useSuggestUndo();
 *   undo.remember(() => setText(previous));   // call just before applying a suggestion
 *   undo.can / undo.run()                      // drive the Undo link
 */
export function useSuggestUndo() {
  const [restore, setRestore] = React.useState(null);
  return {
    can: Boolean(restore),
    remember: (fn) => setRestore(() => fn),
    run: () => { if (restore) restore(); setRestore(null); },
    clear: () => setRestore(null)
  };
}

/** A row with the Suggest / Improve link on the left and Undo on the right of the same line. */
export function SuggestRow({ children, canUndo = false, onUndo, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', ...style }}>
      {children}
      {canUndo && onUndo ? <UndoLink onClick={onUndo} /> : null}
    </div>
  );
}

export default function SuggestLink({ onClick, loading = false, disabled = false, label, improve = false, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`ai-link ${className}`.trim()}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={improve ? (label ? label.replace(/^Suggest/, 'Improve') : 'Improve') : (label || 'Suggest')}
      {...rest}
    >
      <AiIcon />
      <span>{improve ? 'Improve' : 'Suggest'}</span>
    </button>
  );
}
