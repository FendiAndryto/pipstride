// Single copy of the credential rules (ticket 006-02).
// Mirrors services/api/app/services/user_service.py exactly:
//   - password: at least 8 characters, containing letters and numbers
//   - email: same regex as user_service.EMAIL_PATTERN
// Pure functions: no React, no DOM, no IO. Callers map failures to i18n.

export const MIN_PASSWORD_LENGTH = 8;

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const isValidEmail = (email) => EMAIL_PATTERN.test(email || '');

/**
 * First password rule failure, in the same order the backend validates:
 * 'length' | 'letter' | 'digit' | null (null = valid).
 */
export const passwordError = (password) => {
  const value = password || '';
  if (value.length < MIN_PASSWORD_LENGTH) return 'length';
  if (!/[a-zA-Z]/.test(value)) return 'letter';
  if (!/[0-9]/.test(value)) return 'digit';
  return null;
};
