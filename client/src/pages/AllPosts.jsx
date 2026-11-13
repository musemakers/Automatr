import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { Card, Btn, ErrorText } from '../components/ui.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import Modal from '../components/Modal.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi } from '../api/resources.js';
import { apiErrorMessage, resolveAssetUrl, downloadFile } from '../api/client.js';
import VideoDownloadMenu from '../components/VideoDownloadMenu.jsx';
import { getFormat } from '../constants/postFormats.js';
import iconSparkle from '../assets/generate-home/sparkle.svg';
import iconAdapt from '../assets/generate-home/creative-adapt.svg';
import iconText from '../assets/generate-home/text-select.svg';
import iconSwap from '../assets/generate-home/replace.webp';
import iconResize from '../assets/generate-home/resize.svg';
import iconConvert from '../assets/generate-home/icon-convert-video.svg';

// The thumbnail placeholder (no image yet) shows the icon of the Generate Media tool the document was made in.
const TOOL_ICONS = {
  new: { icon: iconSparkle, name: 'New Creative' },
  adaptation: { icon: iconAdapt, name: 'Creative Edit' },
  headline: { icon: iconText, name: 'Headline Switch' },
  hero: { icon: iconSwap, name: 'Subject Swap' },
  resize: { icon: iconResize, name: 'Size Adapt' },
  convert: { icon: iconConvert, name: 'Convert to Video' }
};

const fileExt = (url) => (/\.(png|jpe?g|webp)(\?|$)/i.exec(url || '')?.[1] || 'png').toLowerCase();
const slug = (t) => (t || 'creative').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'creative';
const sizeText = (f) => (f.px ? `${f.px.replace('x', ' × ')} px` : f.ratio);

const fmtBytes = (b) => {
  if (!b) return '0 MB';
  const mb = b / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
};

/** "27 Oct 2026, 3:45 PM" */
function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** "just now", "5 minutes ago", "1 hour ago", "3 days ago", "2 months ago" */
function timeAgo(value) {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return plural(Math.max(m, 1), 'minute');
  const h = Math.round(s / 3600);
  if (h < 24) return plural(h, 'hour');
  const dd = Math.round(s / 86400);
  if (dd < 30) return plural(dd, 'day');
  const mo = Math.round(dd / 30);
  if (mo < 12) return plural(mo, 'month');
  return plural(Math.round(dd / 365), 'year');
}

function StorageIndicator({ usage }) {
  if (!usage || usage.unscoped) return null;
  const pct = Math.max(usage.usedBytes > 0 ? 1 : 0, Math.round(usage.percent));
  const color = pct >= 90 ? '#C62828' : pct >= 75 ? '#B26A00' : 'var(--blue)';
  return (
    <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fff', border: '1px solid var(--line)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, marginBottom: 8 }}>
        <span>Storage</span>
        <span style={{ color: 'var(--muted)' }}>{fmtBytes(usage.usedBytes)} of {fmtBytes(usage.limitBytes)} used</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Storage used" style={{ height: 8, borderRadius: 4, background: '#E9EBF2', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, transition: 'width .3s ease' }} />
      </div>
      {pct >= 90 && <p style={{ margin: '8px 0 0', fontSize: 13, color }}>Storage is almost full. Delete old documents to free up space.</p>}
    </div>
  );
}

const STATUS_LABELS = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  published: 'Published'
};

const STATUS_COLORS = {
  draft: { bg: 'var(--paper-2, #f0f1f4)', fg: 'var(--muted)' },
  in_review: { bg: '#FFF6E5', fg: '#8A5A00' },
  approved: { bg: 'var(--blue-soft)', fg: 'var(--blue-dark)' },
  published: { bg: '#E7F7EE', fg: '#15803D' }
};

