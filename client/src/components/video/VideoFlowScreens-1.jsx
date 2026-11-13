import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlowStepBar } from '../flow/FlowParts.jsx';
import { AiErrorNotice } from '../ui.jsx';
import VideoMotion from './VideoMotion.jsx';
import VideoSize from './VideoSize.jsx';
import VideoDone from './VideoDone.jsx';
import { scrollStepToTop } from '../Layout.jsx';
import { useWorkflow } from '../../context/WorkflowContext.jsx';
import { useLightbox } from '../../context/LightboxContext.jsx';
import { postsApi } from '../../api/resources.js';
import { apiErrorInfo, resolveAssetUrl, downloadFile } from '../../api/client.js';
import { measureImage, outputSize, pad2, sizeText, validSize, VIDEO_ERROR } from './videoUtils.js';
import '../../styles/video-flow.css';

/**
 * The three video screens shared by New Creative (after "Download image") and Convert to Video (after "Upload"):
 * Motion -> Video size -> Download video. Mount it ONCE and change `step`; the picks (motion ideas, size, the running
 * video job) live inside it, so Back and forward keep them. Both flows use this, so a change is made once.
 *
 *   <VideoFlowScreens
 *     postId={post._id}                  // post that holds the creative (needs a design with imageUrl)
 *     label="Preview"                    // design label; defaults to post.selectedVariantLabel / first design
 *     imageUrl="/uploads/x.png"          // the creative to animate (server path or absolute URL)
 *     originalDims={{ w: 1080, h: 1350 }} // optional; measured from the image when missing
 *     defaultSize={{ platform, formatId, w, h, label }} // optional; size pre-selected on the Video size screen (default: keep original)
 *     step="motion" | "size" | "done"    // controlled by the parent
 *     onStep={(step) => ...}             // the screens ask the parent to move (Continue, Generate video, Back links)
 *     stepBarProps={{                    // the shared step bar (FlowStepBar) for the whole flow
 *       icon, name,                      //   flow icon + name shown on the left
 *       steps: [['01','Upload'], ['02','Motion'], ['03','Video size'], ['04','Download video']],
 *       offset: 1,                       //   index in `steps` of the Motion step (Size = offset+1, Done = offset+2)
 *       reachableBefore: [true],         //   which earlier steps can be clicked (default: none)
 *       onStepBefore: (index) => ...     //   called when an earlier step is clicked
 *     }}
 *     extras={<NextStepCards ... />}     // optional node shown under the Download button on the last screen
 *   />
 *
 * Uses the real backend: video-ideas for the AI Suggestion, then generateVideo + polling. The chosen size is sent as
 * `videoSize` ({ w, h }); the server asks the model for the nearest supported shape and crops the clip to the exact size.
 */
