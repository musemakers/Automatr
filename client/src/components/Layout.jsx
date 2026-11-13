import React, { createContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import Stepper from './Stepper.jsx';
import BottomNav from './BottomNav.jsx';
import { LeaveGuardHost } from './LeaveGuard.jsx';
import StorageFullHost from './StorageFullHost.jsx';
import iconSparkle from '../assets/generate-home/sparkle.svg';
import iconAdapt from '../assets/generate-home/creative-adapt.svg';
import iconText from '../assets/generate-home/text-select.svg';
import iconSwap from '../assets/generate-home/replace.webp';
import iconResize from '../assets/generate-home/resize.svg';
import iconConvert from '../assets/generate-home/icon-convert-video.svg';
import { useWorkflow } from '../context/WorkflowContext.jsx';

const TOOLS = {
  new: { icon: iconSparkle, name: 'New Creative' },
  adaptation: { icon: iconAdapt, name: 'Creative Edit' },
  headline: { icon: iconText, name: 'Headline Switch' },
  hero: { icon: iconSwap, name: 'Subject Swap' },
  resize: { icon: iconResize, name: 'Size Adapt' },
  convert: { icon: iconConvert, name: 'Convert to Video' }
};

// Any <FlowStepBar/> rendered inside a Layout (even deep in a child component) is placed into this slot, at the
// top of the page, so the tool name, steps and search / notification buttons always sit together in one bar.
export const FlowBarContext = createContext(null);

// `flowBar` (a <FlowStepBar/>) or `step` (the shared Stepper) replace the plain title bar: like the reference design,
// the tool name, the steps and the search / notification buttons live together in one bar across the top.
export function scrollStepToTop() {
  try {
    window.scrollTo(0, 0);
    document.querySelectorAll('.main, .rail__panel, .rail__stage--scroll, .page').forEach((el) => { el.scrollTop = 0; });
  } catch { /* no DOM */ }
}

export default function Layout({ eyebrow, title, step, flow, onStep, reachable, flowBar, rail, pageClass, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [slot, setSlot] = useState(null);
  const [barOn, setBarOn] = useState(false);
  const location = useLocation();
  const { post } = useWorkflow();
  // The page states which tool it belongs to (flow="new" is New Creative). Only fall back to the saved post's type when it does not,
  // so a leftover Creative Edit post can never rename the New Creative screens.
  const toolKey = flow || post?.creativeType;
  const tool = TOOLS[toolKey] || TOOLS.new;
  // Like the reference design, the standalone title bar (with search / notifications) is only for ordinary pages. Inside a tool
  // those buttons live in the flow's own step bar, so a flow screen that has no bar yet (loading, redirecting) shows nothing there.
  const inFlow = Boolean(rail) || ['/designs', '/refine', '/modify', '/publish', '/video'].includes(location.pathname);
  const gmFonts = ['/generate', '/designs', '/refine', '/modify', '/publish'].includes(location.pathname);

  // Every new step (or page) opens scrolled to the top.
  useEffect(() => {
    scrollStepToTop();
  }, [step, location.pathname, location.key]);

  // Close the drawer automatically on navigation (mobile).
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className={`app ${gmFonts ? 'gm-fonts' : ''} ${rail ? 'rail-page' : ''} ${pageClass || ''}`.replace(/\s+/g, ' ').trim()} style={{ display: 'flex' }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`.trim()}
        onClick={() => setSidebarOpen(false)}
      />
      <main className="main">
        <FlowBarContext.Provider value={{ slot, register: setBarOn, openMenu: () => setSidebarOpen(true) }}>
          <div ref={setSlot} style={{ display: 'contents' }} />
          {flowBar ? flowBar : null}
          {flowBar || step || barOn || inFlow ? null : <Topbar eyebrow={eyebrow} title={title} onMenuClick={() => setSidebarOpen(true)} />}
        </FlowBarContext.Provider>
        {step ? <Stepper current={step} flow={flow} tool={tool} onMenuClick={() => setSidebarOpen(true)} post={flow && flow !== 'new' ? { ...post, creativeType: flow } : post} onStep={onStep} reachable={reachable} /> : null}
        <section className={`page active${rail ? ' page--rail' : ''}`}>{children}</section>
      </main>
      <BottomNav />
      <LeaveGuardHost />
      <StorageFullHost />
    </div>
  );
}
