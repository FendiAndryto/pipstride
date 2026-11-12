// Thin service endpoints -- the app's single HTTP client surface.
// Transport lives in `lib/http`, token/connection persistence in `lib/storage`,
// and file downloads in `lib/download` (ticket 006-01). This file only builds
// requests and throws typed errors; no storage or DOM logic here.
//
// Every exported name from the original god-client keeps its exact semantics.

import { configureHttp, authRequest, rawRequest } from '../lib/http';
import {
  getToken,
  setToken,
  getActiveConnectionId,
  clearToken,
  clearActiveConnectionId
} from '../lib/storage';

const API_BASE = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
const AUTH = '/api/v1/auth';
const conn = (path) => `/api/v1/connections${path}`;

configureHttp({
  authHeaders: () => ({
    'Content-Type': 'application/json',
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    ...(getActiveConnectionId() ? { 'X-Connection-Id': getActiveConnectionId() } : {})
  }),
  unauthorized: () => {
    clearToken();
    clearActiveConnectionId();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pipstride:session-expired'));
    }
  }
});

const jsonError = async (res, fallback) => {
  const body = await res.json().catch(() => ({ detail: fallback }));
  return new Error(body.detail || fallback);
};

/** Parse a JSON body or throw a typed error carrying the API's `detail`. */
const sendAndParse = async (pendingRes, fallback) => {
  // Callers pass the pending request, not a settled Response: `res.ok` on a
  // Promise is `undefined`, which made every call take the error branch and
  // throw `res.json is not a function` instead of parsing the body.
  const res = await pendingRes;
  if (!res.ok) throw await jsonError(res, fallback);
  return res.json();
};

