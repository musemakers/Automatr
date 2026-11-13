import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.jsx';
import Modal from '../../components/Modal.jsx';
import { Card, Btn, Field, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { adminApi, authApi } from '../../api/resources.js';
import { apiErrorMessage, CUSTOMER_KEY } from '../../api/client.js';
import IndustrySelect from '../../components/IndustrySelect.jsx';

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
// Costs are logged in US$; show rupees using the rate saved in Admin -> Usage Estimator (same as the dashboard).
const inr = (usdAmount, rate) => {
  const n = (Number(usdAmount) || 0) * rate;
  if (n === 0) return '₹0';
  if (n < 0.01) return '<₹0.01';
  return `₹${n.toLocaleString('en-IN', n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
const slugify = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const fmtBytes = (b) => {
  if (!b) return '0 MB';
  const mb = b / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
};

export default function AdminCustomers() {
  const { customer: current } = useAuth();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [fxRate, setFxRate] = useState(0); // ₹ per US$; 0 = not available, fall back to US$
  const [storage, setStorage] = useState(null);
  const [emailReady, setEmailReady] = useState(false);
  const [industries, setIndustries] = useState([]);
  const [industryGroups, setIndustryGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // null | { } (create) | customer (edit)
  const [created, setCreated] = useState(null); // { name, email, temporaryPassword }
  const [userModal, setUserModal] = useState(null); // customer to add a user to
  const [topUpModal, setTopUpModal] = useState(null); // customer to top up
  const [historyModal, setHistoryModal] = useState(null); // customer whose top-up history is open
  const [deleteModal, setDeleteModal] = useState(null); // customer to delete
  const [backupModal, setBackupModal] = useState(null); // customer to back up
  const [backupsOpen, setBackupsOpen] = useState(false); // saved backups / import

  function load() {
    setLoading(true);
    setError('');
    adminApi
      .listCustomers()
      .then(({ customers, storage, email }) => {
        setCustomers(customers);
        setStorage(storage);
        setEmailReady(Boolean(email?.configured));
      })
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    authApi.industries().then(({ industries, groups }) => { setIndustries([...(industries || [])].sort(alpha)); setIndustryGroups(sortGroups(groups)); }).catch(() => {});
    adminApi
      .getEstimator()
      .then((c) => {
        const r = Number(c?.fx?.usdToInr);
        if (Number.isFinite(r) && r > 0) setFxRate(r);
      })
      .catch(() => {});
  }, []);

  const currentId = current?._id || current?.id;

  // Brand assets and Gallery open for that customer without switching the super admin into their workspace.
  const openBrandAssets = (c, page = 'brand') => navigate(`/admin/customers/${c._id}/${page}`);

  return (
    <Layout eyebrow="Admin" title="Customers">
      <div className="page-lede">
        <p>
          Each customer gets its own workspace: brand library, model settings, social accounts, team, storage folder and delivery
          destination. Nothing is shared between customers.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>
      {storage && storage.persistent === false && (
        <div className="notice notice--warn">
          File storage is not on a persistent volume, so customer files are deleted on every redeploy. Attach a volume before onboarding customers.
        </div>
      )}
      {created && (
        <div className="notice notice--ok">
          <strong>{created.name}</strong>{' '}
          {created.deleted
            ? <>was deleted.{created.deleted.backup ? <> Backup saved as <strong>{created.deleted.backup.file}</strong> (see Backups &amp; import).</> : ' No backup was made.'} {created.deleted.downloadError}</>
            : created.imported
              ? <>was restored{created.imported.renamed ? <> as <strong>{created.imported.customer.slug}</strong> (the original name was in use)</> : ''}: {created.imported.restored.users} users, {created.imported.restored.posts} posts, {created.imported.restored.brandAssets} brand assets, {created.imported.files} files.{created.imported.skippedUsers.length ? <> Skipped existing users: {created.imported.skippedUsers.join(', ')}.</> : ''}</>
              : created.limitsChanged ? `had its limits updated: ${created.limitsChanged}.` : created.userOnly ? 'now has a new user.' : 'was created.'}
          {created.email && (
            <>
              {' '}Their admin <strong>{created.email}</strong>
              {created.temporaryPassword ? (
                <> can sign in with the temporary password <strong className="mono">{created.temporaryPassword}</strong> — share it directly; it won&apos;t be shown again.</>
              ) : (
                <> can sign in with the password you set.</>
              )}
            </>
          )}
          {created.invite?.sent && <> A welcome email with the login details was sent to <strong>{created.email}</strong>.</>}
          {created.invite && !created.invite.sent && (
            <> <strong>The welcome email could not be sent</strong> ({created.invite.error}) - share the login details yourself.</>
          )}
        </div>
      )}

      <Card>
        <div className="toolbar">
          <span className="hint" style={{ margin: 0 }}>{customers.length} customer{customers.length === 1 ? '' : 's'}</span>
          <div className="row-actions">
            <Btn variant="secondary" onClick={() => setBackupsOpen(true)}>Backups &amp; import</Btn>
            <Btn variant="primary" onClick={() => { setCreated(null); setModal({}); }}>+ New customer</Btn>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>Team</th>
                <th>Assets</th>
                <th>AI spend (month)</th>
                <th>Images / videos this month</th>
                <th>Storage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8}><LoadingSpinner label="Loading customers…" /></td></tr>}
              {!loading && customers.length === 0 && <tr><td colSpan={8}><div className="empty-state">No customers yet.</div></td></tr>}
              {!loading && customers.map((c) => (
                <tr key={c._id}>
                  <td>
                    <strong>{c.name}</strong>
                    <div className="mono" style={{ color: 'var(--muted)' }}>customers/{c.storage?.folder}</div>
                  </td>
                  <td><span className={`status-pill status-pill--${c.status}`}>{c.status}</span></td>
                  <td>{c.counts?.users ?? 0}</td>
                  <td>{c.counts?.posts ?? 0}</td>
                  <td>
                    {fxRate ? inr(c.monthCostUsd, fxRate) : usd(c.monthCostUsd)}
                    {fxRate > 0 && <div className="hint" style={{ margin: 0 }}>{usd(c.monthCostUsd)}</div>}
                  </td>
                  <td className="mono">
                    {c.generation ? (
                      <>
                        <div title="Generations the customer sees (completed creatives)">Customer: {c.generation.customerGenerations.images.used}/{c.generation.customerGenerations.images.limit ?? '∞'} img · {c.generation.customerGenerations.videos.used}/{c.generation.customerGenerations.videos.limit ?? '∞'} vid</div>
                        <div title="Real AI images / videos made (enforced)">AI: {c.generation.images.used}/{c.generation.images.limit ?? '∞'} img · {c.generation.videos.used}/{c.generation.videos.limit ?? '∞'} vid</div>
                      </>
                    ) : '—'}
                    {c.generation && (c.generation.images.topUp > 0 || c.generation.videos.topUp > 0) && (
                      <div className="hint" style={{ margin: 0 }}>
                        incl. top-up {[c.generation.images.topUp > 0 && `+${c.generation.images.topUp} img`, c.generation.videos.topUp > 0 && `+${c.generation.videos.topUp} vid`].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {c.generation && (c.generation.plan === 'one_time'
                      ? <div className="hint" style={{ margin: 0 }}>One-time package · no renewal</div>
                      : <div className="hint" style={{ margin: 0 }}>Monthly · renews {new Date(c.generation.cycleEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>)}
                  </td>
                  <td className="mono">
                    {c.storageUsage ? (() => {
                      const { usedBytes, limitBytes } = c.storageUsage;
                      const pct = limitBytes ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
                      return (
                        <>
                          {fmtBytes(usedBytes)} / {fmtBytes(limitBytes)}
                          <div style={{ height: 5, borderRadius: 3, background: '#E9EBF2', marginTop: 4, overflow: 'hidden', minWidth: 90 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? '#C62828' : pct >= 75 ? '#B26A00' : 'var(--blue)' }} />
                          </div>
                          <div className="hint" style={{ margin: 0 }}>{pct}% used</div>
                        </>
                      );
                    })() : '—'}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Btn variant="secondary" className="small-btn" onClick={() => openBrandAssets(c)}>Brand assets</Btn>
                      <Btn variant="secondary" className="small-btn" onClick={() => openBrandAssets(c, 'gallery')}>Gallery</Btn>
                      <Btn variant="secondary" className="small-btn" onClick={() => { setCreated(null); setTopUpModal(c); }}>Modify limits</Btn>
                      <Btn variant="secondary" className="small-btn" onClick={() => setHistoryModal(c)}>Limits history</Btn>
                      <Btn variant="secondary" className="small-btn" onClick={() => { setCreated(null); setUserModal(c); }}>+ User</Btn>
                      <Btn variant="secondary" className="small-btn" onClick={() => { setCreated(null); setModal(c); }}>Edit</Btn>
                      <Btn variant="secondary" className="small-btn" onClick={() => setBackupModal(c)}>Back up</Btn>
                      {customers.length > 1 && <Btn variant="secondary" className="small-btn" style={{ color: '#c62828' }} onClick={() => setDeleteModal(c)}>Delete</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Use <strong>Brand assets</strong> to manage a customer&apos;s brand guide and files.
        </p>
      </Card>

      {userModal && (
        <UserModal
          customer={userModal}
          emailReady={emailReady}
          onClose={() => setUserModal(null)}
          onSaved={(result) => {
            setUserModal(null);
            setCreated({ name: userModal.name, email: result.email, temporaryPassword: result.temporaryPassword, invite: result.invite, userOnly: true });
            load();
          }}
        />
      )}

      {topUpModal && (
        <LimitsModal
          customer={topUpModal}
          onClose={() => setTopUpModal(null)}
          onSaved={(summary) => {
            const name = topUpModal.name;
            setTopUpModal(null);
            setCreated({ name, limitsChanged: summary });
            load();
          }}
        />
      )}

      {historyModal && <LimitsHistoryModal customer={historyModal} onClose={() => setHistoryModal(null)} />}

      {backupModal && (
        <BackupModal customer={backupModal} onClose={() => setBackupModal(null)} />
      )}

      {deleteModal && (
        <DeleteModal
          customer={deleteModal}
          onClose={() => setDeleteModal(null)}
          onDeleted={(summary) => {
            const id = deleteModal._id;
            setDeleteModal(null);
            setCreated({ name: deleteModal.name, deleted: summary });
            // If this was the workspace the agency admin had open, drop it and reload so the app picks another.
            try { if (localStorage.getItem(CUSTOMER_KEY) === String(id)) { localStorage.removeItem(CUSTOMER_KEY); window.location.reload(); return; } } catch { /* ignore */ }
            load();
          }}
        />
      )}

      {backupsOpen && (
        <BackupsModal
          onClose={() => setBackupsOpen(false)}
          onImported={(summary) => { setBackupsOpen(false); setCreated({ name: summary.customer.name, imported: summary }); load(); }}
        />
      )}

      {modal && (
        <CustomerModal
          initial={modal}
          industries={industries}
          industryGroups={industryGroups}
          emailReady={emailReady}
          onClose={() => setModal(null)}
          onSaved={(result) => {
            setModal(null);
            if (result) setCreated(result);
            load();
          }}
        />
      )}
    </Layout>
  );
}

function InviteToggle({ checked, onChange, emailReady, disabled }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="perm-row" style={{ marginBottom: 2, opacity: disabled ? 0.55 : 1 }}>
        <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        Invite by email — send a welcome message with login details
      </label>
      <p className="hint" style={{ margin: 0 }}>
        {disabled
          ? 'Enter an admin email above to enable this.'
          : checked && !emailReady
            ? 'Email isn\u2019t set up yet: add the SMTP_* values to server/.env and restart. The account will still be created and you\u2019ll get the password here.'
            : 'Off by default. When on, the user gets an email with the sign-in link, their email and their password.'}
      </p>
    </div>
  );
}

const limitText = (v) => (v === null || v === undefined ? 'not set' : String(v));

// Super admin: set all four generation limits in one place (same fields as the customer's details). Empty = no figure / unlimited.
function LimitsModal({ customer, onClose, onSaved }) {
  const g = customer.generation;
  const oneTime = g?.plan === 'one_time' || customer.plan?.type === 'one_time';
  const L = customer.limits || {};
  const init = (v) => (v === null || v === undefined ? '' : String(v));
  const [form, setForm] = useState({
    imageGenerationsPerMonth: init(L.imageGenerationsPerMonth),
    videoGenerationsPerMonth: init(L.videoGenerationsPerMonth),
    imagesPerMonth: init(L.imagesPerMonth),
    videosPerMonth: init(L.videosPerMonth),
    note: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const per = oneTime ? '(package total)' : '/ month';
  const used = (m) => `Used so far: ${m?.used ?? 0}`;
  const dirty = ['imageGenerationsPerMonth', 'videoGenerationsPerMonth', 'imagesPerMonth', 'videosPerMonth'].some((k) => form[k] !== init(L[k]));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { note: form.note };
      for (const k of ['imageGenerationsPerMonth', 'videoGenerationsPerMonth', 'imagesPerMonth', 'videosPerMonth']) payload[k] = form[k] === '' ? null : Number(form[k]);
      const res = await adminApi.modifyLimits(customer._id, payload);
      onSaved((res.changes || []).map((c) => `${c.label} ${limitText(c.from)} → ${limitText(c.to)}`).join(', '));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Modify limits - ${customer.name}`} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <ErrorText>{error}</ErrorText>
        <p className="hint" style={{ marginTop: 0 }}>
          {oneTime
            ? 'One-time package: these are single totals that never renew.'
            : 'Monthly: these renew every month.'}{' '}
          Two figures are kept side by side: what the customer sees as generated (one per completed creative) and the real AI images / videos behind them. Only the AI limit is enforced. Every change is saved in <strong>Limits history</strong>.
        </p>
        <div className="grid-2">
          <Field label={`Customer generations: images ${per}`} hint={`${used(g?.customerGenerations?.images)}. Empty = no figure.`}>
            <input type="number" min="0" step="1" value={form.imageGenerationsPerMonth} onChange={(e) => set('imageGenerationsPerMonth', e.target.value)} placeholder="Not set" />
          </Field>
          <Field label={`Customer generations: videos ${per}`} hint={`${used(g?.customerGenerations?.videos)}. Empty = no figure.`}>
            <input type="number" min="0" step="1" value={form.videoGenerationsPerMonth} onChange={(e) => set('videoGenerationsPerMonth', e.target.value)} placeholder="Not set" />
          </Field>
          <Field label={`AI images ${per} (enforced)`} hint={`${used(g?.images)}. Empty = unlimited.`}>
            <input type="number" min="0" step="1" value={form.imagesPerMonth} onChange={(e) => set('imagesPerMonth', e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label={`AI videos ${per} (enforced)`} hint={`${used(g?.videos)}. Empty = unlimited.`}>
            <input type="number" min="0" step="1" value={form.videosPerMonth} onChange={(e) => set('videosPerMonth', e.target.value)} placeholder="Unlimited" />
          </Field>
        </div>
        {(g?.images?.topUp > 0 || g?.videos?.topUp > 0) && (
          <p className="hint" style={{ margin: '0 0 10px' }}>
            Earlier top-ups still count this {oneTime ? 'package' : 'cycle'}: {[g.images.topUp > 0 && `+${g.images.topUp} AI images`, g.videos.topUp > 0 && `+${g.videos.topUp} AI videos`].filter(Boolean).join(' · ')}.
          </p>
        )}
        <Field label="Note (optional)" hint="Shown in the limits history, e.g. the invoice or reason.">
          <input type="text" maxLength={200} value={form.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
        <div className="btn-row">
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" block loading={saving} type="submit" disabled={!dirty}>Save limits</Btn>
        </div>
      </form>
    </Modal>
  );
}

function UserModal({ customer, emailReady, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'customerAdmin', password: '', sendInvite: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await adminApi.createCustomerUser(customer._id, { ...form, password: form.password || undefined });
      onSaved({ email: res.user.email, temporaryPassword: res.temporaryPassword, invite: res.invite });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Add user to ${customer.name}`} onClose={onClose} width={480}>
      <form onSubmit={submit}>
        <ErrorText>{error}</ErrorText>
        <Field label="Name"><input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
        <Field label="Email"><input type="text" value={form.email} onChange={(e) => set('email', e.target.value)} required /></Field>
        <Field label="Role" hint="Customer admins manage this customer's team, settings, library and delivery. Members work on their own assets.">
          <select value={form.role} onChange={(e) => set('role', e.target.value)}>
            <option value="customerAdmin">Customer admin</option>
            <option value="member">Member</option>
          </select>
        </Field>
        <Field label="Password (optional — auto-generated if blank)" hint="At least 8 characters.">
          <input type="text" value={form.password} onChange={(e) => set('password', e.target.value)} />
        </Field>
        <InviteToggle checked={form.sendInvite} onChange={(v) => set('sendInvite', v)} emailReady={emailReady} />
        <div className="btn-row">
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" block loading={saving} type="submit">Add user</Btn>
        </div>
      </form>
    </Modal>
  );
}

/** Countries offered when creating / editing a customer (optional; blank = not specified). */
const COUNTRIES = ["Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica", "Côte d'Ivoire", "Croatia", "Cuba", "Cyprus", "Czechia", "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Macao", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"];
const alpha = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
/** Industry segment groups and the segments inside each, always in alphabetical order. */
const sortGroups = (groups) => (groups || []).map((g) => ({ ...g, items: [...(g.items || [])].sort(alpha) })).sort((a, b) => alpha(a.group, b.group));

function CustomerModal({ initial, industries, industryGroups = [], emailReady, onClose, onSaved }) {
  const isCreate = !initial._id;
  const [form, setForm] = useState({
    name: initial.name || '',
    folder: initial.storage?.folder || '',
    folderTouched: false,
    industry: initial.industry || industryGroups[0]?.items?.[0] || industries[0] || 'Technology',
    country: initial.country || '',
    plan: initial.plan?.type || 'monthly',
    notes: initial.notes || '',
    status: initial.status || 'active',
    budget: initial.budget?.monthlyUsd ?? '',
    enforce: Boolean(initial.budget?.enforce),
    imageGenerationsPerMonth: initial.limits?.imageGenerationsPerMonth ?? '',
    videoGenerationsPerMonth: initial.limits?.videoGenerationsPerMonth ?? '',
    imagesPerMonth: initial.limits?.imagesPerMonth ?? '',
    videosPerMonth: initial.limits?.videosPerMonth ?? '',
    storageMb: initial.limits?.storageMb ?? 1024,
    billboards: Boolean(initial.features?.billboards),
    multiSceneVideo: Boolean(initial.features?.multiSceneVideo),
    preciseFontText: Boolean(initial.features?.preciseFontText),
    designOptions: [1, 2, 3].includes(Number(initial.features?.designOptions)) ? Number(initial.features.designOptions) : 1,
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    sendInvite: false
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const limitsPayload = {
        imageGenerationsPerMonth: form.imageGenerationsPerMonth === '' ? null : Number(form.imageGenerationsPerMonth),
        videoGenerationsPerMonth: form.videoGenerationsPerMonth === '' ? null : Number(form.videoGenerationsPerMonth),
        imagesPerMonth: form.imagesPerMonth === '' ? null : Number(form.imagesPerMonth),
        videosPerMonth: form.videosPerMonth === '' ? null : Number(form.videosPerMonth),
        storageMb: form.storageMb === '' ? null : Number(form.storageMb)
      };
      if (isCreate) {
        const res = await adminApi.createCustomer({
          name: form.name,
          slug: form.folder || undefined,
          industry: form.industry,
          country: form.country,
          notes: form.notes,
          plan: { type: form.plan },
          limits: limitsPayload,
          features: { billboards: form.billboards, multiSceneVideo: form.multiSceneVideo, preciseFontText: form.preciseFontText, designOptions: Number(form.designOptions) || 1 },
          admin: form.adminEmail ? { name: form.adminName, email: form.adminEmail, password: form.adminPassword || undefined } : undefined,
          sendInvite: Boolean(form.adminEmail && form.sendInvite)
        });
        onSaved({ name: res.customer.name, email: res.admin?.email, temporaryPassword: res.temporaryPassword, invite: res.invite });
      } else {
        await adminApi.updateCustomer(initial._id, {
          name: form.name,
          status: form.status,
          industry: form.industry,
          country: form.country,
          notes: form.notes,
          budget: { monthlyUsd: form.budget === '' ? null : Number(form.budget), enforce: form.enforce },
          plan: { type: form.plan },
          limits: limitsPayload,
          features: { billboards: form.billboards, multiSceneVideo: form.multiSceneVideo, preciseFontText: form.preciseFontText, designOptions: Number(form.designOptions) || 1 }
        });
        onSaved();
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isCreate ? 'New customer' : `Edit ${initial.name}`} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <ErrorText>{error}</ErrorText>

        <Field label="Customer name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name, folder: isCreate && !f.folderTouched ? slugify(name) : f.folder }));
            }}
            required
          />
        </Field>

        <Field
          label="Storage folder"
          hint={isCreate ? 'All of this customer’s files are saved in customers/<folder>. It can’t be changed later.' : 'Fixed when the customer was created.'}
        >
          <input
            type="text"
            value={form.folder}
            disabled={!isCreate}
            onChange={(e) => setForm((f) => ({ ...f, folder: slugify(e.target.value), folderTouched: true }))}
            placeholder="e.g. acme-foods"
          />
        </Field>

        <div className="grid-2">
          <Field label="Industry segment" hint="Drives the news feed and stock ticker for this customer.">
            <IndustrySelect
              value={form.industry}
              groups={industryGroups.length > 0 && form.industry && !industryGroups.some((g) => g.items.includes(form.industry))
                ? [{ group: 'Current', items: [form.industry] }, ...industryGroups]
                : industryGroups}
              items={[...new Set([form.industry, ...industries].filter(Boolean))].sort(alpha)}
              onChange={(v) => set('industry', v)}
            />
          </Field>
          {!isCreate && (
            <Field label="Status" hint="Suspended or archived customers can't sign in.">
              <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          )}
        </div>

        <Field label="Country (optional)" hint="Used to find competitors in the right market. If left empty, competitor detection looks for India-based competitors.">
          <select value={form.country} onChange={(e) => set('country', e.target.value)}>
            <option value="">Not specified</option>
            {[...new Set([form.country, ...COUNTRIES])].filter(Boolean).sort(alpha).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>

        <Field label="Internal notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {!isCreate && (
          <>
            <Field label="Monthly AI budget (USD)" hint="Leave empty for no limit. Based on estimated cost of generations this calendar month.">
              <input type="number" min="0" step="1" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
            </Field>
            <label className="perm-row" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={form.enforce} onChange={(e) => set('enforce', e.target.checked)} />
              Stop new generations once the budget is reached
            </label>
          </>
        )}

        <label style={{ fontSize: 12.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>Plan type</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          {[['monthly', 'Monthly'], ['one_time', 'One-time package']].map(([v, l]) => (
            <button type="button" key={v} onClick={() => set('plan', v)} className={form.plan === v ? 'btn btn-primary small-btn' : 'btn btn-secondary small-btn'}>{l}</button>
          ))}
        </div>
        <p className="hint" style={{ margin: '0 0 12px' }}>
          {form.plan === 'one_time'
            ? 'One-time package: the limits below are a single total that never renews. Top up to add more.'
            : 'Monthly: the limits below renew every month.'}
          {!isCreate && initial.plan?.type !== form.plan && form.plan === 'one_time' ? ' Switching starts a fresh package from today (usage counts from zero).' : ''}
          {!isCreate && initial.plan?.type !== form.plan && form.plan === 'monthly' ? ' Switching back to monthly resumes the monthly cycle.' : ''}
        </p>
        <label style={{ fontSize: 12.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>Features</label>
        <p className="hint" style={{ margin: '0 0 8px' }}>These are off unless you tick them. Customers only see the options you switch on.</p>
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {[
            ['billboards', 'Billboards', 'Adds the Billboards group to the size picker and the billboard print-file download.'],
            ['multiSceneVideo', 'Multi-scene Video', 'Adds Made for You, where the customer plans and makes a video scene by scene.'],
            ['preciseFontText', 'Precise font text', 'New Creative headlines and sub-headlines are set with the exact brand font files, placed by the AI over a text-free image, instead of being drawn by the image model. Letterforms are exact; adds one small AI layout call per design. Latin-script text only (other scripts keep AI-drawn text). Off by default.']
          ].map(([key, title, text]) => (
            <label key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid #DCDFE8', borderRadius: 10, cursor: 'pointer', background: form[key] ? '#F4F3FF' : '#fff' }}>
              <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} style={{ marginTop: 3 }} />
              <span><strong style={{ fontSize: 13.5 }}>{title}</strong><br /><span className="hint" style={{ margin: 0 }}>{text}</span></span>
            </label>
          ))}
        </div>
        <label style={{ fontSize: 12.5, fontWeight: 500, display: 'block', marginBottom: 6 }} htmlFor="cust-design-options">Design options per creative</label>
        <p className="hint" style={{ margin: '0 0 8px' }}>How many designs the customer gets to choose from each time they generate (New Creative). More designs means more AI images used per creative. One is the default.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }} role="radiogroup" aria-label="Design options per creative">
          {[1, 2, 3].map((n) => (
            <label key={n} style={{ flex: 1, textAlign: 'center', padding: '10px 12px', border: `1px solid ${Number(form.designOptions) === n ? '#4F46E5' : '#DCDFE8'}`, borderRadius: 10, cursor: 'pointer', background: Number(form.designOptions) === n ? '#F4F3FF' : '#fff', fontSize: 13.5, fontWeight: 600 }}>
              <input id={n === 1 ? 'cust-design-options' : undefined} type="radio" name="designOptions" value={n} checked={Number(form.designOptions) === n} onChange={() => set('designOptions', n)} style={{ marginRight: 8 }} />
              {n} {n === 1 ? 'design' : 'designs'}
            </label>
          ))}
        </div>
        <label style={{ fontSize: 12.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>Generation limits</label>
        <p className="hint" style={{ margin: '0 0 8px' }}>Two figures are kept side by side: what the customer sees as generated (one per completed creative) and the real AI images / videos behind them. Only the AI limit is enforced.</p>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <Field label={`Customer generations: images ${form.plan === 'one_time' ? '(package total)' : '/ month'}`} hint={initial._id && initial.generation ? `Used so far: ${initial.generation.customerGenerations?.images?.used ?? 0}. Empty = no figure.` : 'Completed creatives the customer sees. Empty = no figure.'}>
            <input type="number" min="0" step="1" value={form.imageGenerationsPerMonth} onChange={(e) => set('imageGenerationsPerMonth', e.target.value)} placeholder="Not set" />
          </Field>
          <Field label={`Customer generations: videos ${form.plan === 'one_time' ? '(package total)' : '/ month'}`} hint={initial._id && initial.generation ? `Used so far: ${initial.generation.customerGenerations?.videos?.used ?? 0}. Empty = no figure.` : 'Completed creatives the customer sees. Empty = no figure.'}>
            <input type="number" min="0" step="1" value={form.videoGenerationsPerMonth} onChange={(e) => set('videoGenerationsPerMonth', e.target.value)} placeholder="Not set" />
          </Field>
          <Field label="AI images / month (enforced)" hint={initial._id && initial.generation ? `Used so far: ${initial.generation.images?.used ?? 0}. Empty = unlimited.` : 'Real images the AI makes. Empty = unlimited.'}>
            <input type="number" min="0" step="1" value={form.imagesPerMonth} onChange={(e) => set('imagesPerMonth', e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label="AI videos / month (enforced)" hint={initial._id && initial.generation ? `Used so far: ${initial.generation.videos?.used ?? 0}. Empty = unlimited.` : 'Real videos the AI makes. Empty = unlimited.'}>
            <input type="number" min="0" step="1" value={form.videosPerMonth} onChange={(e) => set('videosPerMonth', e.target.value)} placeholder="Unlimited" />
          </Field>
        </div>
        <Field label="Storage quota (MB)" hint="1024 MB = 1 GB (default). Shown on the customer's Saved Documents page.">
          <input type="number" min="1" step="1" value={form.storageMb} onChange={(e) => set('storageMb', e.target.value)} placeholder="1024" />
        </Field>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          {form.plan === 'one_time' ? 'The package is counted from the day it is set up and never renews.' : <>The month starts on the day this customer was created{initial.createdAt ? ` (the ${ordinal(new Date(initial.createdAt).getUTCDate())} of each month)` : ' (counted from the day you create it)'}.</>} Agency admins are never limited and don't use up the customer&apos;s allowance.
        </p>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          When "agency only" is on, this customer&apos;s own admin and team can&apos;t generate or edit with AI images / videos; agency admins still can.
        </p>

        {isCreate && (
          <>
            <label style={{ fontSize: 12.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>First customer admin (optional)</label>
            <div className="grid-2">
              <Field label="Name"><input type="text" value={form.adminName} onChange={(e) => set('adminName', e.target.value)} /></Field>
              <Field label="Email"><input type="text" value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} /></Field>
            </div>
            <Field label="Password (optional — auto-generated if blank)">
              <input type="text" value={form.adminPassword} onChange={(e) => set('adminPassword', e.target.value)} />
            </Field>
            <InviteToggle checked={form.sendInvite} onChange={(v) => set('sendInvite', v)} emailReady={emailReady} disabled={!form.adminEmail} />
          </>
        )}

        <div className="btn-row">
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" block loading={saving} type="submit">{isCreate ? 'Create customer' : 'Save changes'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ backup / delete / import

const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso || ''; } };
const countLine = (c = {}) => `${c.users ?? 0} users, ${c.posts ?? 0} assets, ${c.brandAssets ?? 0} brand assets${c.files !== undefined ? `, ${c.files} files (${fmtBytes(c.fileBytes)})` : ''}`;

async function saveBackupFile(file) {
  const blob = await adminApi.downloadCustomerBackup(file);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function BackupModal({ customer, onClose }) {
  const [state, setState] = useState({ status: 'idle', backup: null, error: '' });
  async function run() {
    setState({ status: 'working', backup: null, error: '' });
    try {
      const { backup } = await adminApi.backupCustomer(customer._id);
      await saveBackupFile(backup.file);
      setState({ status: 'done', backup, error: '' });
    } catch (e) {
      setState({ status: 'error', backup: null, error: apiErrorMessage(e) });
    }
  }
  return (
    <Modal title={`Back up ${customer.name}`} onClose={onClose} width={520}>
      <p className="hint">
        Creates one ZIP with this customer&apos;s data (team, posts, brand assets, AI usage, settings) and all of their image and video files.
        A copy is kept on the server and the ZIP downloads to your computer. It can be imported again later from <strong>Backups &amp; import</strong>.
      </p>
      <p className="hint"><strong>Keep the ZIP private</strong> - it contains password hashes and connection details, like a database dump.</p>
      {state.error && <ErrorText>{state.error}</ErrorText>}
      {state.status === 'done' && (
        <div className="notice">Backup saved: <strong>{state.backup.file}</strong> ({fmtBytes(state.backup.bytes)}). {countLine(state.backup.counts)}.</div>
      )}
      <div className="modal-actions" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Btn variant="secondary" type="button" onClick={onClose}>{state.status === 'done' ? 'Close' : 'Cancel'}</Btn>
        {state.status !== 'done' && <Btn variant="primary" block loading={state.status === 'working'} type="button" onClick={run}>Create backup</Btn>}
      </div>
    </Modal>
  );
}

function DeleteModal({ customer, onClose, onDeleted }) {
  const [counts, setCounts] = useState(null);
  const [backup, setBackup] = useState(true);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { adminApi.customerCounts(customer._id).then((r) => setCounts(r.counts)).catch(() => {}); }, [customer._id]);
  const ok = typed.trim() === customer.name.trim();

  async function run() {
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.deleteCustomer(customer._id, { confirmName: typed.trim(), backup });
      // The deleted customer may be the workspace this browser has open: forget it so the download (and every later request) is not sent for it.
      try { if (localStorage.getItem(CUSTOMER_KEY) === String(customer._id)) localStorage.removeItem(CUSTOMER_KEY); } catch { /* ignore */ }
      let downloadError = '';
      if (res.backup?.file) { try { await saveBackupFile(res.backup.file); } catch { downloadError = 'The backup is saved on the server (Backups & import) but the download did not start.'; } }
      onDeleted({ ...res, downloadError });
    } catch (e) {
      setError(apiErrorMessage(e));
      setBusy(false);
    }
  }
  return (
    <Modal title={`Delete ${customer.name}`} onClose={busy ? () => {} : onClose} width={540}>
      <p className="hint" style={{ color: '#c62828' }}>
        This permanently removes the customer, their team, posts, brand assets, AI usage history and their stored files{counts ? ` (${countLine(counts)})` : ''}.
        Agency admins are not deleted. Older files stored outside the customer&apos;s own folder are left on disk.
      </p>
      <label className="check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '12px 0' }}>
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} disabled={busy} />
        <span><strong>Back up first</strong> (recommended). Saves one ZIP of the data and files on the server, downloads it to your computer, and lets you import the customer again later. Nothing is deleted if the backup fails.</span>
      </label>
      <Field label={`Type "${customer.name}" to confirm`}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="modal-actions" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Btn variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" block loading={busy} type="button" disabled={!ok} style={{ background: '#c62828', borderColor: '#c62828' }} onClick={run}>
          {backup ? 'Back up and delete customer' : 'Delete customer without backup'}
        </Btn>
      </div>
    </Modal>
  );
}

function BackupsModal({ onClose, onImported }) {
  const [rows, setRows] = useState(null);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = () => adminApi.listCustomerBackups().then((r) => { setRows(r.backups); setDir(r.dir); }).catch((e) => setError(apiErrorMessage(e)));
  useEffect(() => { load(); }, []);

  async function run(key, fn) {
    setBusy(key);
    setError('');
    try { await fn(); } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(''); }
  }
  const restoreSaved = (file) => run(`import:${file}`, async () => onImported(await adminApi.importSavedCustomerBackup(file)));
  const removeSaved = (file) => { if (window.confirm(`Delete the saved backup ${file}? This cannot be undone.`)) run(`del:${file}`, async () => { await adminApi.deleteCustomerBackup(file); await load(); }); };
  const download = (file) => run(`dl:${file}`, () => saveBackupFile(file));
  const upload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    run('upload', async () => onImported(await adminApi.importCustomerBackup(form)));
  };

  return (
    <Modal title="Customer backups & import" onClose={onClose} width={720}>
      <p className="hint">
        Importing restores a customer as it was (same data, same files). If its name or folder is already in use, a new one is chosen. Team members whose email already exists are skipped.
      </p>
      <div style={{ margin: '8px 0 14px' }}>
        <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-block' }}>
          {busy === 'upload' ? 'Importing…' : 'Import from a ZIP file…'}
          <input type="file" accept=".zip,application/zip" onChange={upload} disabled={Boolean(busy)} style={{ display: 'none' }} />
        </label>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <h3 style={{ margin: '12px 0 6px', fontSize: 15 }}>Saved on the server</h3>
      {!rows ? <LoadingSpinner /> : rows.length === 0 ? <p className="hint">No backups yet. Use <strong>Back up</strong> on a customer, or delete one with “Back up first” ticked.</p> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Customer</th><th>Created</th><th>Size</th><th>Contents</th><th /></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.file}>
                  <td>{b.customerName}<div className="hint" style={{ margin: 0 }}>{b.file}</div></td>
                  <td>{when(b.createdAt)}</td>
                  <td>{fmtBytes(b.bytes)}</td>
                  <td>{b.counts ? countLine({ ...b.counts, files: undefined }) : '—'}</td>
                  <td>
                    <div className="row-actions">
                      <Btn variant="secondary" className="small-btn" loading={busy === `import:${b.file}`} disabled={Boolean(busy)} onClick={() => restoreSaved(b.file)}>Import</Btn>
                      <Btn variant="secondary" className="small-btn" loading={busy === `dl:${b.file}`} disabled={Boolean(busy)} onClick={() => download(b.file)}>Download</Btn>
                      <Btn variant="secondary" className="small-btn" style={{ color: '#c62828' }} disabled={Boolean(busy)} onClick={() => removeSaved(b.file)}>Delete</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dir && <p className="hint" style={{ marginTop: 10 }}>Server folder: <code>{dir}</code>. Keep it on persistent storage and private.</p>}
    </Modal>
  );
}

function LimitsHistoryModal({ customer, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    adminApi.getLimitsHistory(customer._id).then(setData).catch((e) => setError(apiErrorMessage(e)));
  }, [customer._id]);
  const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return (
    <Modal title={`Limits history - ${customer.name}`} onClose={onClose} width={680}>
      {error && <ErrorText>{error}</ErrorText>}
      {!data && !error && <LoadingSpinner label="Loading history…" />}
      {data && (
        <>
          <p className="hint">Every change to this customer&apos;s generation limits, newest first. Top-ups made before limits could be edited directly are listed too.</p>
          {data.entries.length === 0 ? <p className="hint">No changes yet. Limits set when the customer was created are not listed.</p> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Date</th><th>What changed</th><th>By</th><th>Note</th></tr></thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{day(e.at)}<div className="hint" style={{ margin: 0 }}>{time(e.at)}</div></td>
                      <td>
                        {e.changes.map((c, i) => (
                          <div key={i}>{c.label}: {c.add ? `+${c.add}` : `${limitText(c.from)} → ${limitText(c.to)}`}</div>
                        ))}
                      </td>
                      <td>{e.byName || '—'}</td>
                      <td>{e.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <Btn variant="secondary" type="button" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}
