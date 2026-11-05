// HTTP transport for Pipstride (ADR 0009 §2).
//
// Pure transport: this module knows nothing about storage, tokens, or
// import.meta.env. The application layer (services/api.js) wires once via
// configureHttp() and supplies header building plus 401 handling.
//
// Every request runs under an AbortController deadline; on timeout the fetch
// rejects with an AbortError the caller already treats as a network failure.

let getAuthHeaders = null;
let onUnauthorized = null;
let defaultTimeoutMs = 30000;

export function configureHttp({ authHeaders, unauthorized, timeoutMs } = {}) {
  if (authHeaders) getAuthHeaders = authHeaders;
  if (unauthorized) onUnauthorized = unauthorized;
  if (timeoutMs !== undefined) defaultTimeoutMs = timeoutMs;
}

async function send(url, options = {}, { authed = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), defaultTimeoutMs);
  try {
    const headers = {
      ...(authed && getAuthHeaders ? getAuthHeaders() : {}),
      ...(options.headers || {})
    };
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    if (authed && res.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Unauthenticated request (login, register, password reset, email verify). */
export const rawRequest = (url, options) => send(url, options, { authed: false });

/** Authenticated request; notifies the app on 401 but still returns the Response. */
export const authRequest = (url, options) => send(url, options, { authed: true });
