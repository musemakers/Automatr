import React, { useState } from 'react';

export function Btn({
  variant = 'primary',
  block = false,
  loading = false,
  children,
  className = '',
  as: Comp = 'button',
  ...rest
}) {
  const cls = `btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`.trim();
  return (
    <Comp className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : null}
      {children}
    </Comp>
  );
}

export function Card({ children, className = '', style }) {
  return (
    <div className={`card ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function CardHead({ title, tag, action }) {
  return (
    <div className="card__head">
      <h2>{title}</h2>
      {tag ? <span className="tag">{tag}</span> : null}
      {action}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Chip({ selected, onClick, children }) {
  return (
    <span className={`chip ${selected ? 'selected' : ''}`.trim()} onClick={onClick} role="button" tabIndex={0}>
      {children}
    </span>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p className="field-error">{children}</p>;
}

/**
 * Same purpose as ErrorText, but for AI-triggering actions specifically:
 * takes the result of api/client.js#apiErrorInfo() and, when the failure
 * was an out-of-credits/quota issue, adds a direct "Add credits" link to
 * that provider's billing page right next to the message - so hitting a
 * quota wall isn't a dead end, it's one click to go fix it.
 */
export function AiErrorNotice({ error }) {
  if (!error?.message) return null;
  return (
    <div className="ai-error-notice">
      <p className="field-error">{error.message}</p>
      {error.isBillingError && error.billingUrl && (
        <a href={error.billingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary ai-error-notice__cta">
          Add AI credits ↗
        </a>
      )}
    </div>
  );
}

/** The selected-option badge: blue circle with a white tick. Same everywhere. Place inside a position:relative parent. */
export function SelBadge({ label = 'Selected', className = '' }) {
  return (
    <span className={`sel-badge ${className}`.trim()} role="img" aria-label={label}>
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
    </span>
  );
}

export function ModelPill({ children }) {
  if (!children) return null;
  return <span className="model-pill">{children}</span>;
}

/**
 * Small "~$0.03" label meant to sit right next to a button that triggers
 * an AI request, so clicking isn't blind. `estimate` is one entry from
 * GET /api/ai/cost-estimates, e.g. { usd: 0.07, model: 'gpt' } - renders
 * nothing if that estimate hasn't loaded yet, so callers don't need their
 * own loading guard.
 */
export function CostTag({ estimate }) {
  if (!estimate || typeof estimate.usd !== 'number') return null;
  const display = estimate.usd < 0.01 ? `~$${estimate.usd.toFixed(4)}` : `~$${estimate.usd.toFixed(2)}`;
  return (
    <span className="cost-tag" title="Rough estimate - actual pricing varies.">
      {display}
    </span>
  );
}

/**
 * The caption text sitting on top of a design preview image, in a
 * semi-transparent scrim so it stays readable regardless of how bright the
 * underlying image is - with a close button to dismiss it (e.g. to look at
 * the raw creative without text in the way), and a small "Show caption"
 * pill to bring it back. Purely a local display toggle - never touches the
 * actual caption data, just whether this overlay is currently drawn.
 */
export function CaptionOverlay({ caption, placeholder }) {
  const [visible, setVisible] = useState(true);
  const text = caption || placeholder;
  if (!text) return null;

  if (!visible) {
    return (
      <button
        type="button"
        className="cap-reopen"
        onClick={(e) => {
          e.stopPropagation();
          setVisible(true);
        }}
      >
        Show caption
      </button>
    );
  }

  return (
    <div className="cap-bar">
      <p className="cap">{text}</p>
      <button
        type="button"
        className="cap-bar__close"
        onClick={(e) => {
          e.stopPropagation();
          setVisible(false);
        }}
        aria-label="Hide caption overlay"
      >
        ✕
      </button>
    </div>
  );
}
