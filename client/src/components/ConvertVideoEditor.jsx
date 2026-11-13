import React, { useEffect, useRef, useState } from 'react';
import Layout from './Layout.jsx';
import BloomLoader from './BloomLoader.jsx';
import { AiErrorNotice } from './ui.jsx';
import { FlowStepBar } from './flow/FlowParts.jsx';
import { Rail, RailStage, RailPanel } from './flow/Rail.jsx';
import VideoFlowScreens from './video/VideoFlowScreens.jsx';
import { pad2 } from './video/videoUtils.js';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { postsApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl } from '../api/client.js';
import { takeHandoffFile, hasHandoff } from '../utils/handoff.js';
import '../styles/video-flow.css';

import iconConvert from '../assets/video/icon-convert-video.svg';
import iconUpload from '../assets/video/icon-upload.svg';
import iconSwap from '../assets/video/icon-swap.svg';
import iconArrowWhite from '../assets/video/icon-arrow-right-white.svg';

// Convert to Video: Upload -> Motion -> Video size -> Download video.
// The last three screens are the shared video screens (video/VideoFlowScreens.jsx), also used by New Creative.
const STEPS = [['01', 'Upload'], ['02', 'Motion'], ['03', 'Video size'], ['04', 'Download video']];
const STAGE_KEYS = ['upload', 'motion', 'size', 'done'];

export default function ConvertVideoEditor({ onBack }) {
  const { post, setPost } = useWorkflow();
  const fileInputRef = useRef(null);
  const hasServerImage = post?.creativeType === 'convert' && post.designs?.some((d) => d.imageUrl);
  // A creative handed over from another flow skips the upload screen and opens straight on Motion.
  const [stage, setStage] = useState(() => (hasHandoff('convert') ? 'motion' : 'upload'));
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [postId, setPostId] = useState(() => (post?.creativeType === 'convert' ? post._id : null)); // re-used on re-upload so no duplicates are left
  const [dims, setDims] = useState(null);

  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  const selected = post?.creativeType === 'convert' ? post.designs?.find((d) => d.label === post.selectedVariantLabel) || post.designs?.[0] : null;
  const serverUrl = selected?.imageUrl || '';
  const creativeUrl = previewUrl || (serverUrl ? resolveAssetUrl(serverUrl) : '');
  const ready = Boolean(serverUrl) && !uploading;

  async function handleFile(e, advance = false) {
    const picked = e.target.files?.[0];
    if (e.target.value !== undefined) e.target.value = '';
    if (!picked) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(picked.type)) {
      setError({ message: 'Please choose an image file (PNG, JPG or WebP).' });
      return;
    }
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
    setError(null);
    setUploading(true);
    try {
      let id = postId;
      if (!id) {
        const { post: created } = await postsApi.create({
          creativeType: 'convert', purpose: 'Convert to video', mediums: ['instagram_feed'],
          briefNote: '', selectedAssets: [], exactAssetIds: [], creativeBrief: {}
        });
        id = created._id;
        setPostId(id);
      }
      const { post: updated, meta } = await postsApi.adaptSource(id, picked);
      setPost(updated);
      setDims(meta?.width && meta?.height ? { w: meta.width, h: meta.height } : null);
      if (advance) setStage('motion'); // handed over from another flow: straight to Motion
    } catch (err) {
      setError(apiErrorInfo(err));
      setFile(null);
      setPreviewUrl('');
    } finally {
      setUploading(false);
    }
  }

  // An image handed over from another flow ("Convert now") skips the upload.
  useEffect(() => {
    takeHandoffFile('convert').then((f) => { if (f) handleFile({ target: { files: [f] } }, true); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reachable = [true, ready, ready, false];
  const stepBarProps = {
    icon: iconConvert, name: 'Convert to Video', steps: STEPS, offset: 1,
    reachableBefore: [true], onStepBefore: () => setStage('upload')
  };

  return (
    <Layout rail pageClass={stage === 'done' ? 'page-result page-video-done' : ''}>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFile} />

      {stage === 'upload' && (
        <>
          <FlowStepBar icon={iconConvert} name="Convert to Video" steps={STEPS} step={0} reachable={reachable} onStep={(i) => ready && setStage(STAGE_KEYS[i])} />
          <Rail>
            <RailStage
              id="dropzone"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('is-dragover'); }}
              onDragLeave={(e) => e.currentTarget.classList.remove('is-dragover')}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('is-dragover');
                const f = e.dataTransfer?.files?.[0];
                if (f) handleFile({ target: { files: [f] } });
              }}
            >
              <div className={`sa-preview ${creativeUrl ? 'sa-preview--filled' : 'sa-preview--empty'} ${uploading ? 'sa-preview--loading' : ''}`.trim()}>
                {creativeUrl && <img src={creativeUrl} alt="Your uploaded image" />}
                {uploading && <div className="sa-preview__busy"><BloomLoader bare label="Getting your image ready" /></div>}
                {creativeUrl && !uploading && (
                  <button type="button" className="sa-btn sa-btn--white sa-btn--sm sa-preview__action" onClick={() => fileInputRef.current?.click()}>
                    <span>Replace file</span><img className="sa-icon-swap" src={iconSwap} alt="" />
                  </button>
                )}
              </div>
            </RailStage>
            <RailPanel label="Settings">
              <AiErrorNotice error={error} />
              <p className="sa-kicker">{pad2(1)} / Upload</p>
              <h2 className="sa-heading">Convert an image to video</h2>
              <p>Upload the image you want to bring to life.</p>
              <p>Next you’ll choose how it moves and what size the video should be, then download it.</p>
              {!creativeUrl && (
                <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={() => fileInputRef.current?.click()}><span>Upload image</span><img src={iconUpload} alt="" /></button>
              )}
              {creativeUrl && (
                <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!ready} onClick={() => setStage('motion')}><span>Continue</span><img src={iconArrowWhite} alt="" /></button>
              )}
            </RailPanel>
          </Rail>
        </>
      )}

      {stage !== 'upload' && (
        <VideoFlowScreens
          postId={postId || post?._id}
          label={selected?.label}
          imageUrl={serverUrl}
          previewUrl={previewUrl}
          originalDims={dims}
          step={stage}
          onStep={setStage}
          stepBarProps={stepBarProps}
        />
      )}
    </Layout>
  );
}
