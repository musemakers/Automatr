import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { newFlowProp } from '../utils/newFlow.js';
import { useLeaveGuard } from '../components/LeaveGuard.jsx';
import { Card, CardHead, Btn, AiErrorNotice, ModelPill, CostTag, CaptionOverlay } from '../components/ui.jsx';
import RegionAnnotator from '../components/RegionAnnotator.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi, aiApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl } from '../api/client.js';
import { previewCanvasClass, previewAspectRatio } from '../utils/mediumAspect.js';

export default function ModifyPost() {
  const navigate = useNavigate();
  const { post, setPost } = useWorkflow();
  useLeaveGuard(Boolean(post?._id));
  const { open: openLightbox } = useLightbox();
  const [error, setError] = useState('');

  const [section, setSection] = useState('image'); // image | copy - Image is the default
  const [imageTab, setImageTab] = useState('prompt'); // prompt | region
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageLoading, setImageLoading] = useState(false);

  const [regionInstruction, setRegionInstruction] = useState('');
  const [regionLoading, setRegionLoading] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);
  const [brushSize, setBrushSize] = useState(36);
  const annotatorRef = useRef(null);

  const [copyTab, setCopyTab] = useState('prompt'); // prompt | sharpen
  const [copyInstruction, setCopyInstruction] = useState('');
  const [copyLoading, setCopyLoading] = useState(false);

  const [costs, setCosts] = useState(null); // GET /ai/cost-estimates - see CostTag usages below
  useEffect(() => {
    aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null));
  }, []);

  useEffect(() => {
    if (!post) navigate('/generate');
  }, [post, navigate]);

  if (!post) return null;

  const selected = post.designs.find((d) => d.label === post.selectedVariantLabel) || post.designs[0];
  const isAnnotating = section === 'image' && imageTab === 'region' && Boolean(selected?.imageUrl);

  async function handleImagePrompt() {
    if (!imagePrompt.trim()) return;
    setImageLoading(true);
    setError('');
    try {
      const { post: updated } = await postsApi.modifyImageWithPrompt(post._id, imagePrompt, 'auto');
      setPost(updated);
      setImagePrompt('');
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setImageLoading(false);
    }
  }

  async function handleApplyRegionFix() {
    const maskDataUrl = annotatorRef.current?.exportMask();
    if (!maskDataUrl) {
      setError('Brush over the part of the image that needs fixing first.');
      return;
    }
    if (!regionInstruction.trim()) {
      setError('Describe what should change in the marked area.');
      return;
    }
    setRegionLoading(true);
    setError('');
    try {
      const { post: updated } = await postsApi.modifyImageWithRegion(post._id, { maskDataUrl, instruction: regionInstruction });
      setPost(updated);
      setRegionInstruction('');
      annotatorRef.current?.clear();
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setRegionLoading(false);
    }
  }

  async function handleUndoRegionFix() {
    setUndoLoading(true);
    setError('');
    try {
      const { post: updated } = await postsApi.undoImageEdit(post._id);
      setPost(updated);
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setUndoLoading(false);
    }
  }

  async function handleApplyCopy() {
    setCopyLoading(true);
    setError('');
    try {
      const payload = copyTab === 'sharpen' ? { method: 'sharpen' } : { method: 'prompt', instruction: copyInstruction };
      const { post: updated } = await postsApi.modifyCopy(post._id, payload);
      setPost(updated);
      setCopyInstruction('');
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setCopyLoading(false);
    }
  }

  return (
    <Layout eyebrow="Step 04" title="Modify Asset" step="modify" flow={newFlowProp(post)}>
      <div className="page-lede"><p>Adjust the image and the copy independently, then save your changes.</p></div>

      <AiErrorNotice error={error} />

      <div className="grid-2">
        <div>
          <div className="tab-row" style={{ marginBottom: 16 }}>
            <div className={`tab ${section === 'image' ? 'active' : ''}`} onClick={() => setSection('image')}>Image</div>
            <div className={`tab ${section === 'copy' ? 'active' : ''}`} onClick={() => setSection('copy')}>Copy</div>
          </div>

          {section === 'image' && (
          <Card>
            <CardHead title="Refine / replace image" />
            <div className="tab-row">
              <div className={`tab ${imageTab === 'prompt' ? 'active' : ''}`} onClick={() => setImageTab('prompt')}>With prompt</div>
              <div className={`tab ${imageTab === 'region' ? 'active' : ''}`} onClick={() => setImageTab('region')}>Fix an area</div>
            </div>

            {imageTab === 'prompt' && (
              <>
                <textarea
                  className="textarea-full"
                  placeholder="e.g. Change the background to a modern office"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                />
                <p className="hint" style={{ marginTop: 6 }}>
                  Your change is applied to the current image - everything you don&apos;t mention (subject, product, text, layout) is kept as it is. Describe only what should change.
                </p>
                <div className="btn-row" style={{ marginBottom: 0 }}>
                  <Btn variant="secondary" block loading={imageLoading} onClick={handleImagePrompt}>Apply change</Btn>
                </div>
                {costs && (
                  <p className="hint" style={{ marginTop: 6, textAlign: 'right' }}>
                    <CostTag estimate={costs.imageHigh} />
                  </p>
                )}
              </>
            )}

            {imageTab === 'region' && (
              <>
                {selected?.imageUrl ? (
                  <>
                    <p className="hint" style={{ marginBottom: 10 }}>
                      Brush over the part of the preview on the right that needs fixing, then describe the change below.
                    </p>
                    <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      Brush size
                      <input
                        type="range"
                        min={10}
                        max={90}
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        style={{ flex: 1 }}
                        disabled={regionLoading}
                      />
                      <button type="button" className="link-btn" onClick={() => annotatorRef.current?.clear()} disabled={regionLoading}>
                        Clear marks
                      </button>
                    </label>
                  </>
                ) : (
                  <p className="hint">Generate an image first, then come back here to fix a specific part of it.</p>
                )}
                <div className="field" style={{ marginTop: 4 }}>
                  <label>What should change in the marked area?</label>
                  <textarea
                    placeholder="e.g. Remove the extra hand, straighten the crooked sign, fix the smudged logo"
                    value={regionInstruction}
                    onChange={(e) => setRegionInstruction(e.target.value)}
                    disabled={!selected?.imageUrl}
                  />
                </div>
                <div className="btn-row" style={{ marginBottom: 0 }}>
                  <Btn variant="secondary" block loading={regionLoading} disabled={!selected?.imageUrl} onClick={handleApplyRegionFix}>
                    Apply fix
                  </Btn>
                </div>
                {selected?.previousImageUrl && (
                  <div className="btn-row" style={{ marginTop: 8, marginBottom: 0 }}>
                    <Btn variant="ghost" block loading={undoLoading} onClick={handleUndoRegionFix}>↺ Undo last fix</Btn>
                  </div>
                )}
                {costs && (
                  <p className="hint" style={{ marginTop: 6, textAlign: 'right' }}>
                    <CostTag estimate={costs.imageHigh} />
                  </p>
                )}
              </>
            )}

            {selected?.imageModel === 'placeholder' && selected?.imageNote && (
              <div className="ai-error-notice" style={{ marginTop: 10 }}>
                <p className="error-text">{selected.imageNote}</p>
                {selected.imageBillingUrl && (
                  <a href={selected.imageBillingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary ai-error-notice__cta">
                    Add AI credits ↗
                  </a>
                )}
              </div>
            )}
          </Card>
          )}

          {section === 'copy' && (
          <Card>
            <CardHead title="Refine / replace copy" />
            <div className="tab-row">
              <div className={`tab ${copyTab === 'prompt' ? 'active' : ''}`} onClick={() => setCopyTab('prompt')}>With prompt</div>
              <div className={`tab ${copyTab === 'sharpen' ? 'active' : ''}`} onClick={() => setCopyTab('sharpen')}>Sharpen same copy</div>
            </div>

            {copyTab === 'prompt' && (
              <div className="field">
                <label>Tell AUTOMATr what to change</label>
                <textarea
                  placeholder="e.g. Make it punchier and mention free shipping"
                  value={copyInstruction}
                  onChange={(e) => setCopyInstruction(e.target.value)}
                />
              </div>
            )}
            {copyTab === 'sharpen' && (
              <p className="hint" style={{ marginBottom: 14 }}>
                Keeps the same message, just tightens the wording.
              </p>
            )}

            <Btn variant="secondary" block loading={copyLoading} onClick={handleApplyCopy}>Apply to caption</Btn>
            {costs && (
              <p className="hint" style={{ marginTop: 6, textAlign: 'right' }}>
                <CostTag estimate={costs.caption} />
              </p>
            )}
          </Card>
          )}
        </div>

        <div>
          <Card>
            <CardHead title="Preview" tag={selected?.label} />
            <div className="preview-frame">
              <div
                className={previewCanvasClass(post.mediums?.[0])}
                style={
                  selected?.imageUrl
                    ? { cursor: isAnnotating ? 'default' : 'zoom-in', aspectRatio: previewAspectRatio(post.mediums?.[0]) }
                    : { background: selected?.background, aspectRatio: previewAspectRatio(post.mediums?.[0]) }
                }
                onClick={() =>
                  !isAnnotating &&
                  selected?.imageUrl &&
                  openLightbox({
                    src: selected.imageUrl,
                    formatId: post.mediums?.[0],
                    title: selected?.caption,
                    meta: [
                      { label: 'Variant', value: selected?.label || '' },
                      
                    ]
                  })
                }
              >
                {selected?.imageUrl && <img className="cap-img" src={resolveAssetUrl(selected.imageUrl)} alt="" />}
                {!isAnnotating && <CaptionOverlay caption={selected?.caption} />}
                {isAnnotating && <RegionAnnotator ref={annotatorRef} brushSize={brushSize} disabled={regionLoading} />}
              </div>
            </div>
            {isAnnotating && <p className="hint" style={{ marginTop: 8 }}>Fine-tune mode - brush directly on the image above.</p>}
            {selected?.textModel && (
              <div className="model-row">
                <ModelPill>copy: AI model</ModelPill>
                {selected.imageModel && <ModelPill>image: AI model</ModelPill>}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="btn-row">
        <Btn variant="secondary" onClick={() => navigate(['headline', 'hero', 'resize'].includes(post.creativeType) ? '/generate' : '/designs')}>{post.creativeType === 'headline' ? '← Back to headline' : post.creativeType === 'hero' ? '← Back to hero image' : post.creativeType === 'resize' ? '← Back to sizes' : '← Back to options'}</Btn>
        <Btn variant="primary" onClick={() => navigate(['headline', 'hero', 'resize'].includes(post.creativeType) ? '/publish' : '/designs')}>{['headline', 'hero', 'resize'].includes(post.creativeType) ? 'Continue to Publish →' : 'Save changes →'}</Btn>
      </div>
    </Layout>
  );
}
