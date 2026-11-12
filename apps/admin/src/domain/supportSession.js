// Pure domain logic for support session lifecycle & time calculation (ADR 0008 §6).
// Pure logic only: no React, no DOM, no IO.

export function calculateRemainingSeconds(expiresAtIso, now = Date.now()) {
  if (!expiresAtIso) return 0;
  const expiry = new Date(expiresAtIso).getTime();
  if (Number.isNaN(expiry)) return 0;
  const remainingMs = expiry - now;
  if (remainingMs <= 0) return 0;
  return Math.floor(remainingMs / 1000);
}

export function formatCountdown(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  if (hrs > 0) {
    const hh = String(hrs).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function isSessionActive(session, now = Date.now()) {
  if (!session || !session.active) return false;
  if (session.revoked_at) return false;
  return calculateRemainingSeconds(session.expires_at, now) > 0;
}

export function isSessionExpiringSoon(seconds, thresholdSeconds = 300) {
  return seconds > 0 && seconds <= thresholdSeconds;
}
