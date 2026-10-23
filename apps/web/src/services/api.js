// API service with dynamic base URL and JWT token handling.
// Reads from Vite environment variable or falls back to relative path for reverse proxy.
const API_BASE = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
const TOKEN_KEY = 'pipstride_jwt_token';
const REMEMBER_KEY = 'pipstride_remember_me';
const CONNECTION_KEY = 'pipstride_active_connection_id';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);

export const setToken = (token, remember = true) => {
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(REMEMBER_KEY, 'true');
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REMEMBER_KEY);
  }
};

export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REMEMBER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
};

export const isRemembered = () => localStorage.getItem(REMEMBER_KEY) === 'true';

// ---------------------------------------------------------------------------
// Active MT5 connection
//
// A user may own several MT5 accounts. Every dashboard request targets one of
// them through the X-Connection-Id header; the backend falls back to the oldest
// active connection when the header is absent.
// ---------------------------------------------------------------------------
export const getActiveConnectionId = () => localStorage.getItem(CONNECTION_KEY) || null;

export const setActiveConnectionId = (connectionId) => {
  if (connectionId) {
    localStorage.setItem(CONNECTION_KEY, connectionId);
  } else {
    localStorage.removeItem(CONNECTION_KEY);
  }
};

export const clearActiveConnectionId = () => localStorage.removeItem(CONNECTION_KEY);

const notifySessionExpired = () => {
  clearToken();
  clearActiveConnectionId();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pipstride:session-expired'));
  }
};

const getAuthHeaders = () => {
  const token = getToken();
  const connectionId = getActiveConnectionId();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(connectionId ? { 'X-Connection-Id': connectionId } : {})
  };
};

const parseError = async (res, fallback) => {
  const err = await res.json().catch(() => ({ detail: fallback }));
  return new Error(err.detail || fallback);
};

/**
 * Unified authenticated fetch wrapper.
 * Intercepts HTTP 401 across all API endpoints and notifies the app of session expiration.
 */
const authFetch = async (url, options = {}) => {
  const headers = {
    ...getAuthHeaders(),
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    notifySessionExpired();
  }
  return res;
};

export const api = {
  // ---------------------------------------------------------------- auth
  async login(username, password, remember = true) {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      throw await parseError(res, 'Authentication failed');
    }

    const data = await res.json();
    setToken(data.access_token, remember);
    return data;
  },

  async register(username, password, remember = true) {
    const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      throw await parseError(res, 'Registration failed');
    }

    const data = await res.json();
    setToken(data.access_token, remember);
    return data;
  },

  async changePassword(oldPassword, newPassword) {
    const res = await authFetch(`${API_BASE}/api/v1/auth/change-password`, {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });

    if (!res.ok) {
      throw await parseError(res, 'Failed to change password');
    }

    return res.json();
  },

  async getMe() {
    const res = await authFetch(`${API_BASE}/api/v1/auth/me`, { method: 'GET' });

    if (!res.ok) {
      throw new Error('Unauthorized');
    }

    return res.json();
  },

  async logout() {
    try {
      await authFetch(`${API_BASE}/api/v1/auth/logout`, { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    } finally {
      clearToken();
      clearActiveConnectionId();
    }
  },

  // ---------------------------------------------------------- connections
  async getConnections() {
    const res = await authFetch(`${API_BASE}/api/v1/connections`, { method: 'GET' });
    if (!res.ok) {
      throw await parseError(res, 'Failed to load MT5 connections');
    }
    return res.json();
  },

  /**
   * Creates a connection and returns its token. The raw token is only ever
   * returned by this call and by rotation, so the caller must show it once.
   */
  async createConnection(label = 'Akun MT5') {
    const res = await authFetch(
      `${API_BASE}/api/v1/connections?label=${encodeURIComponent(label)}`,
      { method: 'POST' }
    );
    if (!res.ok) {
      throw await parseError(res, 'Failed to create MT5 connection');
    }
    return res.json();
  },

  async rotateConnectionToken(connectionId) {
    const res = await authFetch(`${API_BASE}/api/v1/connections/${connectionId}/rotate`, {
      method: 'POST'
    });
    if (!res.ok) {
      throw await parseError(res, 'Failed to rotate connection token');
    }
    return res.json();
  },

  async revokeConnection(connectionId) {
    const res = await authFetch(`${API_BASE}/api/v1/connections/${connectionId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      throw await parseError(res, 'Failed to revoke MT5 connection');
    }
    return res.status === 204 ? null : res.json();
  },

  // -------------------------------------------------------------- bridge
  async getBridgeStatus() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/status`, { method: 'GET' });

    if (!res.ok) {
      throw new Error(`Failed to fetch bridge telemetry (HTTP ${res.status})`);
    }

    return res.json();
  },

  async getMarketQuotes() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/market`, { method: 'GET' });
    if (!res.ok) {
      throw new Error('Failed to fetch market quotes');
    }
    return res.json();
  },

  async getTradeHistory() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/history`, { method: 'GET' });
    if (!res.ok) {
      throw new Error('Failed to fetch trade history');
    }
    return res.json();
  },

  async resetTradeHistory() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/history/reset`, { method: 'POST' });
    if (!res.ok) {
      throw new Error('Failed to reset trade history');
    }
    return res.json();
  },

  async getEquityCurve(range = '1M') {
    const res = await authFetch(
      `${API_BASE}/api/v1/bridge/equity-curve?range=${encodeURIComponent(range)}`,
      { method: 'GET' }
    );
    if (!res.ok) {
      throw new Error('Failed to fetch equity curve');
    }
    return res.json();
  },

  async getInitialDeposit() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/initial-deposit`, { method: 'GET' });
    if (!res.ok) {
      throw new Error('Failed to fetch initial deposit');
    }
    return res.json();
  },

  async setInitialDeposit(amount) {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/initial-deposit`, {
      method: 'POST',
      body: JSON.stringify({
        initial_deposit: amount !== null && amount !== undefined && amount !== '' ? Number(amount) : null
      })
    });
    if (!res.ok) {
      throw await parseError(res, 'Initial deposit update failed');
    }
    return res.json();
  },

  async getPositions() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/positions`, { method: 'GET' });

    if (!res.ok) {
      throw new Error('Failed to retrieve open positions');
    }

    return res.json();
  },

  // Risk Watchdog Telemetry (read-only; never executes orders)
  async getRiskStatus() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/risk`, { method: 'GET' });
    if (!res.ok) {
      throw new Error('Failed to retrieve risk watchdog status');
    }
    return res.json();
  },

  // ------------------------------------------------------------ telegram
  async getTelegramStatus() {
    const res = await authFetch(`${API_BASE}/api/v1/telegram/status`, { method: 'GET' });
    if (!res.ok) {
      throw new Error('Failed to retrieve Telegram status');
    }
    return res.json();
  },

  async sendTelegramTestAlert(message = null) {
    const res = await authFetch(`${API_BASE}/api/v1/telegram/test-alert`, {
      method: 'POST',
      body: JSON.stringify(message ? { message } : {})
    });
    if (!res.ok) {
      throw await parseError(res, 'Test alert delivery failed');
    }
    return res.json();
  },

  async toggleTelegram(enabled) {
    const res = await authFetch(`${API_BASE}/api/v1/telegram/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) {
      throw await parseError(res, 'Failed to toggle Telegram notifications');
    }
    return res.json();
  }
};
