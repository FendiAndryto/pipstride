// JWT token and session persistence for Pipstride Admin (ADR 0008 §7).
// Single location touching browser storage for admin credentials.

const TOKEN_KEY = 'pipstride_admin_jwt';
const USER_KEY = 'pipstride_admin_user';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
};

export const setToken = (token, remember = true) => {
  try {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage quota or privacy mode
  }
};

export const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage cleanup
  }
};

export const getStoredUser = () => {
  try {
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const setStoredUser = (user, remember = true) => {
  try {
    const raw = JSON.stringify(user);
    if (remember) {
      localStorage.setItem(USER_KEY, raw);
      sessionStorage.removeItem(USER_KEY);
    } else {
      sessionStorage.setItem(USER_KEY, raw);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // Storage quota
  }
};

export const clearStorage = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    // Storage cleanup
  }
};
