import React from 'react';
import PanelArt from './PanelArt.jsx';
import '../../styles/rail-flows.css';

/**
 * Building blocks for the side-panel ("rail") layout used by every flow (Automatr prototype 4):
 *
 *   <Layout rail pageClass="page-result" flowBar={...}>
 *     <Rail>                         dotted stage on the left, settings panel on the right
 *       <RailStage>...</RailStage>
 *       <RailPanel label="Settings">...text, fields, main button...</RailPanel>
 *     </Rail>
 *   </Layout>
 *
 *   Last screens use the bottom-panel version:
 *     <Rail bottom>
 *       <RailStage scroll><div className="rail__stage-inner">...results...</div></RailStage>
 *       <RailBottom label="Download options" text={...} actions={...} />
 *     </Rail>
 */
export function Rail({ bottom = false, className = '', children }) {
  return <div className={`rail${bottom ? ' rail--bottom' : ''}${className ? ` ${className}` : ''}`}>{children}</div>;
}

/** The dotted stage. `scroll` = the results screens, where the content may be taller than the stage. */
export const RailStage = React.forwardRef(function RailStage({ scroll = false, className = '', children, ...rest }, ref) {
  return <div ref={ref} className={`rail__stage${scroll ? ' rail__stage--scroll' : ''}${className ? ` ${className}` : ''}`} {...rest}>{children}</div>;
});

/** The right-hand panel: the questions / text go in `children`, the animated graphic sits underneath. */
export function RailPanel({ label, art = true, children }) {
  return (
    <aside className="rail__panel" aria-label={label}>
      <div className="sa-text">{children}</div>
      {art && <PanelArt />}
    </aside>
  );
}

/** Wrapper for results screens' stage content (centres it and keeps it scrollable). */
export function RailStageInner({ children }) {
  return <div className="rail__stage-inner">{children}</div>;
}

/** The bottom panel on the last screens: copy + main button on the left, next-step cards on the right. */
export function RailBottom({ label = 'Download options', text, actions, className = '' }) {
  return (
    <section className={`rail__bottom${className ? ` ${className}` : ''}`} aria-label={label}>
      <div className="rail__bottom-text">{text}</div>
      <div className="rail__bottom-actions">{actions}</div>
    </section>
  );
}
