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

function formatDetail(detail, fallback) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) =>
        item && typeof item === 'object' ? item.msg || JSON.stringify(item) : String(item),
      )
      .join('; ');
  }
  if (detail && typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return fallback;
}

export async function parseError(res, fallback = 'Request failed') {
  let detail = fallback;
  try {
    const data = await res.json();
    if (data && typeof data === 'object') {
      detail = formatDetail(data.detail ?? data.message, fallback);
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
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  const res = await requestFn(url, { ...options, headers });

  if (!res.ok) {
    throw await parseError(res, `HTTP ${res.status}: Request failed`);
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}
