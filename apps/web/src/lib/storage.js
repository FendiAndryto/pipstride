// Token persistence and active-connection selection (moved out of api.js).
// This module is the ONLY place in the web app that touches
// localStorage/sessionStorage for auth and connection state.

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
