// HTTP transport for Pipstride Admin (ADR 0009 §2).
// Pure transport: no storage or env dependencies directly inside this file.
// Application configures via configureHttp().

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
      ...(options.headers || {}),
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

/** Unauthenticated request (login, TOTP enrollment start/verify). */
export const rawRequest = (url, options) => send(url, options, { authed: false });

/** Authenticated request; notifies the app on 401 but still returns the Response. */
export const authRequest = (url, options) => send(url, options, { authed: true });