export default function VideoFlowScreens({ postId, label, imageUrl, originalDims, defaultSize, step, onStep, stepBarProps, extras }) {
  const { post, setPost } = useWorkflow();
  const { open: openLightbox } = useLightbox();
  const designLabel = label || post?.selectedVariantLabel || post?.designs?.[0]?.label || 'Preview';
  const fullUrl = imageUrl ? resolveAssetUrl(imageUrl) : '';

  /* ---- image size ---- */
  const [measured, setMeasured] = useState(null);
  useEffect(() => {
    let live = true;
    setMeasured(null);
    if (fullUrl && !originalDims) measureImage(fullUrl).then((m) => live && setMeasured(m));
    return () => { live = false; };
  }, [fullUrl, originalDims?.w, originalDims?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const origDims = originalDims?.w ? { w: originalDims.w, h: originalDims.h } : measured;

  /* ---- motion ideas (real "video-ideas" call) ---- */
  const [ideas, setIdeas] = useState([]);
  const [categories, setCategories] = useState([]);
  const [bestCombo, setBestCombo] = useState({ ids: [], rationale: '' });
  const [selected, setSelected] = useState(() => new Set());
  const [ideasStatus, setIdeasStatus] = useState('idle'); // idle | loading | ready | error
  const [ideasKey, setIdeasKey] = useState('');
  const [tab, setTab] = useState('basic');
  const [note, setNote] = useState('');
  const currentKey = `${postId}|${designLabel}|${imageUrl}`;

  const loadIdeas = useCallback(async () => {
    if (!postId || !imageUrl) return;
    const key = `${postId}|${designLabel}|${imageUrl}`;
    setIdeasStatus('loading');
    try {
      const res = await postsApi.suggestVideoIdeas(postId, designLabel, {});
      setIdeas(res.ideas || []);
      setCategories(res.categories || []);
      setBestCombo(res.bestCombination || { ids: [], rationale: '' });
      setSelected(new Set());
      setIdeasKey(key);
      setTab('basic');
      setIdeasStatus('ready');
    } catch {
      setIdeasStatus('error');
    }
  }, [postId, designLabel, imageUrl]);

  // Load once when the Motion screen opens for a creative; a different creative starts afresh.
  useEffect(() => {
    if (step !== 'motion' || !postId || !imageUrl) return;
    if (ideasKey !== currentKey && ideasStatus !== 'loading') loadIdeas();
  }, [step, currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleIdea(idea) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idea.id)) { next.delete(idea.id); return next; }
      if (idea.category === 'camera') ideas.filter((i) => i.category === 'camera').forEach((i) => next.delete(i.id)); // one camera move per video
      next.add(idea.id);
      return next;
    });
  }
  function useBest() { setSelected(new Set(bestCombo.ids)); }

  const pickedIdeas = ideas.filter((i) => selected.has(i.id));
  const motionTitles = pickedIdeas.map((i) => i.title);

  /* ---- video size ---- */
  const [size, setSize] = useState(defaultSize || null); // what the size picker last reported; null = keep original size. defaultSize pre-selects a size.
  const keepOriginal = !size || size.formatId === 'original' || size.platform === 'original';
  // null while a Custom size is still incomplete / out of range
  const effective = keepOriginal ? origDims : validSize(size) ? { w: size.w, h: size.h } : null;
  const sizeLabel = !effective ? '' : keepOriginal ? `original size (${sizeText(effective)})` : `${[size.platform, size.label].filter(Boolean).join(' / ')} (${sizeText(effective)})`;

  /* ---- the video job ---- */
  const [run, setRun] = useState({ status: 'idle', job: null, error: '' });
  const [apiError, setApiError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => { scrollStepToTop(); }, [step]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);

  const poll = useCallback((jobId) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { post: updated, job } = await postsApi.getVideoStatus(postId, designLabel, jobId);
        if (!alive.current) return;
        if (updated) setPost(updated);
        if (job.status === 'processing' || job.status === 'pending') poll(jobId);
        else if (job.status === 'completed' && job.videoUrl) setRun({ status: 'done', job, error: '' });
        else setRun({ status: 'failed', job, error: VIDEO_ERROR });
      } catch {
        if (alive.current) setRun((r) => ({ ...r, status: 'failed', error: VIDEO_ERROR }));
      }
    }, 6000);
  }, [postId, designLabel, setPost]);

  const startRun = useCallback(async () => {
    clearTimeout(timer.current);
    setApiError(null);
    setRun({ status: 'starting', job: null, error: '' });
    try {
      const body = {
        mode: 'animate_kv',
        motionStyle: 'ambient',
        selectedIdeas: pickedIdeas.map((i) => ({ category: i.category, title: i.title, videoPrompt: i.videoPrompt })),
        customDirection: note.trim(),
        carryFeedback: false,
        ...(effective && validSize(effective) ? { videoSize: { w: effective.w, h: effective.h } } : {})
      };
      const { post: updated, job } = await postsApi.generateVideo(postId, designLabel, body);
      if (!alive.current) return;
      if (updated) setPost(updated);
      setRun({ status: 'running', job, error: '' });
      poll(job.externalJobId);
    } catch (err) {
      if (!alive.current) return;
      const info = apiErrorInfo(err);
      setApiError(info.isBillingError ? info : null);
      setRun({ status: 'failed', job: null, error: info.isBillingError ? '' : VIDEO_ERROR });
    }
  }, [postId, designLabel, pickedIdeas, note, effective, poll, setPost]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different creative invalidates the finished video.
  useEffect(() => {
    clearTimeout(timer.current);
    setRun({ status: 'idle', job: null, error: '' });
  }, [currentKey]);

  function generate() {
    startRun();
    onStep('done');
  }

  async function download() {
    if (!run.job?.videoUrl) return;
    setDownloading(true);
    try { await downloadFile(resolveAssetUrl(run.job.videoUrl), `automatr-video-${effective ? `${outputSize(effective).w}x${outputSize(effective).h}` : 'clip'}.mp4`); }
    catch { setRun((r) => ({ ...r, error: VIDEO_ERROR, status: 'failed' })); }
    finally { setDownloading(false); }
  }
  function preview() {
    if (!run.job?.videoUrl) return;
    openLightbox({
      video: run.job.videoUrl,
      src: imageUrl,
      title: sizeLabel ? `Your video · ${sizeLabel}` : 'Your video',
      downloadName: `automatr-video-${effective ? `${outputSize(effective).w}x${outputSize(effective).h}` : 'clip'}.mp4`
    });
  }

  /* ---- step bar ---- */
  const sb = stepBarProps || { icon: '', name: 'Video', steps: [['01', 'Motion'], ['02', 'Video size'], ['03', 'Download video']], offset: 0 };
  const offset = sb.offset || 0;
  const keys = ['motion', 'size', 'done'];
  const active = offset + keys.indexOf(step);
  const reachable = useMemo(() => sb.steps.map((_, i) => {
    if (i < offset) return Boolean(sb.reachableBefore?.[i]);
    if (i === offset || i === offset + 1) return true;
    return run.status !== 'idle';
  }), [sb.steps, offset, sb.reachableBefore, run.status]);
  const kickerFor = (i) => `${pad2(offset + i + 1)} / ${sb.steps[offset + i]?.[1] || ''}`;

  function onStepClick(i) {
    if (i < offset) sb.onStepBefore?.(i);
    else onStep(keys[i - offset]);
  }

  const notice = <AiErrorNotice error={apiError} />;

  return (
    <>
      <FlowStepBar icon={sb.icon} name={sb.name} steps={sb.steps} step={active} reachable={reachable} onStep={onStepClick} />
      {step === 'motion' && (
        <VideoMotion
          notice={notice} kicker={kickerFor(0)} imageUrl={fullUrl}
          ideas={ideas} categories={categories} bestCombo={bestCombo} selected={selected}
          onToggle={toggleIdea} onUseBest={useBest}
          status={ideasStatus} onRetryIdeas={loadIdeas}
          tab={tab} onTab={setTab} note={note} onNote={setNote}
          onContinue={() => onStep('size')}
        />
      )}
      {step === 'size' && (
        <VideoSize
          notice={notice} kicker={kickerFor(1)} imageUrl={fullUrl} originalDims={origDims}
          size={size} onSize={setSize} effective={effective}
          busy={run.status === 'starting'} onGenerate={generate}
        />
      )}
      {step === 'done' && (
        <VideoDone
          notice={notice} kicker={kickerFor(2)} run={run} dims={outputSize(effective)}
          downloading={downloading} onDownload={download} onPreview={preview}
          onRetry={startRun} extras={extras}
        />
      )}
    </>
  );
}
