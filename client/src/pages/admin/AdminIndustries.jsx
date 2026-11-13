import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout.jsx';
import Modal from '../../components/Modal.jsx';
import { Card, Btn, Field, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { adminApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';

export default function AdminIndustries() {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null closed, {} create, {...} edit

  function load() {
    setLoading(true);
    setError('');
    adminApi
      .listIndustries()
      .then(({ segments }) => setSegments(segments))
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleDelete(seg) {
    if (!window.confirm(`Delete industry segment "${seg.name}"? Users currently set to this industry will fall back to generic market data.`)) return;
    try {
      await adminApi.deleteIndustry(seg._id);
      load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }

  async function toggleActive(seg) {
    try {
      await adminApi.updateIndustry(seg._id, { active: !seg.active });
      load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }

  const grouped = segments.reduce((acc, s) => {
    (acc[s.group] = acc[s.group] || []).push(s);
    return acc;
  }, {});

  return (
    <Layout eyebrow="Admin" title="Industry Segments">
      <div className="page-lede"><p>Manage the industry list shown at registration, and the stock ticker + news data behind each one.</p></div>

      <ErrorText>{error}</ErrorText>

      <div className="btn-row" style={{ marginTop: 0, marginBottom: 16 }}>
        <Btn variant="primary" onClick={() => setEditing({})}>+ New segment</Btn>
      </div>

      {loading && <LoadingSpinner label="Loading industry segments…" />}

      {!loading && Object.entries(grouped).map(([group, items]) => (
        <Card key={group}>
          <div className="card__head"><h2>{group}</h2><span className="tag">{items.length}</span></div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Tickers</th>
                  <th>News items</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s._id}>
                    <td>{s.name}</td>
                    <td>{s.tickers?.length || 0}</td>
                    <td>{s.news?.length || 0}</td>
                    <td>
                      <span className={`status-dot status-dot--${s.active === false ? 'inactive' : 'active'}`} />
                      {s.active === false ? 'Hidden' : 'Active'}
                    </td>
                    <td>
                      <div className="row-actions">
                        <Btn variant="secondary" className="small-btn" onClick={() => toggleActive(s)}>
                          {s.active === false ? 'Unhide' : 'Hide'}
                        </Btn>
                        <Btn variant="secondary" className="small-btn" onClick={() => setEditing(s)}>Edit</Btn>
                        <Btn variant="secondary" className="small-btn" onClick={() => handleDelete(s)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {editing && (
        <SegmentFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </Layout>
  );
}

function SegmentFormModal({ initial, onClose, onSaved }) {
  const isCreate = !initial._id;
  const [name, setName] = useState(initial.name || '');
  const [group, setGroup] = useState(initial.group || 'Other');
  const [tickers, setTickers] = useState(initial.tickers?.length ? initial.tickers : []);
  const [news, setNews] = useState(initial.news?.length ? initial.news : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateTicker(i, field, value) {
    setTickers((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  }
  function addTicker() {
    setTickers((prev) => [...prev, { symbol: '', price: 0, change: 0 }]);
  }
  function removeTicker(i) {
    setTickers((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateNews(i, field, value) {
    setNews((prev) => prev.map((n, idx) => (idx === i ? { ...n, [field]: value } : n)));
  }
  function addNews() {
    setNews((prev) => [...prev, { title: '', desc: '', source: 'MARKET SCAN', time: 'RECENTLY', image: '', url: '' }]);
  }
  function removeNews(i) {
    setNews((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const cleanTickers = tickers
        .filter((t) => t.symbol?.trim())
        .map((t) => ({ symbol: t.symbol.trim().toUpperCase(), price: Number(t.price) || 0, change: Number(t.change) || 0 }));
      const cleanNews = news
        .filter((n) => n.title?.trim())
        .map((n) => ({
          title: n.title.trim(),
          desc: n.desc || '',
          source: n.source || 'MARKET SCAN',
          time: n.time || 'RECENTLY',
          image: n.image?.trim() || '',
          url: n.url?.trim() || ''
        }));

      if (isCreate) {
        await adminApi.createIndustry({ name, group, tickers: cleanTickers, news: cleanNews });
      } else {
        await adminApi.updateIndustry(initial._id, { name, group, tickers: cleanTickers, news: cleanNews });
      }
      onSaved();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isCreate ? 'New industry segment' : `Edit ${initial.name}`} onClose={onClose} width={640}>
      <form onSubmit={handleSubmit}>
        <ErrorText>{error}</ErrorText>

        <div className="grid-2">
          <Field label="Segment name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Group" hint="Used to organize the registration dropdown.">
            <input type="text" value={group} onChange={(e) => setGroup(e.target.value)} required />
          </Field>
        </div>

        <label style={{ fontSize: 12.5, fontWeight: 500, display: 'block', marginBottom: 6, marginTop: 4 }}>
          Stock tickers
        </label>
        {tickers.map((t, i) => (
          <div key={i} className="select-row" style={{ marginBottom: 8 }}>
            <input type="text" placeholder="Symbol" value={t.symbol} onChange={(e) => updateTicker(i, 'symbol', e.target.value)} style={{ width: 90, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }} />
            <input type="number" step="0.01" placeholder="Price" value={t.price} onChange={(e) => updateTicker(i, 'price', e.target.value)} style={{ width: 100, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }} />
            <input type="number" step="0.1" placeholder="% change" value={t.change} onChange={(e) => updateTicker(i, 'change', e.target.value)} style={{ width: 100, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }} />
            <button type="button" className="link-btn" onClick={() => removeTicker(i)}>✕</button>
          </div>
        ))}
        <div className="btn-row" style={{ marginTop: 0, marginBottom: 18 }}>
          <Btn variant="secondary" type="button" className="small-btn" onClick={addTicker}>+ Add ticker</Btn>
        </div>

        <label style={{ fontSize: 12.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>
          News items
        </label>
        {news.map((n, i) => (
          <Card key={i} style={{ marginBottom: 10, padding: 12 }}>
            <Field label="Title">
              <input type="text" value={n.title} onChange={(e) => updateNews(i, 'title', e.target.value)} />
            </Field>
            <Field label="Description">
              <textarea value={n.desc} onChange={(e) => updateNews(i, 'desc', e.target.value)} style={{ minHeight: 50 }} />
            </Field>
            <div className="grid-2">
              <Field label="Source">
                <input type="text" value={n.source} onChange={(e) => updateNews(i, 'source', e.target.value)} />
              </Field>
              <Field label="Time label">
                <input type="text" value={n.time} onChange={(e) => updateNews(i, 'time', e.target.value)} />
              </Field>
            </div>
            <Field label="Image URL" hint="Optional. Leave blank to show the default gradient thumbnail instead.">
              <div className="select-row" style={{ alignItems: 'center' }}>
                {n.image ? (
                  <img
                    src={n.image}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flex: 'none', border: '1px solid var(--line)' }}
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  />
                ) : null}
                <input type="url" placeholder="https://…" value={n.image || ''} onChange={(e) => updateNews(i, 'image', e.target.value)} style={{ flex: 1 }} />
              </div>
            </Field>
            <Field label="Source URL" hint="Optional. If set, this news item becomes clickable and opens the source in a new tab.">
              <input type="url" placeholder="https://…" value={n.url || ''} onChange={(e) => updateNews(i, 'url', e.target.value)} />
            </Field>
            <button type="button" className="link-btn" onClick={() => removeNews(i)}>Remove this item</button>
          </Card>
        ))}
        <div className="btn-row" style={{ marginTop: 0, marginBottom: 18 }}>
          <Btn variant="secondary" type="button" className="small-btn" onClick={addNews}>+ Add news item</Btn>
        </div>

        <div className="btn-row">
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" block loading={saving} type="submit">{isCreate ? 'Create segment' : 'Save changes'}</Btn>
        </div>
      </form>
    </Modal>
  );
}