const rawPost = (path, payload, fallback) =>
  sendAndParse(
    rawRequest(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
    fallback
  );

const authJson = (path, { method = 'GET', payload } = {}, fallback) =>
  sendAndParse(
    authRequest(`${API_BASE}${path}`, { method, ...(payload ? { body: JSON.stringify(payload) } : {}) }),
    fallback
  );

// Re-exports keep existing call sites stable (App, Dashboard, LoginPage,
// ProfileTab, Mt5ConnectModal).
export { downloadPreset } from '../lib/download';
export {
  getToken,
  setToken,
  clearToken,
  isRemembered,
  getActiveConnectionId,
  setActiveConnectionId,
  clearActiveConnectionId
} from '../lib/storage';

export const api = {
  // ---------------------------------------------------------------- auth
  async login(username, password, remember = true) {
    const data = await rawPost(`${AUTH}/login`, { username, password }, 'Authentication failed');
    setToken(data.access_token, remember);
    return data;
  },

  async register(username, password, email = null, remember = true) {
    const data = await rawPost(
      `${AUTH}/register`,
      { username, password, ...(email ? { email } : {}) },
      'Registration failed'
    );
    setToken(data.access_token, remember);
    return data;
  },

  /** Always resolves with a generic message; the API never reveals registered addresses. */
  async forgotPassword(email) {
    return rawPost(`${AUTH}/forgot-password`, { email }, 'Failed to request a password reset');
  },

  async resetPassword(token, newPassword) {
    return rawPost(`${AUTH}/reset-password`, { token, new_password: newPassword }, 'This reset link is invalid or has expired');
  },

  async verifyEmail(token) {
    return rawPost(`${AUTH}/verify-email`, { token }, 'This verification link is invalid or has expired');
  },

  /** Attach or change the account email; the API emails a verification link. */
  async setEmail(email) {
    return authJson(`${AUTH}/email`, { method: 'POST', payload: { email } }, 'Failed to update email');
  },

  async changePassword(oldPassword, newPassword) {
    return authJson(
      `${AUTH}/change-password`,
      { method: 'POST', payload: { old_password: oldPassword, new_password: newPassword } },
      'Failed to change password'
    );
  },

  async getMe() {
    const res = await authRequest(`${API_BASE}${AUTH}/me`, { method: 'GET' });
    if (!res.ok) throw new Error('Unauthorized');
    return res.json();
  },

  async logout() {
    try {
      await authRequest(`${API_BASE}${AUTH}/logout`, { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    } finally {
      clearToken();
      clearActiveConnectionId();
    }
  },

  // ---------------------------------------------------------- connections
  async getConnections() {
    return authJson(conn(''), {}, 'Failed to load MT5 connections');
  },

  /**
   * Creates a connection and returns its token. The raw token is only ever
   * returned by this call and by rotation, so the caller must show it once.
   */
  async createConnection(label = 'Akun MT5') {
    return authJson(conn(`?label=${encodeURIComponent(label)}`), { method: 'POST' }, 'Failed to create MT5 connection');
  },

  async rotateConnectionToken(connectionId) {
    return authJson(conn(`/${connectionId}/rotate`), { method: 'POST' }, 'Failed to rotate connection token');
  },

  async revokeConnection(connectionId) {
    const res = await authRequest(`${API_BASE}${conn(`/${connectionId}`)}`, { method: 'DELETE' });
    if (!res.ok) throw await jsonError(res, 'Failed to revoke MT5 connection');
    return res.status === 204 ? null : res.json();
  },

  // -------------------------------------------------------------- bridge
  async getBridgeStatus() {
    const res = await authRequest(`${API_BASE}/api/v1/bridge/status`, { method: 'GET' });
    if (!res.ok) throw new Error(`Failed to fetch bridge telemetry (HTTP ${res.status})`);
    return res.json();
  },

  async getMarketQuotes() {
    const res = await authRequest(`${API_BASE}/api/v1/bridge/market`, { method: 'GET' });
    if (res.status === 409) return [];
    if (!res.ok) throw new Error('Failed to fetch market quotes');
    return res.json();
  },

  async getTradeHistory(limit = 1000) {
    const res = await authRequest(`${API_BASE}/api/v1/bridge/history?limit=${limit}`, { method: 'GET' });
    if (res.status === 409) {
      return {
        trades: [],
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        net_pnl: 0,
        profit_factor: null,
        win_rate: 0
      };
    }
    if (!res.ok) throw new Error('Failed to fetch trade history');
    return res.json();
  },

  /**
   * Aggregated journal analytics for the active connection.
   * range: 1M | 3M | 1Y | ALL, source: all | ea | manual, symbol: string | null
   */
  async getJournalStats(range = '1M', source = 'all', symbol = null) {
    const params = { range, source };
    if (symbol && symbol !== 'ALL') params.symbol = symbol;
    const res = await authRequest(`${API_BASE}/api/v1/journal/stats?${new URLSearchParams(params)}`, { method: 'GET' });
    if (res.status === 409) return null;
    if (!res.ok) throw new Error('Failed to fetch journal statistics');
    return res.json();
  },

  async resetTradeHistory() {
    const res = await authRequest(`${API_BASE}/api/v1/bridge/history/reset`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reset trade history');
    return res.json();
  },

  async getEquityCurve(range = '1M') {
    const res = await authRequest(
      `${API_BASE}/api/v1/bridge/equity-curve?range=${encodeURIComponent(range)}`,
      { method: 'GET' }
    );
    if (res.status === 409) return null;
    if (!res.ok) throw new Error('Failed to fetch equity curve');
    return res.json();
  },

  async getInitialDeposit() {
    const res = await authRequest(`${API_BASE}/api/v1/bridge/initial-deposit`, { method: 'GET' });
    if (!res.ok) throw new Error('Failed to fetch initial deposit');
    return res.json();
  },

  async setInitialDeposit(amount) {
    return authJson(
      '/api/v1/bridge/initial-deposit',
      {
        method: 'POST',
        payload: { initial_deposit: amount !== null && amount !== undefined && amount !== '' ? Number(amount) : null }
      },
      'Initial deposit update failed'
    );
  },

  async getPositions() {
    const res = await authRequest(`${API_BASE}/api/v1/bridge/positions`, { method: 'GET' });
    if (!res.ok) throw new Error('Failed to retrieve open positions');
    return res.json();
  },

  // Risk Watchdog Telemetry (read-only; never executes orders)
  async getRiskStatus() {
    const res = await authRequest(`${API_BASE}/api/v1/bridge/risk`, { method: 'GET' });
    if (!res.ok) throw new Error('Failed to retrieve risk watchdog status');
    return res.json();
  },

  // User-visible support access log (read-only)
  async getAccessLog(limit = 50) {
    const res = await authRequest(`${API_BASE}/api/v1/access-log?limit=${encodeURIComponent(limit)}`, { method: 'GET' });
    if (!res.ok) throw await jsonError(res, 'Failed to fetch access log');
    return res.json();
  }
};