function resumePath(post) {
  if (post.status === 'published') return '/publish';
  const selected = post.designs?.find((d) => d.label === post.selectedVariantLabel);
  // Revisit lands on the page showing all the generated options, with the chosen one ticked.
  if ((post.designs || []).some((d) => (d.imageOptions || []).filter((o) => o?.imageUrl).length > 1)) return '/designs';
  if (selected?.imageUrl) return '/refine';
  if ((post.designs?.length || 0) > 1) return '/designs';
  return '/generate';
}

// A document is "completed" once it has produced any image or a finished
// video (including adapted sizes); otherwise it's still in progress.
function hasGeneratedMedia(post) {
  return (post.designs || []).some(
    (d) =>
      d.imageUrl ||
      (d.imageOptions || []).some((o) => o?.imageUrl) ||
      (d.formatVariants || []).some((v) => v?.imageUrl) ||
      (d.videoJobs || []).some((j) => j.status === 'completed' && j.videoUrl)
  );
}

// A completed document can hold both images and videos (e.g. a video made from a generated image). In Completed
// they show as separate cards: one for the image work and one for the video. Convert to Video documents are video only.
// Same rule as the Usage page counts, so the cards here and the generated numbers there match.
function cardsFor(post) {
  const designs = post.designs || [];
  const hasImage =
    post.creativeType !== 'convert' &&
    designs.some((d) => d.imageUrl || (d.imageOptions || []).some((o) => o?.imageUrl) || (d.formatVariants || []).some((v) => v?.imageUrl));
  const hasVideo = designs.some((d) => (d.videoJobs || []).some((j) => j.status === 'completed' && j.videoUrl));
  const out = [];
  if (hasImage) out.push({ post, mode: 'image' });
  if (hasVideo) out.push({ post, mode: 'video' });
  return out.length ? out : [{ post, mode: 'all' }];
}

const PAGE_SIZE = 10;

