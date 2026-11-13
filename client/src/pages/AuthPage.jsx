import BrandLogo from '../components/BrandLogo.jsx';
import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { authApi } from '../api/resources.js';
import { Btn, Field, ErrorText } from '../components/ui.jsx';
import IndustrySelect from '../components/IndustrySelect.jsx';

// Small default shown briefly while the full server-driven list loads, so
// the field isn't empty. The server (server/src/constants/industries.js)
// is the source of truth for the full, exhaustive, grouped list.
const FALLBACK_GROUPS = [
  { group: 'Common', items: ['Technology', 'Retail & E-commerce', 'Fashion & Apparel', 'Food & Beverage', 'Health & Wellness', 'Financial Services', 'Travel & Hospitality', 'Media & Entertainment'] }
];

export default function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { login, register } = useAuth();

  const [tab, setTab] = useState(location.pathname === '/register' ? 'register' : 'login');
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [industryGroups, setIndustryGroups] = useState(FALLBACK_GROUPS);

  // Local convenience: when running `npm run dev` the login box is pre-filled with the seeded
  // admin (server/src/services/adminSeedService.js). import.meta.env.DEV is false in production
  // builds, so nothing is pre-filled on a deployed site. Override with VITE_DEV_LOGIN_EMAIL /
  // VITE_DEV_LOGIN_PASSWORD in client/.env.
  const [loginForm, setLoginForm] = useState(
    import.meta.env.DEV
      ? {
          email: import.meta.env.VITE_DEV_LOGIN_EMAIL || 'admin@automatr.test',
          password: import.meta.env.VITE_DEV_LOGIN_PASSWORD || 'admin123'
        }
      : { email: '', password: '' }
  );
  const [regForm, setRegForm] = useState({
    name: '',
    email: '',
    password: '',
    companyName: '',
    designation: '',
    industry: FALLBACK_GROUPS[0].items[0]
  });

  useEffect(() => {
    authApi
      .industries()
      .then(({ groups, industries: flat }) => {
        const alpha = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
        if (groups?.length) {
          const sorted = groups.map((g) => ({ ...g, items: [...g.items].sort(alpha) })).sort((a, b) => alpha(a.group, b.group));
          setIndustryGroups(sorted);
        } else if (flat?.length) {
          setIndustryGroups([{ group: 'All industries', items: [...flat].sort(alpha) }]);
        }
      })
      .catch(() => {
        /* keep the fallback list - registration still works */
      });
  }, []);

  useEffect(() => {
    setTab(location.pathname === '/register' ? 'register' : 'login');
  }, [location.pathname]);

  function switchTab(next) {
    setTab(next);
    setError('');
    navigate(next === 'register' ? '/register' : '/login', { replace: true });
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(loginForm.email, loginForm.password);
      navigate('/dashboard');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not log in. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(regForm);
      navigate('/dashboard');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create your account.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__panel-inner">
          <div className="brand">
            <BrandLogo />
          </div>
          <h2>Turn a one-line brief into a ready-to-publish post.</h2>
          <p>
            AUTOMATr keeps your brand kit, your voice, and your industry context in one place -
            and uses multiple AI models together to generate captions and creative that
            actually sound like you.
          </p>
          <ul className="auth__points">
            <li>Multi-model generation - not locked to one AI vendor</li>
            <li>Every design pulls your logo, colors and fonts automatically</li>
            <li>Approval routing before anything goes live</li>
            <li>Industry news &amp; stock signal, tuned to your sector</li>
          </ul>
        </div>
      </div>

      <div className="auth__form-panel">
        <div className="auth-card">
          <div className="auth-tabs">
            <button type="button" className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => switchTab('login')}>
              Log in
            </button>
            <button type="button" className={`auth-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => switchTab('register')}>
              Create account
            </button>
          </div>

          <ErrorText>{error}</ErrorText>

          {tab === 'login' ? (
            <form className="auth-form active" onSubmit={handleLogin}>
              <Field label="Work email">
                <input
                  type="text"
                  placeholder="you@company.com"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  placeholder="••••••••"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
                  required
                />
              </Field>
              <p style={{ textAlign: 'right', margin: '-4px 0 10px', fontSize: 12.5 }}>
                <Link to="/forgot-password" style={{ color: 'var(--blue)', fontWeight: 600 }}>Forgot password?</Link>
              </p>
              <div className="btn-row" style={{ marginTop: 2 }}>
                <Btn variant="primary" block loading={loading} type="submit">Log in</Btn>
              </div>
              <p className="auth-switch">
                New to AUTOMATr?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); switchTab('register'); }}>Create an account</a>
              </p>
            </form>
          ) : (
            <form className="auth-form active" onSubmit={step === 1 ? (e) => { e.preventDefault(); setStep(2); } : handleRegister}>
              <div className="auth-step-dots">
                <span className={`dot ${step >= 1 ? 'active' : ''}`} />
                <span className="dot-line" />
                <span className={`dot ${step >= 2 ? 'active' : ''}`} />
              </div>

              {step === 1 ? (
                <div className="auth-step active">
                  <p className="auth-step__label">Step 1 · About you</p>
                  <Field label="Full name">
                    <input type="text" placeholder="Jordan Meyers" value={regForm.name}
                      onChange={(e) => setRegForm((f) => ({ ...f, name: e.target.value }))} required />
                  </Field>
                  <Field label="Work email">
                    <input type="text" placeholder="you@company.com" value={regForm.email}
                      onChange={(e) => setRegForm((f) => ({ ...f, email: e.target.value }))} required />
                  </Field>
                  <Field label="Password">
                    <input type="password" placeholder="Create a password" value={regForm.password}
                      onChange={(e) => setRegForm((f) => ({ ...f, password: e.target.value }))} required minLength={8} />
                  </Field>
                  <div className="btn-row" style={{ marginTop: 2 }}>
                    <Btn variant="primary" block type="submit">Continue →</Btn>
                  </div>
                </div>
              ) : (
                <div className="auth-step active">
                  <p className="auth-step__label">Step 2 · About your company</p>
                  <Field label="Company name">
                    <input type="text" placeholder="Northwind Studio" value={regForm.companyName}
                      onChange={(e) => setRegForm((f) => ({ ...f, companyName: e.target.value }))} />
                  </Field>
                  <Field label="Designation">
                    <input type="text" placeholder="Marketing Manager" value={regForm.designation}
                      onChange={(e) => setRegForm((f) => ({ ...f, designation: e.target.value }))} />
                  </Field>
                  <Field label="Industry segment" hint="We'll tune your dashboard's news feed and stock ticker to this segment.">
                    <IndustrySelect value={regForm.industry} groups={industryGroups} onChange={(v) => setRegForm((f) => ({ ...f, industry: v }))} />
                  </Field>
                  <div className="btn-row" style={{ marginTop: 2 }}>
                    <Btn variant="secondary" type="button" onClick={() => setStep(1)}>← Back</Btn>
                    <Btn variant="primary" block loading={loading} type="submit">Create account</Btn>
                  </div>
                </div>
              )}
              <p className="auth-switch">
                Already have an account?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); switchTab('login'); }}>Log in</a>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
