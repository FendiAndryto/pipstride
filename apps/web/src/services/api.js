// API service with dynamic base URL and JWT token handling
// Reads from Vite environment variable or falls back to relative path for reverse proxy
const API_BASE = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
const TOKEN_KEY = 'robot_trading_jwt_token';
const REMEMBER_KEY = 'tradegear_remember_me';

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

const notifySessionExpired = () => {
  clearToken();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tradegear:session-expired'));
  }
};

const getAuthHeaders = () => {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
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
  // Authentication
  async login(username, password, remember = true) {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Authentication failed');
    }
    
    const data = await res.json();
    setToken(data.access_token, remember);
    return data;
  },

  async register(username, password, role = 'trader', remember = true) {
    const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(err.detail || 'Registration failed');
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
      const err = await res.json().catch(() => ({ detail: 'Failed to change password' }));
      throw new Error(err.detail || 'Failed to change password');
    }

    return res.json();
  },

  async getMe() {
    const res = await authFetch(`${API_BASE}/api/v1/auth/me`, {
      method: 'GET'
    });
    
    if (!res.ok) {
      throw new Error('Unauthorized');
    }
    
    return res.json();
  },

  async logout() {
    try {
      await authFetch(`${API_BASE}/api/v1/auth/logout`, {
        method: 'POST'
      });
    } catch {
      // Ignore network errors on logout
    } finally {
      clearToken();
    }
  },

  async getBridgeToken() {
    const res = await authFetch(`${API_BASE}/api/v1/auth/bridge-token`, {
      method: 'GET'
    });
    if (!res.ok) {
      throw new Error('Failed to retrieve bridge token');
    }
    return res.json();
  },

  async regenerateBridgeToken() {
    const res = await authFetch(`${API_BASE}/api/v1/auth/bridge-token/regenerate`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to regenerate token' }));
      throw new Error(err.detail || 'Token regeneration failed');
    }
    return res.json();
  },

  // Bridge Status & Telemetry
  async getBridgeStatus() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/status`, {
      method: 'GET'
    });
    
    if (!res.ok) {
      throw new Error(`Failed to fetch bridge telemetry (HTTP ${res.status})`);
    }
    
    return res.json();
  },

  async getMarketQuotes() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/market`, {
      method: 'GET'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch market quotes');
    }
    return res.json();
  },

  async getTradeHistory() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/history`, {
      method: 'GET'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch trade history');
    }
    return res.json();
  },

  async resetTradeHistory() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/history/reset`, {
      method: 'POST'
    });
    if (!res.ok) {
      throw new Error('Failed to reset trade history');
    }
    return res.json();
  },

  async getEquityCurve(range = '1M') {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/equity-curve?range=${encodeURIComponent(range)}`, {
      method: 'GET'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch equity curve');
    }
    return res.json();
  },

  async getInitialDeposit() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/initial-deposit`, {
      method: 'GET'
    });
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
      const err = await res.json().catch(() => ({ detail: 'Failed to update initial deposit' }));
      throw new Error(err.detail || 'Initial deposit update failed');
    }
    return res.json();
  },


  async getPositions() {
    const res = await authFetch(`${API_BASE}/api/v1/bridge/positions`, {
      method: 'GET'
    });

    if (!res.ok) {
      throw new Error('Failed to retrieve open positions');
    }

    return res.json();
  },

  // Risk Watchdog Telemetry
  async getRiskStatus() {
    const res = await authFetch(`${API_BASE}/api/v1/risk/status`, {
      method: 'GET'
    });
    if (!res.ok) {
      throw new Error('Failed to retrieve risk configuration');
    }
    return res.json();
  },

  // Telegram Notifications & Remote Alerts
  async getTelegramStatus() {
    const res = await authFetch(`${API_BASE}/api/v1/telegram/status`, {
      method: 'GET'
    });
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
      const err = await res.json().catch(() => ({ detail: 'Failed to send test alert' }));
      throw new Error(err.detail || 'Test alert delivery failed');
    }
    return res.json();
  },

  async toggleTelegram(enabled) {
    const res = await authFetch(`${API_BASE}/api/v1/telegram/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to toggle Telegram notifications' }));
      throw new Error(err.detail || 'Failed to toggle Telegram notifications');
    }
    return res.json();
  }
};
