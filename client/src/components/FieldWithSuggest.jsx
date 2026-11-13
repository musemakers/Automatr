import React from 'react';
import SuggestLink from './SuggestLink.jsx';
import { AiErrorNotice, CostTag } from './ui.jsx';
import '../styles/new-creative.css';

/** A form field whose label row carries the shared "Suggest" AI link on the right. */
export default function FieldWithSuggest({ label, hint, onSuggest, loading, improve = false, error, rationale, cost, children, className = '' }) {
  return (
    <div className={`field ${className}`.trim()}>
      <div className="nc-field-head">
        <label>{label}</label>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {cost}
          <SuggestLink onClick={onSuggest} loading={loading} improve={improve} />
        </span>
      </div>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
      <AiErrorNotice error={error} />
      {rationale && !error && <p className="hint" style={{ color: 'var(--blue-dark)' }}>{rationale}</p>}
    </div>
  );
}
