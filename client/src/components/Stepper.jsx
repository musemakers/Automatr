import React from 'react';
import { useNavigate } from 'react-router-dom';
import BarActions from './flow/BarActions.jsx';

const STEPS = [
  { key: 'generate', num: '01', label: 'Select Creative & Purpose', to: '/generate' },
  { key: 'designs', num: '02', label: 'Generate Designs', to: '/designs' },
  { key: 'refine', num: '03', label: 'Refine Options', to: '/refine' },
  { key: 'modify', num: '04', label: 'Modify Asset', to: '/modify' },
  { key: 'publish', num: '05', label: 'Publish', to: '/publish' }
];

// Creative Adaptation is a deliberately shorter agency workflow - one
// direction, straight from the generated design to Publish - so Refine
// (comparing many directions) and Modify (a separate touch-up step) never
// apply and would just be confusing dead ends in the step row. Renumbered
// 01/02/03 rather than shown grayed-out, since "skip two steps" reads as
// broken while "here are your three steps" reads as intentional.
const ADAPTATION_STEPS = [
  { key: 'generate', num: '01', label: 'Select Creative & Purpose', to: '/generate' },
  { key: 'designs', num: '02', label: 'Generate Designs', to: '/designs' },
  { key: 'publish', num: '03', label: 'Publish', to: '/publish' }
];

// "Edit Headline Only": upload -> edit the text -> Modify Post (touch-ups,
// caption) -> Publish. No copy directions to explore or compare.
const HEADLINE_STEPS = [
  { key: 'generate', num: '01', label: 'Headline Switch', to: '/generate' },
  { key: 'modify', num: '02', label: 'Modify Asset', to: '/modify' },
  { key: 'publish', num: '03', label: 'Publish', to: '/publish' }
];
// "Change Hero Image Only" follows the same short path.
const HERO_STEPS = HEADLINE_STEPS.map((s) => (s.key === 'generate' ? { ...s, label: 'Subject Swap' } : s));

// "Quick Adapt": upload -> adapt (and download) -> Modify Post -> Publish.
const RESIZE_STEPS = HEADLINE_STEPS.map((s) => (s.key === 'generate' ? { ...s, label: 'Size Adapt' } : s));

// New Creative, five steps shown from the very first screen (`flow="new"`).
// Pages that still pass the old keys are mapped onto it so nothing breaks:
//   generate -> purpose (the brief screens; Fork 5 passes 'purpose' | 'visual' | 'messaging' directly)
//   designs / refine / modify / publish -> download (image options / result)
// The video is made in Convert to Video (reached with "Convert now" on the last screen), so it is not part of this bar.
// Pages pass `onStep(key)` and `reachable` (array of keys) to make steps clickable. Without them only the routed steps navigate.
const NEW_STEPS = [
  { key: 'purpose', num: '01', label: 'Purpose & brief', to: '/generate' },
  { key: 'visual', num: '02', label: 'Visual & style' },
  { key: 'directions', num: '03', label: 'Creative directions' },
  { key: 'messaging', num: '04', label: 'Messaging' },
  { key: 'download', num: '05', label: 'Download image', to: '/designs' }
];
const OLD_TO_NEW = { generate: 'purpose', designs: 'download', refine: 'download', modify: 'download', publish: 'download' };

// Whether a step is reachable *independent of where you currently are* -
// i.e. does the post already have what that step needs to render something
// real, rather than an empty/broken page. Mirrors each page's own guard
// logic (e.g. RefineOptions redirects home if there's no real design set).
function hasSelectedImage(post) {
  const selected = post?.designs?.find((d) => d.label === post.selectedVariantLabel);
  return Boolean(selected?.imageUrl || selected?.background);
}

const STEP_REQUIREMENTS = {
  generate: () => true,
  designs: (post) => Boolean(post?._id),
  refine: (post) => (post?.designs?.length || 0) > 1,
  modify: (post) => hasSelectedImage(post),
  publish: (post) => hasSelectedImage(post)
};

export default function Stepper({ current, post, flow, tool, onMenuClick, onStep, reachable: reachableKeys }) {
  const navigate = useNavigate();
  const sevenStep = flow === 'new';
  if (sevenStep) current = OLD_TO_NEW[current] || current;
  const steps = sevenStep ? NEW_STEPS : post?.creativeType === 'adaptation' ? ADAPTATION_STEPS : post?.creativeType === 'headline' ? HEADLINE_STEPS : post?.creativeType === 'hero' ? HERO_STEPS : post?.creativeType === 'resize' ? RESIZE_STEPS : STEPS;
  const curIdx = steps.findIndex((s) => s.key === current);
  if (curIdx === -1) return null;

  return (
    <div className="stepper" style={{ display: 'flex' }}>
      {tool && <div className="stepbar__tool"><img src={tool.icon} alt="" /><span>{tool.name}</span></div>}
      <div className="stepper__steps">
      {steps.map((step, idx) => {
        const isPast = idx < curIdx;
        const isCurrent = idx === curIdx;
        // Past steps are always revisitable; future steps only if this
        // post already has what that step needs (checked, not assumed).
        const reachable = sevenStep
          ? !isCurrent && (Array.isArray(reachableKeys) ? reachableKeys.includes(step.key) : Boolean(onStep || step.to) && (isPast || (idx > curIdx && Boolean(post?._id) && step.key === 'download')))
          : isPast || (idx > curIdx && STEP_REQUIREMENTS[step.key](post));
        const go = () => { if (!reachable) return; if (sevenStep && onStep) onStep(step.key); else if (step.to) navigate(step.to); };
        const cls = isCurrent ? 'step active' : isPast ? 'step done' : reachable ? 'step reachable' : 'step';

        return (
          <React.Fragment key={step.key}>
            {idx > 0 && <div className={`step__connector ${idx <= curIdx ? 'filled' : ''}`.trim()} />}
            <div
              className={cls}
              style={{ cursor: reachable ? 'pointer' : 'default' }}
              onClick={go}
              title={!reachable && !isCurrent ? 'Complete the earlier steps first' : undefined}
            >
              <div className="step__circle">{step.num}</div>
              <div className="step__label">{step.label}</div>
            </div>
          </React.Fragment>
        );
      })}
      </div>
      <BarActions onMenuClick={onMenuClick} />
    </div>
  );
}
