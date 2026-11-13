import React from 'react';
import Lottie from 'lottie-react';
import analyzingAnimation from '../assets/analyzing.json';

/**
 * Themed "scanning" indicator for the Creative Adaptation template-analysis
 * step (see stageTemplateFile/analyzingTemplate in GenerateMedia.jsx) - a
 * magnifying glass with a rotating scan sweep and radar-style pulse rings,
 * in the app's brand blue. Replaces the old plain-text "🔎 Analyzing your
 * creative..." hint, which was easy to miss since analysis can take a few
 * seconds and nothing else on the page moved during that wait.
 */
export default function AnalyzingIndicator({ label = 'Analyzing your creative…', size = 84 }) {
  return (
    <div className="loading-spinner" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <Lottie animationData={analyzingAnimation} loop style={{ width: size, height: size, flex: 'none' }} />
      {label ? <span className="hint" style={{ margin: 0 }}>{label}</span> : null}
    </div>
  );
}
