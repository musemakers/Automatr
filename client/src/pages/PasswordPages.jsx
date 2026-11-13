import BrandLogo from '../components/BrandLogo.jsx';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/resources.js';
import { apiErrorMessage } from '../api/client.js';
import { Btn, Field, ErrorText } from '../components/ui.jsx';

function Shell({ title, lede, children }) {
  return (
    <div className="auth">
      <div className="auth__form-panel">
        <div className="auth-card">
          <div className="brand" style={{ marginBottom: 18 }}>
            <BrandLogo tone="dark" />
          </div>
          <div className="auth-card__head">
            <h1>{title}</h1>
            {lede ? <p>{lede}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the reset link.'));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Shell title="Check your email" lede={`If an account exists for ${email.trim()}, we've sent a link to choose a new password. It expires in 60 minutes.`}>
        <p className="auth-switch" style={{ marginTop: 8 }}><Link to="/login">Back to log in</Link></p>
      </Shell>
    );
  }

  return (
    <Shell title="Forgot your password?" lede="Enter your work email and we'll send you a link to choose a new one.">
      <ErrorText>{error}</ErrorText>
      <form className="auth-form active" onSubmit={submit}>
        <Field label="Work email">
          <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <div className="btn-row" style={{ marginTop: 2 }}>
          <Btn variant="primary" block loading={loading} type="submit">Send reset link</Btn>
        </div>
        <p className="auth-switch"><Link to="/login">Back to log in</Link></p>
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => navigate('/login', { replace: true }), 2500);
    return () => clearTimeout(t);
  }, [done, navigate]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Choose a password of at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not reset your password.'));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Shell title="Reset link missing" lede="This page needs the link from your reset email. You can request a new one.">
        <p className="auth-switch"><Link to="/forgot-password">Request a new link</Link></p>
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell title="Password updated" lede="You can now sign in with your new password. Taking you to the log in page...">
        <p className="auth-switch"><Link to="/login">Log in</Link></p>
      </Shell>
    );
  }
  return (
    <Shell title="Choose a new password" lede="Pick something at least 8 characters long.">
      <ErrorText>{error}</ErrorText>
      <form className="auth-form active" onSubmit={submit}>
        <Field label="New password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
        </Field>
        <Field label="Confirm new password">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </Field>
        <div className="btn-row" style={{ marginTop: 2 }}>
          <Btn variant="primary" block loading={loading} type="submit">Update password</Btn>
        </div>
        <p className="auth-switch"><Link to="/login">Back to log in</Link></p>
      </form>
    </Shell>
  );
}