// 1 … 4 5 6 … N style window of page numbers.
function pageList(page, total) {
  const keep = new Set([1, total, page - 1, page, page + 1]);
  const nums = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

export default function AllPosts({ filter = 'all' }) {
  const navigate = useNavigate();
  const { setPost } = useWorkflow();
  const { open: openLightbox } = useLightbox();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [pages, setPages] = useState({});
  const [pickedIds, setPickedIds] = useState(() => new Set()); // posts ticked on the current Completed page
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectMode, setSelectMode] = useState(false); // tickboxes only appear after the user taps the Select CTA
  const [confirm, setConfirm] = useState(null); // 'selected' | 'all'
  useEffect(() => { setPages({}); }, [filter]);

  function loadUsage(fresh) {
    postsApi.storage(fresh).then(setUsage).catch(() => {});
  }

  function load() {
    loadUsage();
    postsApi
      .list()
      .then(({ posts }) => setPosts(posts))
      .catch((e) => setError(apiErrorMessage(e)));
  }

  useEffect(load, []);

  function handleEdit(post) {
    setPost(post);
    navigate(resumePath(post));
  }

  async function handleDelete(post) {
    if (!window.confirm(`Delete this asset ("${post.purpose}")? This can't be undone.`)) return;
    setDeletingId(post._id);
    setError('');
    try {
      await postsApi.remove(post._id);
      setPosts((prev) => prev.filter((p) => p._id !== post._id));
      loadUsage(true);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDownload(key, url, filename) {
    setDownloadingKey(key);
    try {
      await downloadFile(resolveAssetUrl(url), filename);
    } catch {
      setError('Could not download the image. Try opening it in the preview and saving it from there instead.');
    } finally {
      setDownloadingKey(null);
    }
  }

  const toggleSelected = (id) => setPickedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function handleDeleteSelected() {
    const ids = [...pickedIds];
    setConfirm(null);
    if (!ids.length) return;
    setDeletingSelected(true);
    setError('');
    try {
      const results = await Promise.allSettled(ids.map((id) => postsApi.remove(id)));
      const gone = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'));
      setPosts((prev) => prev.filter((p) => !gone.has(p._id)));
      setPickedIds(new Set());
      setSelectMode(false);
      loadUsage(true);
      if (gone.size < ids.length) setError(`${ids.length - gone.size} of the selected documents could not be deleted. Try again.`);
    } finally {
      setDeletingSelected(false);
    }
  }

  // Empty Storage: removes every document (and all its images / videos) after an explicit confirmation.
  async function handleDeleteAll() {
    setConfirm(null);
    if (!posts?.length) return;
    setDeletingAll(true);
    setError('');
    try {
      await postsApi.removeAll();
      setPosts([]);
      loadUsage(true);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setDeletingAll(false);
    }
  }

  return (
    <Layout eyebrow="Documents" title={filter === 'completed' ? 'Completed' : filter === 'in-progress' ? 'In Progress' : 'All Creatives'}>
      <div className="page-lede">
        <p>Every creative you've started, edited, adapted or published, with all its saved size adaptations. Pick one up where you left off, or clean up old drafts.</p>
      </div>

      <ErrorText>{error}</ErrorText>

      <StorageIndicator usage={usage} />

      {posts === null && <LoadingSpinner label="Loading your assets…" />}

      {posts?.length > 0 && (
        <div className="btn-row" style={{ marginBottom: 18 }}>
          <Btn variant="secondary" loading={deletingAll} onClick={() => setConfirm('all')}>
            Empty Storage
          </Btn>
        </div>
      )}

      {posts?.length > 0 && filter !== 'all' && !posts.some((p) => (hasGeneratedMedia(p) ? filter === 'completed' : filter === 'in-progress')) && (
        <Card>
          <div className="empty-state">Nothing {filter === 'completed' ? 'completed' : 'in progress'} yet.</div>
        </Card>
      )}

      {posts?.length === 0 && (
        <Card>
          <div className="empty-state">
            No assets yet. <Link to="/generate">Start one</Link> from the dashboard whenever you're ready.
          </div>
        </Card>
      )}

      {confirm === 'selected' && (
        <Modal title="Delete selected documents?" onClose={() => setConfirm(null)} width={460}>
          <p style={{ marginBottom: 18 }}>
            {pickedIds.size} document{pickedIds.size === 1 ? '' : 's'} will be permanently deleted, along with every image and video in {pickedIds.size === 1 ? 'it' : 'them'}. This can&apos;t be undone.
          </p>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <Btn variant="primary" style={{ background: '#C62828', borderColor: '#C62828' }} onClick={handleDeleteSelected}>Delete selected</Btn>
            <Btn variant="secondary" onClick={() => setConfirm(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}
      {confirm === 'all' && (
        <Modal title="Empty your storage?" onClose={() => setConfirm(null)} width={460}>
          <p style={{ marginBottom: 12 }}>
            This will permanently delete <strong>all {posts?.length || 0} document{posts?.length === 1 ? '' : 's'}</strong>, including every image and video you have generated, and free up all your storage.
          </p>
          <p className="hint" style={{ marginBottom: 18 }}>This can&apos;t be undone. Download anything you want to keep first.</p>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <Btn variant="primary" style={{ background: '#C62828', borderColor: '#C62828' }} onClick={handleDeleteAll}>Empty Storage</Btn>
            <Btn variant="secondary" onClick={() => setConfirm(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {[
        { key: 'completed', title: 'Completed', list: filter === 'in-progress' ? [] : (posts || []).filter(hasGeneratedMedia).flatMap(cardsFor), completed: true },
        { key: 'progress', title: 'In progress', list: filter === 'completed' ? [] : (posts || []).filter((p) => !hasGeneratedMedia(p)).map((p) => ({ post: p, mode: 'all' })), completed: false }
      ].map(
        (section) =>
          section.list.length > 0 && (() => {
            const totalPages = Math.max(1, Math.ceil(section.list.length / PAGE_SIZE));
            const page = Math.min(pages[section.key] || 1, totalPages);
            const go = (n) => { setPages((prev) => ({ ...prev, [section.key]: n })); setPickedIds(new Set()); window.scrollTo({ top: 0, behavior: 'smooth' }); };
            const pageEntries = section.list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
            const pageIds = [...new Set(pageEntries.map((e) => e.post._id))];
            const selectedOnPage = pageIds.filter((id) => pickedIds.has(id));
            const allSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
            return (
            <section key={section.key} style={{ marginBottom: 28 }}>
              {filter === 'all' && <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
                {section.title} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({section.list.length})</span>
              </h2>}
              {section.completed && (
                <div className="btn-row" style={{ alignItems: 'center', gap: 14, marginBottom: 12, marginTop: 0 }}>
                  <Btn variant="secondary" onClick={() => { setSelectMode((m) => !m); setPickedIds(new Set()); }}>
                    {selectMode ? 'Cancel' : 'Select'}
                  </Btn>
                  {selectMode && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => setPickedIds(allSelected ? new Set() : new Set(pageIds))}
                      />
                      Select all on this page
                    </label>
                  )}
                  {selectMode && selectedOnPage.length > 0 && (
                    <Btn variant="secondary" loading={deletingSelected} onClick={() => setConfirm('selected')}>
                      Delete selected ({selectedOnPage.length})
                    </Btn>
                  )}
                </div>
              )}
              {pageEntries.map((entry) => renderPost(entry.post, section.completed, entry.mode))}
              {totalPages > 1 && (
                <nav className="btn-row" style={{ justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8 }} aria-label="Pagination">
                  <Btn variant="secondary" disabled={page <= 1} onClick={() => go(page - 1)}>Previous</Btn>
                  {pageList(page, totalPages).map((n, i) =>
                    n === '…' ? (
                      <span key={`gap${i}`} style={{ color: 'var(--muted)' }}>…</span>
                    ) : (
                      <Btn
                        key={n}
                        variant={n === page ? 'primary' : 'secondary'}
                        aria-label={`Page ${n}`}
                        aria-current={n === page ? 'page' : undefined}
                        style={{ minWidth: 38, padding: '0 10px' }}
                        onClick={() => n !== page && go(n)}
                      >
                        {n}
                      </Btn>
                    )
                  )}
                  <Btn variant="secondary" disabled={page >= totalPages} onClick={() => go(page + 1)}>Next</Btn>
                </nav>
              )}
            </section>
            );
          })()
      )}
    </Layout>
  );

  function renderPost(post, isCompleted, mode = 'all') {
        const allDesigns = post.designs || [];
        const chosen = allDesigns.find((d) => d.label === post.selectedVariantLabel);
        // Saved documents show everything that was generated, whether or not
        // a design was ever selected / approved. The "selected" design is
        // only a preference for which one leads; it falls back to the first
        // design that actually has an image.
        const selected = (chosen?.imageUrl ? chosen : null) || allDesigns.find((d) => d.imageUrl) || chosen || allDesigns[0];
        const statusColor = STATUS_COLORS[post.status] || STATUS_COLORS.draft;
        const formats = post.mediums?.map((m) => getFormat(m));
        const thumbUrl = selected?.imageUrl || allDesigns.flatMap((d) => d.imageOptions || []).find((o) => o?.imageUrl)?.imageUrl || '';

        // Every other generated image (unselected designs + image options), de-duplicated.
        const seenImages = new Set([thumbUrl].filter(Boolean));
        const otherImages = [];
        for (const d of allDesigns) {
          for (const img of [{ imageUrl: d.imageUrl, label: d.label }, ...(d.imageOptions || []).map((o) => ({ imageUrl: o?.imageUrl, label: d.label }))]) {
            if (img.imageUrl && !seenImages.has(img.imageUrl)) {
              seenImages.add(img.imageUrl);
              otherImages.push(img);
            }
          }
        }

        // Every finished video across all designs (selected or not), de-duplicated, oldest -> newest.
        const seenVideos = new Set();
        const doneVideos = [];
        for (const d of allDesigns) {
          for (const j of d.videoJobs || []) {
            if (j.status === 'completed' && j.videoUrl && !seenVideos.has(j.videoUrl)) {
              seenVideos.add(j.videoUrl);
              doneVideos.push({ ...j, posterUrl: d.imageUrl });
            }
          }
        }
        // Sizes this creative was adapted to (Adapt Creative) - saved with the post, from any design.
        // The untouched upload for headline / hero edits (older posts only have it as previousImageUrl).
        const originalSrc = selected?.originalImageUrl || (['headline', 'hero', 'resize'].includes(post.creativeType) ? selected?.previousImageUrl : '') || undefined;
        const seenAdapt = new Set();
        const adaptations = allDesigns
          .flatMap((d) => d.formatVariants || [])
          .filter((v) => {
            if (!v.imageUrl || seenAdapt.has(v.imageUrl)) return false;
            seenAdapt.add(v.imageUrl);
            return true;
          });

        return (
          <Card key={`${post._id}:${mode}`} className="post-card">
            <div className="post-card__body">
              <div
                className="post-card__thumb"
                style={{
                  ...(thumbUrl
                    ? {}
                    : { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-2, #f0f1f4)', color: 'var(--muted)', fontSize: 12, opacity: 0.8 }),
                  backgroundImage: thumbUrl ? `url(${resolveAssetUrl(thumbUrl)})` : undefined,
                  cursor: thumbUrl && mode !== 'video' ? 'zoom-in' : 'default'
                }}
                title={thumbUrl ? undefined : (TOOL_ICONS[post.creativeType] || TOOL_ICONS.new).name}
                onClick={() =>
                  thumbUrl &&
                  mode !== 'video' &&
                  openLightbox({
                    src: thumbUrl,
                    formatId: post.mediums?.[0],
                    originalSrc,
                    downloadName: `${slug(post.purpose)}.${fileExt(thumbUrl)}`,
                    title: selected?.caption || post.purpose,
                    meta: [
                      { label: 'Platform', value: formats?.[0]?.platform || '' },
                      { label: 'Purpose', value: post.purpose },
                      ...(isCompleted && post.status === 'draft' ? [] : [{ label: 'Status', value: STATUS_LABELS[post.status] || post.status }]),
                      
                    ]
                  })
                }
              >
                {!thumbUrl && <img src={(TOOL_ICONS[post.creativeType] || TOOL_ICONS.new).icon} alt={(TOOL_ICONS[post.creativeType] || TOOL_ICONS.new).name} style={{ width: 34, height: 34, objectFit: 'contain' }} />}
              </div>

              <div className="post-card__content">
                <div className="post-card__head">
                  <div className="post-card__title-row">
                    {isCompleted && selectMode && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${post.purpose}`}
                        checked={pickedIds.has(post._id)}
                        onChange={() => toggleSelected(post._id)}
                        style={{ marginRight: 10, cursor: 'pointer' }}
                      />
                    )}
                    <h3 className="post-card__title">{post.purpose}</h3>
                    {!(isCompleted && post.status === 'draft') && (
                      <span
                        className="post-card__status"
                        style={{ background: statusColor.bg, color: statusColor.fg }}
                      >
                        {STATUS_LABELS[post.status] || post.status}
                      </span>
                    )}
                  </div>
                  <span className="post-card__date" style={{ textAlign: 'right' }} title={formatDateTime(post.updatedAt)}>
                    {formatDateTime(post.updatedAt)}
                    <br />
                    <span style={{ opacity: 0.7 }}>{timeAgo(post.updatedAt)}</span>
                  </span>
                </div>

                <p className="post-card__formats">
                  {mode === 'video' ? 'Video · ' : ''}{formats?.map((f) => `${f.platform} ${f.label}`).join(' · ')}
                </p>

                {selected?.caption && (
                  <p className="post-card__caption">
                    {selected.caption.length > 140 ? `${selected.caption.slice(0, 140)}…` : selected.caption}
                  </p>
                )}

                {mode !== 'video' && otherImages.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p className="hint" style={{ margin: '0 0 8px', fontWeight: 600 }}>More generated images ({otherImages.length})</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                      {otherImages.map((img, i) => (
                        <img
                          key={img.imageUrl}
                          src={resolveAssetUrl(img.imageUrl)}
                          alt={`Generated image ${i + 2}`}
                          onClick={() => openLightbox({ src: img.imageUrl, formatId: post.mediums?.[0], downloadName: `${slug(post.purpose)}-${i + 2}.${fileExt(img.imageUrl)}`, title: post.purpose, meta: [{ label: 'Purpose', value: post.purpose }] })}
                          style={{ width: '100%', height: 90, objectFit: 'contain', background: 'var(--paper-2, #f0f1f4)', border: '1px solid var(--line)', borderRadius: 8, display: 'block', cursor: 'zoom-in' }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {mode !== 'image' && doneVideos.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p className="hint" style={{ margin: '0 0 8px', fontWeight: 600 }}>Generated video{doneVideos.length > 1 ? `s (${doneVideos.length})` : ''}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      {doneVideos.map((v, vi) => (
                        <div key={v.videoUrl} style={{ width: '100%', maxWidth: 260 }}>
                          <video
                            controls
                            playsInline
                            preload="metadata"
                            poster={v.posterUrl ? resolveAssetUrl(v.posterUrl) : undefined}
                            src={resolveAssetUrl(v.videoUrl)}
                            style={{ width: '100%', maxHeight: 340, borderRadius: 10, background: '#000', display: 'block' }}
                          />
                          <div style={{ marginTop: 8 }}>
                            <VideoDownloadMenu url={v.videoUrl} baseName={`${slug(post.purpose)}${doneVideos.length > 1 ? `-${vi + 1}` : ''}`} align="left" className="btn btn-secondary">
                              <span>Download</span>
                            </VideoDownloadMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {mode !== 'video' && adaptations.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p className="hint" style={{ margin: '0 0 8px', fontWeight: 600 }}>Adaptations ({adaptations.length})</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                      {adaptations.map((v) => {
                        const f = getFormat(v.formatId);
                        const title = `${f.platform} ${f.label} (${sizeText(f)})`;
                        return (
                          <div key={v.formatId} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 6 }}>
                            <img
                              src={resolveAssetUrl(v.imageUrl)}
                              alt={title}
                              onClick={() => openLightbox({ src: v.imageUrl, formatId: v.formatId, originalSrc, downloadName: `${slug(post.purpose)}-${v.formatId}.${fileExt(v.imageUrl)}`, title, meta: [{ label: 'Platform', value: f.platform }, { label: 'Size', value: sizeText(f) }, { label: 'Purpose', value: post.purpose }] })}
                              style={{ width: '100%', height: 90, objectFit: 'contain', background: 'var(--paper-2, #f0f1f4)', borderRadius: 6, display: 'block', cursor: 'zoom-in' }}
                            />
                            <p style={{ margin: '6px 0 4px', fontSize: 11.5, lineHeight: 1.3 }}>
                              <strong style={{ fontWeight: 600 }}>{f.platform} {f.label.replace(new RegExp(`^${f.platform}\\s+`), '')}</strong>
                              <span className="hint" style={{ display: 'block', margin: 0 }}>{sizeText(f)}</span>
                            </p>
                            <Btn
                              variant="secondary"
                              loading={downloadingKey === `${post._id}-${v.formatId}`}
                              onClick={() => handleDownload(`${post._id}-${v.formatId}`, v.imageUrl, `${(post.purpose || 'creative').replace(/\s+/g, '-')}-${v.formatId}.png`)}
                            >
                              ⬇ Download
                            </Btn>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="btn-row" style={{ marginTop: 12 }}>
                  <Btn variant="secondary" onClick={() => handleEdit(post)}>{isCompleted ? 'Revisit' : 'Edit'}</Btn>
                  <Btn variant="secondary" loading={deletingId === post._id} onClick={() => handleDelete(post)}>
                    Delete
                  </Btn>
                </div>
              </div>
            </div>
          </Card>
        );
  }
}
