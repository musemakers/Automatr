import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { newFlowProp } from '../utils/newFlow.js';
import { useLeaveGuard } from '../components/LeaveGuard.jsx';
import NextStepCards from '../components/flow/NextStepCards.jsx';
import { Card, CardHead, Field, Btn, ErrorText } from '../components/ui.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import BloomLoader from '../components/BloomLoader.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi } from '../api/resources.js';
import { apiErrorMessage, resolveAssetUrl, downloadFile } from '../api/client.js';
import VideoDownloadMenu from '../components/VideoDownloadMenu.jsx';
import { getFormat, POST_FORMATS, ADAPT_ONLY_FORMATS, ADAPT_PLATFORM_ORDER } from '../constants/postFormats.js';

// Same full catalogue as Quick Adapt: every social placement (incl. video) plus the adapt-only
// ones - website banners, Google Display, email, print, outdoor, Amazon, Flipkart...
const ALL_PORT_FORMATS = [...POST_FORMATS, ...ADAPT_ONLY_FORMATS];
const sizeText = (f) => (f.px ? `${f.px.replace('x', ' × ')} px` : f.ratio);
import { imageOptionCanvasModifier, previewAspectRatio } from '../utils/mediumAspect.js';

export default function Publish() {
  const navigate = useNavigate();
  const { post, setPost, reset } = useWorkflow();
  const { user } = useAuth();
  useLeaveGuard(Boolean(post?._id));
  const { open: openLightbox } = useLightbox();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [approverName, setApproverName] = useState('');
  const [note, setNote] = useState('');
  const [sendingApproval, setSendingApproval] = useState(false);

  const [account, setAccount] = useState(`@${(user?.company?.name || 'brand').toLowerCase().replace(/\s+/g, '.')}`);
  const [deploying, setDeploying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingVariantId, setDownloadingVariantId] = useState(null);

  // Video jobs created by porting to a video-flagged format (see
  // portVariantToFormats on the server) - tracked by formatId so each
  // ported platform/placement can show its own progress independently of
  // the primary medium's own "Generate video" flow on Step 02.
  const [pollingVideoFormats, setPollingVideoFormats] = useState(new Set());

  // Port to other formats - the master creative was generated for exactly
  // one format on Step 01; other sizes are adapted here, on demand, right
  // before you actually need them for a specific platform.
  const masterFormat = getFormat(post?.mediums?.[0]);
  const portablePlatforms = [...new Set(ALL_PORT_FORMATS.map((f) => f.platform))].sort((a, b) => {
    const ia = ADAPT_PLATFORM_ORDER.indexOf(a);
    const ib = ADAPT_PLATFORM_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const [portPlatform, setPortPlatform] = useState(portablePlatforms.find((p) => p !== masterFormat.platform) || portablePlatforms[0]);
  const [portFormatId, setPortFormatId] = useState('');
  const [portingFormatId, setPortingFormatId] = useState(null);

  useEffect(() => {
    if (!post) navigate('/generate');
  }, [post, navigate]);

  useEffect(() => {
    const first = ALL_PORT_FORMATS.find((f) => f.platform === portPlatform && f.id !== masterFormat.id);
    setPortFormatId(first?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portPlatform]);

  if (!post) return null;

  const selected = post.designs.find((d) => d.label === post.selectedVariantLabel) || post.designs[0];
  const fullImageUrl = resolveAssetUrl(selected?.imageUrl);

  async function handleSendForApproval() {
    setSendingApproval(true);
    setError('');
    setSuccess('');
    try {
      const { post: updated } = await postsApi.sendForApproval(post._id, { approverName, note });
      setPost(updated);
      setSuccess(`Sent to ${approverName || 'your approver'} for review.`);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSendingApproval(false);
    }
  }

  async function handleDeploy(platform) {
    setDeploying(true);
    setError('');
    setSuccess('');
    try {
      const { post: updated, deployment } = await postsApi.publish(post._id, { platform, account });
      setPost(updated);
      setSuccess(`Deployed to ${platform} (${deployment.simulated ? 'simulated' : 'live'}). ${deployment.externalUrl}`);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setDeploying(false);
    }
  }

  async function handleDownload() {
    if (!fullImageUrl) {
      setError('This variant has no generated image to download (it is using a placeholder background). Add an image via Modify Asset first.');
      return;
    }
    setDownloading(true);
    setError('');
    try {
      await downloadFile(fullImageUrl, `${post.selectedVariantLabel || 'automatr'}.png`);
    } catch (err) {
      setError('Could not download the image. Try opening it in a new tab and saving it from there instead.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadVariant(formatId, url) {
    setDownloadingVariantId(formatId);
    setError('');
    try {
      await downloadFile(resolveAssetUrl(url), `${post.selectedVariantLabel || 'automatr'}-${formatId}.png`);
    } catch (err) {
      setError('Could not download this file. Try opening it in a new tab instead.');
    } finally {
      setDownloadingVariantId(null);
    }
  }

  async function handlePortFormat(explicitFormatId) {
    const targetFormatId = explicitFormatId || portFormatId;
    if (!targetFormatId) return;
    setPortingFormatId(targetFormatId);
    setError('');
    try {
      const { post: updated, videoJobs } = await postsApi.portFormats(post._id, post.selectedVariantLabel, { formatIds: [targetFormatId] });
      setPost(updated);
      // A video-flagged target format doesn't get a formatVariants entry
      // (there's no still image) - instead it started an async video job,
      // which needs the same poll-until-done treatment as the primary
      // "Generate video" flow on Step 02.
      const job = videoJobs?.find((j) => j.formatId === targetFormatId);
      if (job) pollPortedVideoStatus(targetFormatId, job.externalJobId);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setPortingFormatId(null);
    }
  }

  // Mirrors GenerateDesigns.jsx's pollVideoStatus - polls every 6s since
  // video generation typically takes 1-3+ minutes and would otherwise time
  // out a normal request. Tracked per formatId so porting to several video
  // platforms at once each show their own independent progress.
  function pollPortedVideoStatus(formatId, jobId) {
    setPollingVideoFormats((prev) => new Set(prev).add(formatId));
    setTimeout(async () => {
      try {
        const { post: updated, job } = await postsApi.getVideoStatus(post._id, post.selectedVariantLabel, jobId);
        setPost(updated);
        if (job.status === 'processing' || job.status === 'pending') {
          pollPortedVideoStatus(formatId, jobId);
        } else {
          setPollingVideoFormats((prev) => {
            const next = new Set(prev);
            next.delete(formatId);
            return next;
          });
        }
      } catch (e) {
        setError(apiErrorMessage(e));
        setPollingVideoFormats((prev) => {
          const next = new Set(prev);
          next.delete(formatId);
          return next;
        });
      }
    }, 6000);
  }

  const formatVariants = selected?.formatVariants || [];
  const portFormatOptions = ALL_PORT_FORMATS.filter((f) => f.platform === portPlatform && f.id !== masterFormat.id);
  // Latest video job per target format, for formats this variant was
  // ported to (formatId set) - distinct from the primary medium's own
  // videoJobs (formatId === ''), which live on Step 02 instead.
  const portedVideoEntries = Object.values(
    (selected?.videoJobs || []).reduce((acc, job) => {
      if (job.formatId) acc[job.formatId] = { formatId: job.formatId, job };
      return acc;
    }, {})
  );

  return (
    <Layout eyebrow={post?.creativeType === 'adaptation' ? 'Step 03' : 'Step 05'} title="Publish" step="publish" flow={newFlowProp(post)}>
      <div className="page-lede"><p>Send it for a second pair of eyes, or take it straight to your channels.</p></div>

      <ErrorText>{error}</ErrorText>
      {success && <p className="hint" style={{ marginBottom: 14, color: 'var(--blue-dark)' }}>{success}</p>}

      {selected?.carouselSlides?.length > 0 && (
        <Card style={{ marginBottom: 18 }}>
          <CardHead title={`${masterFormat.label} slides`} tag={`${selected.carouselSlides.length} slides`} />
          <p className="hint" style={{ marginBottom: 14 }}>
            This is the full set that will publish together as one {masterFormat.notSwipeable ? 'multi-image post' : 'carousel'}. Tap a slide to preview it full-size.
          </p>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
            {selected.carouselSlides.map((slide, i) => (
              <div
                key={slide.index}
                style={{
                  flex: '0 0 auto',
                  width: 110,
                  height: 110,
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  cursor: slide.imageUrl ? 'zoom-in' : 'default',
                  backgroundImage: slide.imageUrl ? `url(${resolveAssetUrl(slide.imageUrl)})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundColor: slide.imageUrl ? undefined : 'var(--fog)'
                }}
                onClick={() =>
                  slide.imageUrl &&
                  openLightbox({
                    index: i,
                    items: selected.carouselSlides.map((s) => ({
                      src: s.imageUrl,
                      formatId: post.mediums?.[0],
                      title: selected.caption,
                      meta: [
                        { label: 'Slide', value: `${s.index + 1} of ${selected.carouselSlides.length}` },
                        { label: 'Role', value: s.slideRole || '—' }
                      ]
                    }))
                  })
                }
              />
            ))}
          </div>
        </Card>
      )}

      <div className="choice-grid">
        <div className="choice-card">
          <span className="choice-card__icon"><svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" /></svg></span>
          <h2>Send for approval</h2>
          <p>Loop in a teammate before this goes anywhere public.</p>
          <Field label="Approver">
            <input type="text" placeholder="e.g. Priya Nair — Brand Lead" value={approverName} onChange={(e) => setApproverName(e.target.value)} />
          </Field>
          <Field label="Note">
            <textarea placeholder="Anything they should know before reviewing?" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Btn variant="primary" block loading={sendingApproval} onClick={handleSendForApproval}>Send for approval</Btn>
        </div>

        <div className="choice-card">
          <span className="choice-card__icon"><svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0-4-4m4 4 4-4M5 19h14" /></svg></span>
          <h2>Download media</h2>
          <p>Export the file, then choose where it should go.</p>
          <Field label="Social account">
            <input type="text" value={account} onChange={(e) => setAccount(e.target.value)} />
          </Field>
          <div className="dest-row">
            <div className="dest-row__icon" />
            <div><p>{masterFormat.platform} {masterFormat.label} — {account}</p><span>Deploy directly from AUTOMATr</span></div>
            <Btn variant="primary" loading={deploying} onClick={() => handleDeploy(masterFormat.platform)}>Deploy to SM account</Btn>
          </div>
          <div className="dest-row">
            <div className="dest-row__icon" />
            <div><p>Save as PNG, {masterFormat.ratio}</p><span>Upload manually yourself</span></div>
            <Btn variant="secondary" loading={downloading} onClick={handleDownload}>Download</Btn>
          </div>
        </div>
      </div>

      {post.creativeType === 'adaptation' && selected?.imageUrl && (
        <NextStepCards adapt convert imageUrl={selected.imageUrl} />
      )}

      {(selected?.imageUrl || selected?.caption) && (
        <Card style={{ marginTop: 18 }}>
          <CardHead title="Port to other formats" tag="AI" />
          <p className="hint" style={{ marginBottom: 14 }}>
            Your master creative was generated for {masterFormat.platform} {masterFormat.label}. Adapt it for another
            platform/size here — image formats get an AI-recomposed still (same subject, palette, and concept, new
            aspect ratio); video formats (🎥) kick off a proper video generation job themed to match the same campaign.
          </p>

          <div className="select-row" style={{ marginBottom: 16 }}>
            <select value={portPlatform} onChange={(e) => setPortPlatform(e.target.value)}>
              {portablePlatforms.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={portFormatId} onChange={(e) => setPortFormatId(e.target.value)}>
              {portFormatOptions.length === 0 && <option value="">No other sizes for this platform</option>}
              {portFormatOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.isVideo ? '🎥 ' : ''}{f.label} ({f.adaptOnly ? sizeText(f) : f.ratio})</option>
              ))}
            </select>
            <Btn variant="secondary" loading={Boolean(portingFormatId)} disabled={!portFormatId} onClick={() => handlePortFormat()}>
              ✦ Port to this format
            </Btn>
          </div>

          {formatVariants.length > 0 && (
            <div className="image-option-grid">
              {formatVariants.map((v) => {
                const f = getFormat(v.formatId);
                const modifier = imageOptionCanvasModifier(v.formatId);
                const ratio = previewAspectRatio(v.formatId);
                const isLoading = portingFormatId === v.formatId;
                return (
                  <div key={v.formatId} className="image-option-card" style={{ cursor: 'default' }}>
                    <div
                      className={`image-option-card__canvas ${modifier}`}
                      style={v.imageUrl ? { aspectRatio: ratio } : { background: 'linear-gradient(150deg,#1D3FE0,#8FA9FF)', aspectRatio: ratio }}
                    >
                      {isLoading && (
                        <div className="direction-card__canvas-loading">
                          <BloomLoader />
                        </div>
                      )}
                      {!isLoading && v.imageUrl && <img className="cap-img" src={resolveAssetUrl(v.imageUrl)} alt="" />}
                      {!isLoading && v.imageUrl && (
                        <button
                          type="button"
                          className="image-option-card__view"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLightbox({
                              src: v.imageUrl,
                              formatId: v.formatId,
                              title: selected?.caption,
                              meta: [
                                { label: 'Format', value: `${f.platform} ${f.label} (${f.ratio})` },
                                
                              ]
                            });
                          }}
                          aria-label="View full size"
                        >
                          🔍
                        </button>
                      )}
                      {!isLoading && !v.imageUrl && (
                        <div className="direction-card__no-image">
                          <p>{v.imageNote || 'Could not be generated.'}</p>
                          {v.imageBillingUrl && (
                            <a
                              href={v.imageBillingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary"
                              style={{ fontSize: 11.5, padding: '5px 10px' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Add AI credits ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '8px 4px' }}>
                      <p className="hint" style={{ marginBottom: 8 }}>{f.platform} {f.label} ({f.ratio})</p>
                      {v.imageUrl && (
                        <Btn
                          variant="secondary"
                          loading={downloadingVariantId === v.formatId}
                          onClick={() => handleDownloadVariant(v.formatId, v.imageUrl)}
                        >
                          Download
                        </Btn>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {portedVideoEntries.length > 0 && (
            <div className="image-option-grid" style={{ marginTop: formatVariants.length > 0 ? 14 : 0 }}>
              {portedVideoEntries.map(({ formatId, job }) => {
                const f = getFormat(formatId);
                const isActive = pollingVideoFormats.has(formatId) || job.status === 'pending' || job.status === 'processing';
                return (
                  <div key={formatId} className="image-option-card" style={{ cursor: 'default' }}>
                    <div className="image-option-card__canvas" style={{ background: 'linear-gradient(150deg,#1D3FE0,#8FA9FF)' }}>
                      {isActive && (
                        <div className="direction-card__canvas-loading">
                          <BloomLoader label="Generating video…" />
                        </div>
                      )}
                      {!isActive && job.status === 'completed' && job.videoUrl && (
                        <video src={resolveAssetUrl(job.videoUrl)} controls playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      {!isActive && job.status === 'failed' && (
                        <div className="direction-card__no-image">
                          <p>{job.note || 'Video generation failed.'}</p>
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '8px 4px' }}>
                      <p className="hint" style={{ marginBottom: 8 }}>🎥 {f.platform} {f.label} ({f.videoAspectRatio})</p>
                      {job.status === 'completed' && job.videoUrl && (
                        <VideoDownloadMenu url={job.videoUrl} baseName={`${post.selectedVariantLabel || 'automatr'}-${formatId}`} align="left" up className="btn btn-secondary">
                          <span>Download</span>
                        </VideoDownloadMenu>
                      )}
                      {job.status === 'failed' && (
                        <Btn variant="secondary" onClick={() => handlePortFormat(formatId)}>
                          Retry
                        </Btn>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {post.status === 'published' && (
        <div className="btn-row">
          <Btn variant="secondary" onClick={() => { reset(); navigate('/dashboard'); }}>Done — back to dashboard</Btn>
        </div>
      )}
    </Layout>
  );
}
