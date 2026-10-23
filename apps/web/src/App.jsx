import React, { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import { api, getToken, clearToken } from './services/api';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
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

    checkAuth();

    const handleSessionExpired = () => {
      setUser(null);
      setSessionExpiredMsg('Sesi login telah berakhir. Silakan masuk kembali.');
    };

    window.addEventListener('pipstride:session-expired', handleSessionExpired);
    return () => window.removeEventListener('pipstride:session-expired', handleSessionExpired);
  }, []);

  const handleLoginSuccess = async (authData) => {
    setSessionExpiredMsg('');
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
        <span style={{ fontSize: '0.9rem', letterSpacing: '0.05em' }}>MEMUAT PIPSTRIDE...</span>
      </div>
    );
  }

  return (
    <>
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} />
      ) : (
        <LoginPage
          onLoginSuccess={handleLoginSuccess}
          sessionExpiredMsg={sessionExpiredMsg}
        />
      )}
    </>
  );
}
