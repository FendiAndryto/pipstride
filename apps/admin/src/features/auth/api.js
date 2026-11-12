import { apiFetch } from '../../lib/api';

export async function login({ username, password, totp_code }) {
  return apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      totp_code: totp_code || undefined,
    }),
  }, { authed: false });
}

export async function startTotpEnroll({ username, password }) {
  return apiFetch('/api/v1/auth/totp/enroll/start', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }, { authed: false });
}

export async function verifyTotpEnroll({ username, password, code }) {
  return apiFetch('/api/v1/auth/totp/enroll/verify', {
    method: 'POST',
    body: JSON.stringify({ username, password, code }),
  }, { authed: false });
}

export async function getMe() {
  return apiFetch('/api/v1/auth/me', {
    method: 'GET',
  }, { authed: true });
}

export async function logout() {
  try {
    await apiFetch('/api/v1/auth/logout', {
      method: 'POST',
    }, { authed: true });
  } catch {
    // Graceful fallback on logout error
  }
}
