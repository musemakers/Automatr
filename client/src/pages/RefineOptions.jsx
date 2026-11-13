import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { newFlowProp } from '../utils/newFlow.js';
import { useLeaveGuard } from '../components/LeaveGuard.jsx';
import { Card, CardHead, Btn, AiErrorNotice, CostTag, CaptionOverlay } from '../components/ui.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi, aiApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl } from '../api/client.js';
import { previewCanvasClass, previewAspectRatio } from '../utils/mediumAspect.js';
import { getFormat } from '../constants/postFormats.js';

const ORIENTATION_PIXELS = { portrait: '1024 × 1536', landscape: '1536 × 1024', square: '1024 × 1024' };

export default function RefineOptions() {
  const navigate = useNavigate();
  const { post, setPost } = useWorkflow();
  useLeaveGuard(Boolean(post?._id));
  const { open: openLightbox } = useLightbox();
  const [error, setError] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  const [costs, setCosts] = useState(null); // GET /ai/cost-estimates
  useEffect(() => {
    aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null));
  }, []);

  useEffect(() => {
    if (!post) navigate('/generate');
  }, [post, navigate]);

  if (!post) return null;

  const selected = post.designs.find((d) => d.label === post.selectedVariantLabel) || post.designs[0];
  const others = post.designs.filter((d) => d.label !== 'Preview');

  async function selectThumb(label) {
    try {
      const { post: updated } = await postsApi.selectVariant(post._id, label);
      setPost(updated);
    } catch (e) {
      setError(apiErrorInfo(e));
    }
  }

  async function regenerate() {
    setRegenerating(true);
    setError('');
    try {
      const { post: updated } = await postsApi.regenerateVariant(post._id, selected.label, { textModel: 'auto', imageModel: 'auto', withImages: true });
      setPost(updated);
    } catch (e) {
      setError(apiErrorInfo(e));
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Layout eyebrow="Step 03" title="Refine Options" step="refine" flow={newFlowProp(post)}>
      <div className="page-lede"><p>Compare close variants, then decide how you&apos;d like to refine the one you like.</p></div>

      <AiErrorNotice error={error} />

      <div className="grid-2 reverse">
        <Card>
          <CardHead title="Selected design" tag={selected?.label} />
          <div className="preview-frame">
            <div
              className={previewCanvasClass(post.mediums?.[0])}
              style={selected?.imageUrl ? { cursor: 'zoom-in', aspectRatio: previewAspectRatio(post.mediums?.[0]) } : { background: 'linear-gradient(160deg,#6B7280,#9CA3AF)', aspectRatio: previewAspectRatio(post.mediums?.[0]) }}
              onClick={() =>
                selected?.imageUrl &&
                openLightbox({
                  src: selected.imageUrl,
                  formatId: post.mediums?.[0],
                  title: selected?.caption,
                  meta: [
                    { label: 'Variant', value: selected?.label || '' },
                    { label: 'Platform', value: getFormat(post.mediums?.[0]).platform },
                    
                  ]
                })
              }
            >
              {selected?.imageUrl && <img className="cap-img" src={resolveAssetUrl(selected.imageUrl)} alt="" />}
              <CaptionOverlay caption={selected?.caption} />
            </div>
            <div className="preview-meta"><span>{getFormat(post.mediums?.[0]).platform} {getFormat(post.mediums?.[0]).label} · {ORIENTATION_PIXELS[getFormat(post.mediums?.[0]).orientation]}</span><span>Unpublished</span></div>
          </div>
          <div className="thumb-strip">
            {others.map((d) => (
              <div
                key={d.label}
                className={`t ${selected?.label === d.label ? 'active' : ''}`}
                style={d.imageUrl ? { backgroundImage: `url(${resolveAssetUrl(d.imageUrl)})`, backgroundSize: 'cover' } : { background: 'linear-gradient(160deg,#6B7280,#9CA3AF)' }}
                onClick={() => selectThumb(d.label)}
                title={d.label}
              />
            ))}
          </div>
        </Card>

        <div>
          <Card>
            <CardHead title="What would you like to do?" />
            <Btn variant="primary" block className="btn-block" style={{ marginBottom: 10 }} onClick={() => navigate('/modify')}>
              Modify this post
            </Btn>
            <Btn variant="secondary" block style={{ marginBottom: costs ? 2 : 10 }} loading={regenerating} onClick={regenerate}>
              Regenerate this variant
            </Btn>
            {costs && costs.caption && costs[post.creativeBrief?.qualityTier === 'standard' ? 'imageStandard' : 'imageHigh'] && (
              <p className="hint" style={{ marginBottom: 10, textAlign: 'right' }}>
                <CostTag
                  estimate={{
                    usd: costs.caption.usd + costs[post.creativeBrief?.qualityTier === 'standard' ? 'imageStandard' : 'imageHigh'].usd,
                    model: 'AI model'
                  }}
                />
              </p>
            )}
            <Btn variant="secondary" block onClick={() => navigate('/publish')}>
              Approve as-is
            </Btn>
          </Card>
          <Card>
            <p className="hint" style={{ fontSize: 12.5 }}>
              Tip: refining the image and copy separately usually gets to a keeper faster than a full regenerate.
            </p>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
