import React, { useState, useEffect, useRef } from 'react';
import LoginPage from './components/LoginPage';
import ResetPasswordPage from './components/ResetPasswordPage';
import Dashboard from './components/Dashboard';
import { api, getToken, clearToken } from './services/api';
import { useLanguage } from './context/LanguageContext';
import './App.css';

const readParam = (name) =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);

/** Remove a consumed one-time token from the address bar. */
const stripQueryParam = (name) => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  const search = url.searchParams.toString();
  window.history.replaceState({}, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
};

export default function App() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState('');
  const [notice, setNotice] = useState(null);
  const [resetToken, setResetToken] = useState(() => readParam('reset_token'));
  const verifiedRef = useRef(false);

  useEffect(() => {
    const boot = async () => {
      // Email links land on the dashboard origin; verification does not need a session.
      const verifyToken = readParam('verify_email');
      if (verifyToken && !verifiedRef.current) {
        verifiedRef.current = true;
        try {
          const data = await api.verifyEmail(verifyToken);
          setNotice({
            type: 'success',
            text: data.email
              ? tRef.current('app_verify_success_email', { email: data.email })
              : tRef.current('app_verify_success')
          });
        } catch (err) {
          setNotice({
            type: 'error',
            text: err.message || tRef.current('app_verify_failed')
          });
        }
        stripQueryParam('verify_email');
      }

      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const userData = await api.getMe();
        setUser(userData);
      } catch {
        clearToken();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    boot();

    const handleSessionExpired = () => {
      setUser(null);
      setSessionExpiredMsg(tRef.current('app_session_expired'));
    };

    window.addEventListener('pipstride:session-expired', handleSessionExpired);
    return () => window.removeEventListener('pipstride:session-expired', handleSessionExpired);
  }, []);

  const handleLoginSuccess = async (authData) => {
    setSessionExpiredMsg('');
    setNotice(null);
    try {
      const userData = await api.getMe();
      setUser(userData);
    } catch {
      setUser({
        username: authData?.username || 'Trader',
        is_authenticated: true,
        role: 'trader'
      });
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setSessionExpiredMsg('');
    setNotice(null);
  };

  const handleRefreshUser = async () => {
    try {
      setUser(await api.getMe());
    } catch {
      // A transient failure leaves the previous profile in place.
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-main)',
        color: 'var(--text-secondary)',
        gap: '1rem'
      }}>
        <div className="pulse-dot online" style={{ width: '16px', height: '16px' }} />
        <span style={{ fontSize: '0.9rem', letterSpacing: '0.05em' }}>{t('app_loading')}</span>
      </div>
    );
  }

  if (resetToken) {
    return (
      <ResetPasswordPage
        token={resetToken}
        onDone={(text) => {
          setResetToken(null);
          setNotice({ type: 'success', text });
          stripQueryParam('reset_token');
        }}
        onCancel={() => {
          setResetToken(null);
          stripQueryParam('reset_token');
        }}
      />
    );
  }

  return (
    <>
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} onRefreshUser={handleRefreshUser} />
      ) : (
        <LoginPage
          onLoginSuccess={handleLoginSuccess}
          sessionExpiredMsg={sessionExpiredMsg}
          notice={notice}
        />
      )}
    </>
  );
}
