import { useCallback, useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

/**
 * Clears the session after `timeoutMs` without user interaction.
 * Returns a `reset()` callback so callers can also reset on successful API responses.
 */
export function useIdleLogout({ onIdle, timeoutMs = 15 * 60 * 1000 } = {}) {
  const onIdleRef = useRef(onIdle);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current && onIdleRef.current) onIdleRef.current();
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    mountedRef.current = true;
    reset();

    const handleActivity = () => reset();
    const handleVisibility = () => {
      if (!document.hidden) reset();
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, handleActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reset]);

  return reset;
}
