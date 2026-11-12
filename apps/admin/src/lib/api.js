import { configureHttp, authRequest, rawRequest } from './http';
import { getToken, clearStorage } from './storage';

const API_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/$/, '')
  : '';

configureHttp({
  authHeaders: () => {
    const token = getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  },
  unauthorized: () => {
    clearStorage();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pipstride:admin-session-expired'));
    }
  },
});

export async function parseError(res, fallback = 'Request failed') {
  let detail = fallback;
  try {
    const data = await res.json();
    if (data && typeof data === 'object') {
      detail = data.detail || data.message || fallback;
    }
  } catch {
    // Non-JSON error body
  }
  const err = new Error(detail);
  err.status = res.status;
  err.detail = detail;
  return err;
}

export async function apiFetch(path, options = {}, { authed = true } = {}) {
  const url = `${API_BASE}${path}`;
  const requestFn = authed ? authRequest : rawRequest;
  const res = await requestFn(url, options);

  if (!res.ok) {
    throw await parseError(res, `HTTP ${res.status}: Request failed`);
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}
