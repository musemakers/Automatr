import React from 'react';
import Lottie from 'lottie-react';
import loadingAnimation from '../assets/loading.json';

/**
 * Themed loading indicator (three pulsing dots in the app's brand blue).
 * Drop-in replacement for the old plain-text "Loading…" empty states.
 */
export default function LoadingSpinner({ label = 'Loading…', size = 72, inline = false }) {
  return (
    <div
      className="loading-spinner"
      style={
        inline
          ? { display: 'inline-flex', alignItems: 'center', gap: 8 }
          : { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '28px 0', gap: 4 }
      }
    >
      <Lottie animationData={loadingAnimation} loop style={{ width: size, height: size * (2 / 3) }} />
      {label ? <span className="hint" style={{ margin: 0 }}>{label}</span> : null}
    </div>
  );
}
