import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../services/api';

export function useAccessLog({ limit = 50 } = {}) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const isMountedRef = useRef(true);

  const fetchLog = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getAccessLog(limit);
      if (isMountedRef.current) {
        setItems(Array.isArray(data?.items) ? data.items : []);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err?.message || 'Failed to load access log');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [limit]);

  useEffect(() => {
    isMountedRef.current = true;
    // Defer the first fetch: oxlint's react(set-state-in-effect) rejects a
    // synchronous setState in an effect, and fetchLog marks loading first.
    const timer = setTimeout(() => {
      void fetchLog();
    }, 0);
    return () => {
      isMountedRef.current = false;
      clearTimeout(timer);
    };
  }, [fetchLog]);

  return {
    items,
    isLoading,
    error,
    refetch: fetchLog
  };
}
