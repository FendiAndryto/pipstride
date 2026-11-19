import { useCallback, useEffect, useRef, useState } from 'react';
import { indexActiveSupportSessions } from '../../domain/supportSession';
import { getToken } from '../../lib/storage';
import { fetchSupportSessions, revokeSupportSession } from './api';

const POLL_INTERVAL_MS = 15_000;
const EMPTY_SESSIONS = new Map();
const EMPTY_PENDING = new Set();

export function useSupportSessions(token) {
  const [snapshot, setSnapshot] = useState(null);
  const [revokedById, setRevokedById] = useState(EMPTY_SESSIONS);
  const [revokingIds, setRevokingIds] = useState(EMPTY_PENDING);
  const pendingRefresh = useRef(null);
  const pendingRevokes = useRef(new Set());

  const cancelRefresh = useCallback(() => {
    pendingRefresh.current?.abort();
    pendingRefresh.current = null;
  }, []);

  const clearSupportSessions = useCallback(() => {
    cancelRefresh();
    setSnapshot(null);
    setRevokedById(EMPTY_SESSIONS);
    pendingRevokes.current = new Set();
    setRevokingIds(EMPTY_PENDING);
  }, [cancelRefresh]);

  const refresh = useCallback(async () => {
    if (!token || token !== getToken() || pendingRefresh.current) return;
    const request = new AbortController();
    pendingRefresh.current = request;
    try {
      const result = await fetchSupportSessions({ active_only: true, signal: request.signal });
      if (!request.signal.aborted && token === getToken()) {
        setSnapshot({
          token,
          byId: indexActiveSupportSessions(result.items || []),
          error: '',
        });
      }
    } catch (error) {
      if (!request.signal.aborted && token === getToken()) {
        setSnapshot((previous) => ({
          token,
          byId: previous?.token === token ? previous.byId : EMPTY_SESSIONS,
          error: error.message || 'Failed to verify support sessions.',
        }));
      }
    } finally {
      if (pendingRefresh.current === request) pendingRefresh.current = null;
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const syncVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      } else {
        cancelRefresh();
      }
    };
    const initial = setTimeout(refreshWhenVisible, 0);
    const interval = setInterval(refreshWhenVisible, POLL_INTERVAL_MS);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', syncVisibility);
      cancelRefresh();
    };
  }, [token, refresh, cancelRefresh]);

  const currentSnapshot = snapshot?.token === token ? snapshot : null;
  const byId = currentSnapshot?.byId ?? EMPTY_SESSIONS;

  useEffect(() => {
    if (!byId.size) return;
    const deadline = Math.min(...Array.from(byId.values(), (session) => Date.parse(session.expires_at)));
    const expire = () => {
      const delay = deadline - Date.now();
      if (delay > 0) {
        timer = setTimeout(expire, delay);
        return;
      }
      setSnapshot((previous) => {
        if (previous?.byId !== byId) return previous;
        return { ...previous, byId: indexActiveSupportSessions([...byId.values()]) };
      });
    };
    let timer = setTimeout(expire, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [byId]);

  const sessionGranted = useCallback(() => {
    if (!token || token !== getToken()) return;
    cancelRefresh();
    void refresh();
  }, [token, cancelRefresh, refresh]);

  const revokeSession = useCallback(async (sessionId) => {
    if (!token || token !== getToken()) return;
    const pending = pendingRevokes.current;
    if (pending.has(sessionId)) return;
    pending.add(sessionId);
    setRevokingIds(new Set(pending));
    try {
      const revoked = await revokeSupportSession(sessionId);
      if (pending !== pendingRevokes.current || token !== getToken()) return;

      cancelRefresh();
      setSnapshot((previous) => {
        if (previous?.token !== token || !previous.byId.has(sessionId)) return previous;
        const remaining = new Map(previous.byId);
        remaining.delete(sessionId);
        return { ...previous, byId: remaining };
      });
      setRevokedById((previous) => new Map(previous).set(sessionId, revoked));
      void refresh();
      return revoked;
    } catch (error) {
      if (pending === pendingRevokes.current && token === getToken()) {
        cancelRefresh();
        void refresh();
      }
      throw error;
    } finally {
      pending.delete(sessionId);
      if (pending === pendingRevokes.current) setRevokingIds(new Set(pending));
    }
  }, [token, cancelRefresh, refresh]);

  return {
    activeSessions: [...byId.values()],
    verificationError: currentSnapshot?.error || '',
    revokedById,
    revokingIds,
    sessionGranted,
    revokeSession,
    clearSupportSessions,
  };
}
