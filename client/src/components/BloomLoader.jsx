import React from 'react';

/**
 * The generating state for every creative that is being made: soft colour drifts and mixes, a sparkle pulses at the
 * centre and a gentle sheen passes over. Drop it inside any positioned box (it fills it), or use `inline` for a
 * block that sizes itself. `bare` = only the icon and rings, no coloured box behind. `label` is the short status line under the sparkle (optional).
 */
export default function BloomLoader({ label = '', inline = false, bare = false, className = '' }) {
  if (bare) {
    // Just the sparkle icon and the pulsing rings, centred, with nothing behind them (used on the dotted upload preview).
    return (
      <div className={`bloom bloom--bare ${className}`.trim()} role="status" aria-live="polite" aria-label={label || 'Loading'}>
        <div className="bloom__core" aria-hidden="true">
          <i><svg viewBox="0 0 24 24" fill="#2e5eff"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg></i>
        </div>
      </div>
    );
  }
  return (
    <div className={`bloom ${inline ? 'bloom--inline' : ''} ${className}`.trim()} role="status" aria-live="polite" aria-label={label || 'Generating'}>
      <div className="bloom__bg" />
      <div className="bloom__blob bloom__blob--1" />
      <div className="bloom__blob bloom__blob--2" />
      <div className="bloom__blob bloom__blob--3" />
      <div className="bloom__blob bloom__blob--4" />
      <div className="bloom__grain" />
      <div className="bloom__sheen" />
      <div className="bloom__core" aria-hidden="true">
        <i><svg viewBox="0 0 24 24" fill="#2e5eff"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg></i>
      </div>
      {label ? <p className="bloom__label">{label}</p> : null}
    </div>
  );
}
