import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { Card } from '../components/ui.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { postsApi } from '../api/resources.js';
import { apiErrorMessage, resolveAssetUrl } from '../api/client.js';
import { getFormat } from '../constants/postFormats.js';
import '../styles/search.css';

const FLOW_NAMES = { new: 'New Creative', adaptation: 'Creative Edit', headline: 'Headline Switch', hero: 'Subject Swap', resize: 'Size Adapt', convert: 'Convert to Video' };
const STATUS_LABELS = { draft: 'Draft', in_review: 'In review', approved: 'Approved', published: 'Published' };

// Same landing rule as Saved Documents: where opening a document takes you.
function resumePath(post) {
  if (post.status === 'published') return '/publish';
  const selected = post.designs?.find((d) => d.label === post.selectedVariantLabel);
  if ((post.designs || []).some((d) => (d.imageOptions || []).filter((o) => o?.imageUrl).length > 1)) return '/designs';
  if (selected?.imageUrl) return '/refine';
  if ((post.designs?.length || 0) > 1) return '/designs';
  return '/generate';
}

const str = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : typeof v === 'string' ? v : '');

// Every searchable field of a document, labelled so the result can say where the match was found.
function fieldsOf(post) {
  const b = post.creativeBrief || {};
  const out = [
    ['Headline', b.headlineText],
    ['Sub-headline', b.subHeadlineText],
    ['Purpose', post.purpose],
    ['Brief', post.briefNote],
    ['Key message', b.primaryMessage],
    ['Must include', b.mustInclude],
    ['Must avoid', b.mustAvoid],
    ['Mood', b.moodTags],
    ['Style', b.styleReferences],
    ['Lighting', b.lightingStyle],
    ['Composition', b.compositionStyle]
  ];
  for (const d of post.designs || []) {
    out.push(['Post copy', d.caption], ['Direction', d.directionTitle], ['Idea', d.directionIdea]);
  }
  out.push(
    ['Platform', (post.mediums || []).map((m) => { const f = getFormat(m); return `${f.platform} ${f.label}`; }).join(', ')],
    ['Tool', FLOW_NAMES[post.creativeType]],
    ['Status', STATUS_LABELS[post.status]]
  );
  return out.map(([label, v]) => [label, str(v).trim()]).filter(([, v]) => v);
}

function snippet(text, terms) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; }
  const start = Math.max(0, at - 50);
  const slice = text.slice(start, start + 170);
  return (start > 0 ? '…' : '') + slice + (start + 170 < text.length ? '…' : '');
}

function Highlight({ text, terms }) {
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${esc.join('|')})`, 'gi'));
  return parts.map((p, i) => (terms.includes(p.toLowerCase()) ? <mark key={i}>{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>));
}

function searchPosts(posts, query) {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  if (!terms.length) return [];
  const results = [];
  for (const post of posts) {
    const fields = fieldsOf(post);
    const all = fields.map(([, v]) => v.toLowerCase()).join(' \n ');
    if (!terms.every((t) => all.includes(t))) continue; // every word must appear somewhere in the document
    const hits = [];
    const seen = new Set();
    for (const [label, v] of fields) {
      const l = v.toLowerCase();
      if (terms.some((t) => l.includes(t)) && !seen.has(l)) { seen.add(l); hits.push({ label, text: snippet(v, terms) }); }
    }
    // Score: headline / copy matches rank above incidental ones.
    const score = hits.reduce((n, h) => n + (['Headline', 'Sub-headline', 'Post copy'].includes(h.label) ? 3 : 1), 0);
    results.push({ post, hits: hits.slice(0, 4), score });
  }
  return results.sort((a, b) => b.score - a.score || new Date(b.post.updatedAt) - new Date(a.post.updatedAt));
}

export default function Search() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setPost } = useWorkflow();
  const q = (new URLSearchParams(location.search).get('q') || '').trim();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    postsApi.list().then(({ posts: p }) => setPosts(p)).catch((e) => setError(apiErrorMessage(e)));
  }, []);

  const terms = useMemo(() => [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))], [q]);
  const results = useMemo(() => (posts ? searchPosts(posts, q) : []), [posts, q]);

  function open(post) {
    setPost(post);
    navigate(resumePath(post));
  }

  return (
    <Layout eyebrow="Workspace" title="Search">
      {error && <p className="hint" style={{ color: '#C0273E' }}>{error}</p>}
      {!q && <div className="sr-empty">Type in the search box above to find a creative by its post copy, brief, headline, sub-headline, platform and more.</div>}
      {q && !posts && !error && <LoadingSpinner label="Searching…" />}
      {q && posts && (
        <>
          <p className="sr-meta">{results.length} {results.length === 1 ? 'result' : 'results'} for “{q}”</p>
          {results.length === 0 && <div className="sr-empty">Nothing matches “{q}”. Try fewer or different words.</div>}
          {results.map(({ post, hits }) => {
            const designs = post.designs || [];
            const design = designs.find((d) => d.label === post.selectedVariantLabel && d.imageUrl) || designs.find((d) => d.imageUrl) || designs[0];
            const thumb = design?.imageUrl || designs.flatMap((d) => d.imageOptions || []).find((o) => o?.imageUrl)?.imageUrl || '';
            const f = getFormat(post.mediums?.[0]);
            return (
              <div key={post._id} role="button" tabIndex={0} onClick={() => open(post)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(post)}>
              <Card className="sr-card post-card">
                <div className="sr-thumb" style={thumb ? { backgroundImage: `url(${resolveAssetUrl(thumb)})` } : undefined}>
                  {!thumb && <span className="hint">–</span>}
                </div>
                <div className="sr-body">
                  <div className="sr-head">
                    <h3 className="sr-title">{post.purpose}</h3>
                    <span className="sr-date">{new Date(post.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                  <p className="sr-sub">{FLOW_NAMES[post.creativeType] || 'Creative'} · {f.platform} {f.label} · {STATUS_LABELS[post.status] || post.status}</p>
                  {hits.map((h) => (
                    <p className="sr-hit" key={h.label + h.text}><b>{h.label}</b><Highlight text={h.text} terms={terms} /></p>
                  ))}
                </div>
              </Card>
              </div>
            );
          })}
        </>
      )}
    </Layout>
  );
}
