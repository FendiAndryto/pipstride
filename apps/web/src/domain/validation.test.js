import { describe, expect, it } from 'vitest';

import {
  EMAIL_PATTERN,
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  passwordError
} from './validation';

// Ticket 008-01 — mirrors services/api/app/services/user_service.py:
//   EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
//   validate_password_complexity: len < 8 -> letter check -> digit check
// The order matters: the UI shows the first failing rule, exactly like the API.

describe('MIN_PASSWORD_LENGTH', () => {
  it('is 8, matching the backend', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});

describe('passwordError', () => {
  it('accepts a password with letters and digits of sufficient length', () => {
    expect(passwordError('abcd1234')).toBeNull();
  });

  it('reports length first, before the letter and digit rules', () => {
    // 'abc1' is short AND has no failure other than length; the backend checks
    // length first, so the UI must too.
    expect(passwordError('abc1')).toBe('length');
    expect(passwordError('1234')).toBe('length');
  });

  it('reports letter when long enough but digits only', () => {
    expect(passwordError('12345678')).toBe('letter');
  });

  it('reports digit when long enough but letters only', () => {
    expect(passwordError('abcdefgh')).toBe('digit');
  });

  it('treats missing input as a length failure instead of throwing', () => {
    expect(passwordError(undefined)).toBe('length');
    expect(passwordError(null)).toBe('length');
    expect(passwordError('')).toBe('length');
  });

  it('counts a non-ASCII letter as a letter, like the backend [a-zA-Z] does not', () => {
    // Python uses [a-zA-Z]; 'é' must NOT satisfy the letter rule.
    expect(passwordError('ééééééé1')).toBe('letter');
  });
});

describe('isValidEmail', () => {
  it('accepts a plain address', () => {
    expect(isValidEmail('trader@example.com')).toBe(true);
  });

  it('accepts dots and plus tags in the local part', () => {
    expect(isValidEmail('first.last+tag@sub.example.co.id')).toBe(true);
  });

  it('rejects an address without a dot in the domain', () => {
    expect(isValidEmail('trader@example')).toBe(false);
  });

  it('rejects whitespace and multiple @', () => {
    expect(isValidEmail('tra der@example.com')).toBe(false);
    expect(isValidEmail('a@b@example.com')).toBe(false);
  });

  it('treats empty or missing input as invalid instead of throwing', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });

  it('exposes the same pattern the backend compiles', () => {
    expect(EMAIL_PATTERN.source).toBe('^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$');
  });
});
