import React, { useState, useEffect, useCallback } from 'react';
import { Shell } from './Shell';
import { LoginPage } from '../pages/LoginPage';
import { OverviewPage } from '../pages/OverviewPage';
import { UsersPage } from '../pages/UsersPage';
import { UserDetailPage } from '../pages/UserDetailPage';
import { AuditPage } from '../pages/AuditPage';
import { SupportSessionsPage } from '../pages/SupportSessionsPage';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { getMe, logout } from '../features/auth/api';
import { fetchSupportSessions, revokeSupportSession } from '../features/support/api';
import { getToken, clearStorage, getStoredUser, setStoredUser } from '../lib/storage';
import { isSessionActive } from '../domain/supportSession';
import { Loader2, AlertCircle } from 'lucide-react';

export function App() {
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionExpiredOpen, setSessionExpiredOpen] = useState(false);

  // Active support session state (ADR 0008 §6)
  const [activeSupportSession, setActiveSupportSession] = useState(null);

  // Hash-based router state
  const [routeState, setRouteState] = useState(() => parseHash(window.location.hash));

  function parseHash(hash) {
    const raw = (hash || '').replace(/^#\/?/, '').trim();
    if (!raw) return { route: 'overview', param: null };
    const parts = raw.split('/');
    return {
      route: parts[0] || 'overview',
      param: parts[1] || null,
    };
  }

  // Sync hash routing
  useEffect(() => {
    const handleHashChange = () => {
      setRouteState(parseHash(window.location.hash));
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = useCallback((route, param = null) => {
    const hash = param ? `#${route}/${param}` : `#${route}`;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      setRouteState({ route, param });
    }
  }, []);

  // Check auth session validity on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      const token = getToken();
      if (!token) {
        setAuthChecked(true);
        return;
      }

      getMe()
        .then((user) => {
          if (user.role !== 'admin' && user.role !== 'support') {
            clearStorage();
            setCurrentUser(null);
          } else {
            setCurrentUser(user);
            setStoredUser(user);
          }
        })
        .catch(() => {
          clearStorage();
          setCurrentUser(null);
        })
        .finally(() => {
          setAuthChecked(true);
        });
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  // Poll / load active support sessions when authed. Wait for the mount-time
  // getMe() check so a stale token cannot fire an extra unauthenticated request.
  const refreshActiveSupport = useCallback(async () => {
    if (!authChecked || !currentUser) return;
    try {
      const res = await fetchSupportSessions({ mine: true, active_only: true });
      const active = (res.items || []).find((s) => isSessionActive(s));
      setActiveSupportSession(active || null);
    } catch {
      setActiveSupportSession(null);
    }
  }, [authChecked, currentUser]);

  useEffect(() => {
    if (!authChecked || !currentUser) return;
    const timer = setTimeout(() => {
      void refreshActiveSupport();
    }, 0);
    return () => clearTimeout(timer);
  }, [authChecked, currentUser, refreshActiveSupport]);

  // Session expired event handler from lib/http
  useEffect(() => {
    const handleExpired = () => {
      clearStorage();
      setCurrentUser(null);
      setActiveSupportSession(null);
      setSessionExpiredOpen(true);
    };

    window.addEventListener('pipstride:admin-session-expired', handleExpired);
    return () => window.removeEventListener('pipstride:admin-session-expired', handleExpired);
  }, []);

  const handleLogout = async () => {
    await logout();
    clearStorage();
    setCurrentUser(null);
    setActiveSupportSession(null);
    window.location.hash = '';
  };

  const handleRevokeSupport = async (sessionId) => {
    try {
      await revokeSupportSession(sessionId);
      setActiveSupportSession(null);
    } catch {
      // Handled
    }
  };

  const handleExpireSupport = () => {
    setActiveSupportSession(null);
  };

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          color: 'var(--text-muted)',
        }}
      >
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-emerald)' }} />
        <span>Authenticating telemetry environment...</span>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginPage
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            navigate('overview');
          }}
        />

        <Modal
          isOpen={sessionExpiredOpen}
          onClose={() => setSessionExpiredOpen(false)}
          title="Session Expired"
          footer={
            <Button
              variant="primary"
              onClick={() => setSessionExpiredOpen(false)}
            >
              Sign In Again
            </Button>
          }
        >
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <AlertCircle size={20} style={{ color: 'var(--accent-amber)' }} />
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Your administrative session has expired or the token was invalidated. Please log in again.
            </p>
          </div>
        </Modal>
      </>
    );
  }

  const renderActiveRoute = () => {
    const { route, param } = routeState;

    if (route === 'users') {
      if (param) {
        return (
          <UserDetailPage
            userId={param}
            canMutate={currentUser?.role === 'admin'}
            onNavigate={navigate}
            activeSupportSession={activeSupportSession}
            onSessionGranted={(newSession) => {
              setActiveSupportSession(newSession);
            }}
          />
        );
      }
      return <UsersPage onNavigate={navigate} />;
    }

    if (route === 'audit') {
      return <AuditPage />;
    }

    if (route === 'support') {
      return (
        <SupportSessionsPage
          onSessionRevoked={() => {
            setActiveSupportSession(null);
          }}
        />
      );
    }

    return <OverviewPage onNavigate={navigate} />;
  };

  return (
    <Shell
      currentUser={currentUser}
      currentRoute={routeState.route}
      onNavigate={navigate}
      onLogout={handleLogout}
      activeSupportSession={activeSupportSession}
      onRevokeSupportSession={handleRevokeSupport}
      onExpireSupportSession={handleExpireSupport}
    >
      {renderActiveRoute()}
    </Shell>
  );
}
