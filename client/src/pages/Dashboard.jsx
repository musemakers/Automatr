import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import AgencyDashboard from './AgencyDashboard.jsx';
import Ticker from '../components/Ticker.jsx';
import NewsCard from '../components/NewsCard.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { Card, CardHead, Btn } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { newsApi, postsApi, competitorsApi, aiApi } from '../api/resources.js';
import { resolveAssetUrl, apiErrorMessage } from '../api/client.js';
import { getFormat } from '../constants/postFormats.js';

const STATUS_BADGE = {
  draft: { label: 'Draft', cls: 'badge--draft' },
  in_review: { label: 'In review', cls: 'badge--review' },
  approved: { label: 'Approved', cls: 'badge--review' },
  published: { label: 'Published', cls: 'badge--live' }
};

function timeAgo(ms) {
  if (!ms) return '';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The customer / member home: news, competitor watch, recent posts.
function WorkspaceDashboard() {
  const { user } = useAuth();
  const { open: openLightbox } = useLightbox();
  const [news, setNews] = useState(null);
  const [posts, setPosts] = useState([]);
  const [usage, setUsage] = useState(null); // this month's completed images / videos (same numbers as the Usage page)

  const [competitors, setCompetitors] = useState(null); // null = loading, [] = none saved yet
  const [competitorsConfigured, setCompetitorsConfigured] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [competitorError, setCompetitorError] = useState('');
  const [editingCompetitors, setEditingCompetitors] = useState(false);
  const [draftCompetitors, setDraftCompetitors] = useState([]);
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [savingCompetitors, setSavingCompetitors] = useState(false);

  const [competitorNews, setCompetitorNews] = useState(null);
  const [competitorNewsFetchedAt, setCompetitorNewsFetchedAt] = useState(null);
  const [loadingCompetitorNews, setLoadingCompetitorNews] = useState(false);
  const [refreshingCompetitorNews, setRefreshingCompetitorNews] = useState(false);

  useEffect(() => {
    newsApi.snapshot().then(setNews).catch(() => setNews(null));
    postsApi.list().then(({ posts }) => setPosts(posts)).catch(() => setPosts([]));
    aiApi.getUsage({ limit: 1 }).then(setUsage).catch(() => setUsage(null));
    competitorsApi
      .get()
      .then(({ competitors, configured }) => {
        setCompetitors(competitors);
        setCompetitorsConfigured(configured);
      })
      .catch(() => setCompetitors([]));
  }, []);

  useEffect(() => {
    if (!competitors?.length) return;
    setLoadingCompetitorNews(true);
    competitorsApi
      .getNews()
      .then(({ items, fetchedAt }) => {
        setCompetitorNews(items);
        setCompetitorNewsFetchedAt(fetchedAt);
      })
      .catch(() => setCompetitorNews([]))
      .finally(() => setLoadingCompetitorNews(false));
  }, [competitors]);

  async function refreshCompetitorNews() {
    setRefreshingCompetitorNews(true);
    try {
      const { items, fetchedAt } = await competitorsApi.getNews(true);
      setCompetitorNews(items);
      setCompetitorNewsFetchedAt(fetchedAt);
    } catch (e) {
      setCompetitorError(apiErrorMessage(e));
    } finally {
      setRefreshingCompetitorNews(false);
    }
  }

  async function handleDetectCompetitors() {
    setDetecting(true);
    setCompetitorError('');
    try {
      const { competitors: detected } = await competitorsApi.detect();
      setCompetitors(detected);
    } catch (e) {
      setCompetitorError(apiErrorMessage(e));
    } finally {
      setDetecting(false);
    }
  }

  function startEditingCompetitors() {
    setDraftCompetitors(competitors || []);
    setNewCompetitorName('');
    setEditingCompetitors(true);
  }

  function addDraftCompetitor() {
    const name = newCompetitorName.trim();
    if (!name || draftCompetitors.length >= 5) return;
    setDraftCompetitors((prev) => [...prev, { name, website: '' }]);
    setNewCompetitorName('');
  }

  function removeDraftCompetitor(index) {
    setDraftCompetitors((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveDraftCompetitors() {
    setSavingCompetitors(true);
    setCompetitorError('');
    try {
      const { competitors: saved } = await competitorsApi.save(draftCompetitors);
      setCompetitors(saved);
      setEditingCompetitors(false);
    } catch (e) {
      setCompetitorError(apiErrorMessage(e));
    } finally {
      setSavingCompetitors(false);
    }
  }

  // Each completed card in Saved Documents is one generation; images and videos are counted separately (as on the Usage page).
  const imagesMade = usage?.completedCards?.images?.count;
  const videosMade = usage?.completedCards?.videos?.count;
  const shown = (n) => (n === undefined || n === null ? '–' : n);

  return (
    <Layout eyebrow="Workspace" title="Dashboard">
      <div className="page-lede">
        <p className="topbar__eyebrow">Good day, {user?.name}</p>
        <h1>Here&apos;s what&apos;s moving for {user?.company?.name || 'your brand'}.</h1>
      </div>

      {news && <Ticker industry={news.industry} tickers={news.tickers} />}

      <div className="stats-row">
        <div className="stat"><span>{usage?.allowance?.plan === 'one_time' ? 'Generations in Package' : 'Generations this Month'}</span><strong>{shown(usage ? (imagesMade || 0) + (videosMade || 0) : undefined)}</strong></div>
        <div className="stat"><span>Images Generated</span><strong>{shown(imagesMade)}</strong></div>
        <div className="stat"><span>Videos Generated</span><strong>{shown(videosMade)}</strong></div>
      </div>

      <Card>
        <CardHead
          title={`News for ${news?.industry || ''}`}
          action={<Link to="/news" className="btn btn-ghost">Full feed →</Link>}
        />
        {!news && <LoadingSpinner label="Fetching your industry news…" />}
        {news?.news?.slice(0, 3).map((n, i) => <NewsCard key={i} {...n} />)}
      </Card>

      <Card>
        <CardHead
          title="Competitor watch"
          action={
            competitors?.length > 0 && !editingCompetitors ? (
              <button type="button" className="btn btn-ghost" onClick={startEditingCompetitors}>Edit list</button>
            ) : undefined
          }
        />

        {competitorError && <p className="hint" style={{ color: '#C0273E', marginBottom: 10 }}>{competitorError}</p>}

        {competitors === null && <LoadingSpinner label="Loading…" />}

        {competitors !== null && !competitorsConfigured && (
          <p className="hint">
            Not available yet - an admin needs to set up AI access (competitor
            detection and news use AI with web search).
          </p>
        )}

        {competitors !== null && competitorsConfigured && competitors.length === 0 && !editingCompetitors && (
          <>
            <p className="hint" style={{ marginBottom: 12 }}>
              Track the top brands you compete with - AUTOMATr can identify them for you via web search, or you can type
              them in yourself.
            </p>
            <div className="btn-row" style={{ marginTop: 0 }}>
              <Btn variant="primary" loading={detecting} onClick={handleDetectCompetitors}>✦ Detect with AI</Btn>
              <Btn variant="secondary" onClick={startEditingCompetitors}>Enter manually</Btn>
            </div>
          </>
        )}

        {editingCompetitors && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {draftCompetitors.map((c, i) => (
                <span key={i} className="chip selected" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {c.name}
                  <button
                    type="button"
                    onClick={() => removeDraftCompetitor(i)}
                    aria-label={`Remove ${c.name}`}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            {draftCompetitors.length < 5 && (
              <div className="select-row" style={{ marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="Competitor brand name"
                  value={newCompetitorName}
                  onChange={(e) => setNewCompetitorName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDraftCompetitor())}
                />
                <Btn variant="secondary" onClick={addDraftCompetitor}>Add</Btn>
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 0 }}>
              <Btn variant="primary" loading={savingCompetitors} onClick={saveDraftCompetitors}>Save</Btn>
              <Btn variant="secondary" loading={detecting} onClick={handleDetectCompetitors}>✦ Detect with AI instead</Btn>
              <Btn variant="ghost" onClick={() => setEditingCompetitors(false)}>Cancel</Btn>
            </div>
          </>
        )}

        {competitors?.length > 0 && !editingCompetitors && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {competitors.map((c, i) =>
                c.website ? (
                  <a key={i} href={c.website} target="_blank" rel="noreferrer" className="chip">{c.name} ↗</a>
                ) : (
                  <span key={i} className="chip">{c.name}</span>
                )
              )}
            </div>

            {loadingCompetitorNews && <LoadingSpinner label="Searching for competitor news…" />}

            {!loadingCompetitorNews && competitorNewsFetchedAt && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span className="hint">Updated {timeAgo(competitorNewsFetchedAt)}</span>
                <button
                  type="button"
                  className="link-btn"
                  style={{ fontSize: 12 }}
                  disabled={refreshingCompetitorNews}
                  onClick={refreshCompetitorNews}
                >
                  {refreshingCompetitorNews ? 'Refreshing…' : '↻ Refresh'}
                </button>
              </div>
            )}

            {!loadingCompetitorNews && competitorNews?.length === 0 && (
              <p className="hint">No recent news found for these brands.</p>
            )}
            {!loadingCompetitorNews &&
              competitorNews?.map((item, i) => (
                <NewsCard key={i} {...item} source={item.competitor ? `${item.competitor} · ${item.source}` : item.source} />
              ))}
          </>
        )}
      </Card>

      <div className="quick-row quick-row--3">
        <Link to="/generate" className="quick-card">
          <span className="quick-card__icon"><svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3M12 18v3M4.5 12h3M16.5 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2" /></svg></span>
          <h3>Generate media</h3>
          <p>Turn a purpose and a few assets into ready-to-use designs.</p>
        </Link>
        <Link to="/news" className="quick-card">
          <span className="quick-card__icon"><svg viewBox="0 0 24 24"><rect x="4" y="12" width="3" height="8" rx="0.5" /><rect x="10.5" y="8" width="3" height="12" rx="0.5" /><rect x="17" y="4" width="3" height="16" rx="0.5" /></svg></span>
          <h3>Industry news</h3>
          <p>See what&apos;s trending before you plan the next asset.</p>
        </Link>
        <Link to="/publish" className="quick-card">
          <span className="quick-card__icon"><svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0-4-4m4 4 4-4M5 19h14" /></svg></span>
          <h3>Publish queue</h3>
          <p>Review what&apos;s ready to send for approval or go live.</p>
        </Link>
      </div>

      <Card>
        <CardHead title="Recent assets" action={<Link to="/posts" className="btn btn-ghost">View all →</Link>} />
        {posts.length === 0 && <div className="empty-state">No assets yet — start with Generate Media.</div>}
        {posts.slice(0, 5).map((p) => {
          const badge = STATUS_BADGE[p.status] || STATUS_BADGE.draft;
          const designs = p.designs || [];
          const design = designs.find((d) => d.label === p.selectedVariantLabel) || designs[0];
          // Every image made for this creative, whether or not the user picked it: the picked design first, then the rest (de-duplicated).
          const seen = new Set();
          const images = [];
          const addImage = (url, label) => {
            if (url && !seen.has(url)) { seen.add(url); images.push({ url, label }); }
          };
          addImage(design?.imageUrl, design?.label);
          (design?.imageOptions || []).forEach((o) => addImage(o?.imageUrl, design?.label));
          designs.forEach((d) => { addImage(d.imageUrl, d.label); (d.imageOptions || []).forEach((o) => addImage(o?.imageUrl, d.label)); });
          const leadUrl = images[0]?.url || '';
          // A post that already has a generated image is not a draft any more: no "Draft" label on it.
          const showBadge = !(p.status === 'draft' && images.length > 0);
          const show = (img) =>
            openLightbox({
              src: img.url,
              formatId: p.mediums?.[0],
              title: design?.caption || p.purpose,
              meta: [
                { label: 'Platform', value: getFormat(p.mediums?.[0]).platform },
                { label: 'Purpose', value: p.purpose },
                ...(showBadge ? [{ label: 'Status', value: badge.label }] : [])
              ]
            });
          return (
            <div key={p._id}>
              <div className="post-row">
                <div
                  className="post-thumb"
                  style={{
                    ...(leadUrl ? { backgroundImage: `url(${resolveAssetUrl(leadUrl)})`, backgroundSize: 'cover' } : {}),
                    cursor: leadUrl ? 'zoom-in' : 'default'
                  }}
                  onClick={() => leadUrl && show(images[0])}
                />
                <div>
                  <p className="post-row__title">{design?.caption?.slice(0, 48) || p.purpose}</p>
                  <p className="post-row__meta">{getFormat(p.mediums?.[0]).platform} · {p.purpose}{images.length > 1 ? ` · ${images.length} designs` : ''}</p>
                </div>
                <div className="post-row__right">{showBadge && <span className={`badge ${badge.cls}`}>{badge.label}</span>}</div>
              </div>
              {images.length > 1 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 0 12px 0' }}>
                  {images.map((img, i) => (
                    <button
                      key={img.url}
                      type="button"
                      aria-label={`View design ${i + 1} of ${images.length}`}
                      title={i === 0 ? 'Design shown first' : `Design ${i + 1}`}
                      onClick={() => show(img)}
                      style={{
                        width: 64, height: 64, borderRadius: 8, border: i === 0 ? '2px solid var(--brand, #6C4CF1)' : '1px solid #DDE0EA',
                        padding: 0, cursor: 'zoom-in', background: `#F2F3F8 url(${resolveAssetUrl(img.url)}) center / cover no-repeat`
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </Layout>
  );
}

// Agency super admins get their own cross-customer dashboard instead of the workspace sections.
export default function Dashboard() {
  const { isAgency } = useAuth();
  return isAgency ? <AgencyDashboard /> : <WorkspaceDashboard />;
}
