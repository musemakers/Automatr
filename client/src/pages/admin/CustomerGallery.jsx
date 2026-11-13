import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../../components/Layout.jsx';
import Modal from '../../components/Modal.jsx';
import { Card, Btn, ErrorText } from '../../components/ui.jsx';
import { useCustomerScope } from '../../utils/useCustomerScope.js';
import { brandAssetsApi } from '../../api/resources.js';
import { apiErrorMessage, resolveAssetUrl, downloadFile } from '../../api/client.js';

// Super admin: every image and video generated for one customer, opened straight from Customers -> Gallery.
export default function CustomerGallery() {
  const { customerId } = useParams();
  const { customer, ready, error: scopeError } = useCustomerScope(customerId);
  const [error, setError] = useState('');

  const name = customer?.name || '';
  return (
    <Layout eyebrow="Customers" title={name ? `Gallery · ${name}` : 'Gallery'}>
      <div style={{ marginBottom: 10 }}>
        <Link to="/admin/customers" className="link-btn">← All customers</Link>
      </div>
      <ErrorText>{error || scopeError}</ErrorText>
      {ready ? <GalleryGrid customerName={name} setError={setError} /> : !scopeError && <div className="empty-state">Loading the gallery…</div>}
    </Layout>
  );
}

// Every image and video generated in this customer's workspace, newest first.
function GalleryGrid({ customerName, setError }) {
  const [items, setItems] = useState(null);
  const [type, setType] = useState('all'); // all | image | video
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const PAGE_SIZE = 24;

  useEffect(() => {
    let alive = true;
    brandAssetsApi.gallery().then((r) => { if (alive) setItems(r.items || []); }).catch((e) => { if (alive) { setItems([]); setError(apiErrorMessage(e)); } });
    return () => { alive = false; };
  }, [customerName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items) return <Card><p className="hint">Loading the gallery…</p></Card>;
  const images = items.filter((i) => i.type === 'image').length;
  const videos = items.length - images;
  const list = items.filter((i) => type === 'all' || i.type === type);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const go = (n) => { setPage(Math.min(pages, Math.max(1, n))); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* no DOM */ } };
  const day = (iso) => { try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  // 1 … 4 5 [6] 7 8 … 20
  const nums = [...new Set([1, pages, safePage - 2, safePage - 1, safePage, safePage + 1, safePage + 2].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Gallery</h2>
        <span className="tag">{images} image{images === 1 ? '' : 's'} · {videos} video{videos === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        {[['all', 'All'], ['image', 'Images'], ['video', 'Videos']].map(([id, label]) => (
          <button key={id} type="button" className={`chip ${type === id ? 'chip--on is-on selected' : ''}`.trim()} onClick={() => { setType(id); setPage(1); }}>{label}</button>
        ))}
      </div>
      <div className="asset-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {list.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}>Nothing generated yet{type !== 'all' ? ` (${type}s)` : ''}.</div>}
        {list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE).map((i) => (
          <div className="asset-tile" key={i.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(i)}>
            <div className="asset-tile__swatch" style={{ position: 'relative', aspectRatio: '1 / 1', overflow: 'hidden', background: '#0F1220' }}>
              {i.type === 'video' ? (
                <>
                  <video src={`${resolveAssetUrl(i.url)}#t=0.1`} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <span className="asset-tile__pdf-badge">VIDEO</span>
                </>
              ) : (
                <img src={resolveAssetUrl(i.url)} alt={i.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>
            <p title={i.title}>{i.title}</p>
            <p className="small" style={{ opacity: 0.65 }}>{i.source} · {day(i.at)}</p>
          </div>
        ))}
      </div>
      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 18 }}>
          <Btn variant="secondary" className="small-btn" disabled={safePage === 1} onClick={() => go(safePage - 1)}>← Previous</Btn>
          {nums.map((n, idx) => (
            <React.Fragment key={n}>
              {idx > 0 && n - nums[idx - 1] > 1 && <span className="hint" style={{ margin: 0 }}>…</span>}
              <button type="button" className={`chip ${n === safePage ? 'chip--on is-on selected' : ''}`.trim()} aria-current={n === safePage ? 'page' : undefined} onClick={() => go(n)}>{n}</button>
            </React.Fragment>
          ))}
          <Btn variant="secondary" className="small-btn" disabled={safePage === pages} onClick={() => go(safePage + 1)}>Next →</Btn>
        </div>
      )}
      {list.length > 0 && <p className="hint" style={{ textAlign: 'center', marginTop: 8 }}>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, list.length)} of {list.length}</p>}
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)} width={760}>
          <div className="asset-preview">
            {open.type === 'video'
              ? <video src={resolveAssetUrl(open.url)} controls autoPlay style={{ width: '100%', maxHeight: '70vh', borderRadius: 8, background: '#000' }} />
              : <img className="asset-preview__image" src={resolveAssetUrl(open.url)} alt={open.title} />}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>{open.source} · {day(open.at)}</p>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <a className="btn btn-secondary" href={resolveAssetUrl(open.url)} target="_blank" rel="noopener noreferrer">Open in new tab</a>
            <Btn variant="secondary" onClick={() => downloadFile(resolveAssetUrl(open.url), `${open.title || 'asset'}.${open.type === 'video' ? 'mp4' : 'png'}`).catch(() => setError('Could not download this file.'))}>Download</Btn>
          </div>
        </Modal>
      )}
    </Card>
  );
}

