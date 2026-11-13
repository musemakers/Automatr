import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout.jsx';
import Modal from '../../components/Modal.jsx';
import { Card, Btn, Field, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { adminApi, authApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';

const PERMISSION_LABELS = {
  manageBrand: 'Manage brand assets',
  generateContent: 'Generate content',
  approvePosts: 'Approve posts',
  publishPosts: 'Publish posts',
  manageTeam: 'Manage team (invite/edit users)',
  manageIndustries: 'Manage industry segments'
};

const ROLE_LABELS = { admin: 'Agency admin', customerAdmin: 'Customer admin', member: 'Member' };

export default function AdminUsers() {
  const { user: me, customer, isAgency } = useAuth();
  const [roles, setRoles] = useState(['customerAdmin', 'member']);
  const [customerList, setCustomerList] = useState([]);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [industries, setIndustries] = useState([]);
  const [permissionKeys, setPermissionKeys] = useState(Object.keys(PERMISSION_LABELS));

  const [editingUser, setEditingUser] = useState(null); // null = closed, {} = create, {...} = edit
  const [tempPassword, setTempPassword] = useState('');

  function load() {
    setLoading(true);
    setError('');
    adminApi
      .listUsers({ search: search || undefined, role: roleFilter || undefined })
      .then(({ users, total }) => {
        setUsers(users);
        setTotal(total);
      })
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce search
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter]);

  useEffect(() => {
    authApi.industries().then(({ industries }) => setIndustries(industries)).catch(() => {});
    adminApi.meta().then(({ permissionKeys, roles }) => {
      if (permissionKeys) setPermissionKeys(permissionKeys);
      if (roles) setRoles(roles);
    }).catch(() => {});
    if (isAgency) adminApi.listCustomers().then(({ customers }) => setCustomerList(customers)).catch(() => {});
  }, []);

  async function handleDelete(u) {
    if (!window.confirm(`Delete ${u.name} (${u.email})? This can't be undone.`)) return;
    try {
      await adminApi.deleteUser(u._id);
      load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }

  return (
    <Layout eyebrow="Admin" title="Users & Access">
      <div className="page-lede">
        <p>
          Create teammates, set roles, and dial in exactly what each person can do
          {customer ? <> in <strong>{customer.name}</strong>&apos;s workspace</> : null}.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>
      {tempPassword && (
        <p className="hint" style={{ marginBottom: 14, color: 'var(--blue-dark)' }}>
          Temporary password for the new account: <strong style={{ fontFamily: 'var(--font-mono)' }}>{tempPassword}</strong>{' '}
          — share this with them directly; it won&apos;t be shown again.
        </p>
      )}

      <Card>
        <div className="toolbar">
          <input
            type="text"
            placeholder="Search by name, email or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
          </select>
          <Btn variant="primary" onClick={() => { setTempPassword(''); setEditingUser({}); }}>+ New user</Btn>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                {isAgency && <th>Customer</th>}
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={isAgency ? 7 : 6}><LoadingSpinner label="Loading users…" /></td></tr>}
              {!loading && users.length === 0 && <tr><td colSpan={isAgency ? 7 : 6}><div className="empty-state">No users match.</div></td></tr>}
              {!loading && users.map((u) => (
                <tr key={u._id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.company?.name || '—'}</td>
                  {isAgency && <td>{u.customer?.name || '—'}</td>}
                  <td><span className={`role-badge role-badge--${u.role}`}>{ROLE_LABELS[u.role] || u.role}</span></td>
                  <td>
                    <span className={`status-dot status-dot--${u.isActive === false ? 'inactive' : 'active'}`} />
                    {u.isActive === false ? 'Disabled' : 'Active'}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Btn variant="secondary" className="small-btn" onClick={() => { setTempPassword(''); setEditingUser(u); }}>Edit</Btn>
                      {u._id !== me?._id && (
                        <Btn variant="secondary" className="small-btn" onClick={() => handleDelete(u)}>Delete</Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>{total} user{total === 1 ? '' : 's'} total.</p>
      </Card>

      {editingUser && (
        <UserFormModal
          initial={editingUser}
          roles={roles}
          isAgency={isAgency}
          customerList={customerList}
          currentCustomerId={customer?._id || customer?.id || ''}
          industries={industries}
          permissionKeys={permissionKeys}
          onClose={() => setEditingUser(null)}
          onSaved={(temp) => {
            setEditingUser(null);
            if (temp) setTempPassword(temp);
            load();
          }}
        />
      )}
    </Layout>
  );
}

function UserFormModal({ initial, roles, isAgency, customerList, currentCustomerId, industries, permissionKeys, onClose, onSaved }) {
  const isCreate = !initial._id;
  const [form, setForm] = useState({
    name: initial.name || '',
    email: initial.email || '',
    password: '',
    role: initial.role || 'member',
    customer: initial.customer?._id || initial.customer || currentCustomerId || '',
    companyName: initial.company?.name || '',
    designation: initial.company?.designation || '',
    industry: initial.company?.industry || industries[0] || 'Technology',
    isActive: initial.isActive !== false,
    permissions: {
      manageBrand: initial.permissions?.manageBrand ?? true,
      generateContent: initial.permissions?.generateContent ?? true,
      approvePosts: initial.permissions?.approvePosts ?? true,
      publishPosts: initial.permissions?.publishPosts ?? true,
      manageTeam: initial.permissions?.manageTeam ?? false,
      manageIndustries: initial.permissions?.manageIndustries ?? false
    }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function togglePerm(key) {
    setForm((f) => ({ ...f, permissions: { ...f.permissions, [key]: !f.permissions[key] } }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isCreate) {
        const { temporaryPassword } = await adminApi.createUser({
          name: form.name,
          email: form.email,
          password: form.password || undefined,
          role: form.role,
          customer: isAgency ? form.customer || undefined : undefined,
          permissions: form.permissions
          // company name, designation and industry are not asked for here: the server takes them from the customer
        });
        onSaved(temporaryPassword);
      } else {
        await adminApi.updateUser(initial._id, {
          name: form.name,
          email: form.email,
          password: form.password || undefined,
          role: form.role,
          customer: isAgency ? form.customer || null : undefined,
          permissions: form.permissions,
          companyName: form.companyName,
          designation: form.designation,
          industry: form.industry,
          isActive: form.isActive
        });
        onSaved();
      }
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isCreate ? 'New user' : `Edit ${initial.name}`} onClose={onClose} width={560}>
      <form onSubmit={handleSubmit}>
        <ErrorText>{error}</ErrorText>

        <Field label="Full name">
          <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </Field>
        <Field label="Work email">
          <input type="text" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
        </Field>
        <Field label={isCreate ? 'Password (optional — auto-generated if left blank)' : 'Reset password (optional)'}>
          <input
            type="text"
            placeholder={isCreate ? 'Leave blank to auto-generate' : 'Leave blank to keep current password'}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </Field>

        {!isCreate && (
          <>
          <div className="grid-2">
            <Field label="Company name">
              <input type="text" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
            </Field>
            <Field label="Designation">
              <input type="text" value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
            </Field>
          </div>

          <Field label="Industry segment">
            <select value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}>
              {industries.map((ind) => <option key={ind}>{ind}</option>)}
            </select>
          </Field>
          </>
        )}

        <Field label="Role">
          <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
          </select>
        </Field>

        {isAgency && (
          <Field label="Customer" hint="Which customer's workspace this person belongs to.">
            <select value={form.customer} onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}>
              <option value="">— none (agency only) —</option>
              {customerList.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </Field>
        )}

        {!isCreate && (
          <Field label="Account status">
            <div className="chip-row">
              <span className={`chip ${form.isActive ? 'selected' : ''}`} onClick={() => setForm((f) => ({ ...f, isActive: true }))}>Active</span>
              <span className={`chip ${!form.isActive ? 'selected' : ''}`} onClick={() => setForm((f) => ({ ...f, isActive: false }))}>Disabled</span>
            </div>
          </Field>
        )}

        <label style={{ fontSize: 12.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>
          Permissions {form.role !== 'member' && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(admins have full access regardless of these)</span>}
        </label>
        <div className="perm-grid">
          {permissionKeys.map((key) => (
            <label className="perm-row" key={key}>
              <input
                type="checkbox"
                checked={!!form.permissions[key]}
                disabled={form.role !== 'member'}
                onChange={() => togglePerm(key)}
              />
              {PERMISSION_LABELS[key] || key}
            </label>
          ))}
        </div>

        <div className="btn-row">
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" block loading={saving} type="submit">{isCreate ? 'Create user' : 'Save changes'}</Btn>
        </div>
      </form>
    </Modal>
  );
}
