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
import { useSupportSessions } from '../features/support/useSupportSessions';
import { getToken, clearStorage, getStoredUser, setStoredUser } from '../lib/storage';
import { findTargetSupportSession } from '../domain/supportSession';
import { Loader2, AlertCircle } from 'lucide-react';

export function App() {
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionExpiredOpen, setSessionExpiredOpen] = useState(false);

  const {
    activeSessions,
    verificationError,
    revokedById,
    revokingIds,
    sessionGranted,
    revokeSession,
    clearSupportSessions,
  } = useSupportSessions(authChecked && currentUser ? getToken() : null);

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

  // Session expired event handler from lib/http
  useEffect(() => {
    const handleExpired = () => {
      clearStorage();
      setCurrentUser(null);
      clearSupportSessions();
      setSessionExpiredOpen(true);
    };

    window.addEventListener('pipstride:admin-session-expired', handleExpired);
    return () => window.removeEventListener('pipstride:admin-session-expired', handleExpired);
  }, [clearSupportSessions]);

  const handleLogout = async () => {
    await logout();
    clearStorage();
    setCurrentUser(null);
    clearSupportSessions();
    window.location.hash = '';
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
    const canMutate = currentUser.role === 'admin';

    if (route === 'users') {
      const initialStatus = param === 'expiring' || param === 'pending_connection' ? param : undefined;
      if (param && !initialStatus) {
        return (
          <UserDetailPage
            key={param}
            userId={param}
            canMutate={canMutate}
            onNavigate={navigate}
            activeSupportSession={findTargetSupportSession(activeSessions, param)}
            supportVerified={!verificationError}
            onSessionGranted={sessionGranted}
          />
        );
      }
      return <UsersPage key={initialStatus || 'all'} canMutate={canMutate} initialStatus={initialStatus} />;
    }

    if (route === 'audit') {
      return <AuditPage />;
    }

    if (route === 'support') {
      return (
        <SupportSessionsPage
          key={param === 'active' ? 'active' : 'all'}
          canViewAll={canMutate}
          initialActiveOnly={param === 'active'}
          revokeSession={revokeSession}
          revokedById={revokedById}
          revokingIds={revokingIds}
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
      activeSupportSessions={activeSessions}
      supportVerificationError={verificationError}
      revokingSupportIds={revokingIds}
      onRevokeSupportSession={revokeSession}
    >
      {renderActiveRoute()}
    </Shell>
  );
}
