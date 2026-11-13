import { describe, expect, it } from 'vitest';

import { formatCurrency, formatDateTime, formatRatio, formatSignedMoney } from './format';

// Fase 011 ticket 01 — locks the dynamic-currency contract of the money
// formatters. Before this, every nominal was hardcoded to "$", so Cent (USC)
// accounts read "+$1,298.80" for a 1,298.80 USC profit and the gross-loss
// summary rendered the double-minus bug "−$-1009.00".
//
// NBSP: Intl renders 3-letter codes (USC) as "USC\u00A01,298.80" — a
// non-breaking space, not a normal one. USD/EUR use a symbol with no space at
// all, so only the 3-letter assertions below may contain \u00A0.

const NBSP = '\u00A0';

describe('formatCurrency', () => {
  it('formats USD with a dollar symbol', () => {
    expect(formatCurrency(1298.8, 'USD')).toBe('$1,298.80');
    expect(formatCurrency(0, 'USD')).toBe('$0.00');
  });

  it('formats Cent accounts in USC instead of dollars', () => {
    expect(formatCurrency(1392.8, 'USC')).toBe(`USC${NBSP}1,392.80`);
  });

  it('formats EUR with a euro symbol', () => {
    expect(formatCurrency(10, 'EUR')).toBe('€10.00');
  });

  it('defaults to USD when no currency is given', () => {
    expect(formatCurrency(5)).toBe('$5.00');
    expect(formatCurrency(5, null)).toBe('$5.00');
    expect(formatCurrency(5, '')).toBe('$5.00');
  });

  it('formats null/undefined/NaN as zero in the requested currency, not "$0.00"', () => {
    // Regression: the old guard returned a hardcoded '$0.00' regardless of currency.
    expect(formatCurrency(null, 'USC')).toBe(`USC${NBSP}0.00`);
    expect(formatCurrency(undefined, 'USC')).toBe(`USC${NBSP}0.00`);
    expect(formatCurrency(NaN, 'USC')).toBe(`USC${NBSP}0.00`);
    expect(formatCurrency(null, 'USD')).toBe('$0.00');
  });

  it('keeps the negative sign that Intl puts on the value itself', () => {
    expect(formatCurrency(-1009, 'USD')).toBe('-$1,009.00');
    expect(formatCurrency(-1009, 'USC')).toBe(`-USC${NBSP}1,009.00`);
  });

  it('never throws on a non-ISO currency code', () => {
    expect(formatCurrency(1234.5, 'XYZQ')).toBe('XYZQ 1234.50');
  });
});

describe('formatSignedMoney', () => {
  it('prefixes positive values with a plus sign', () => {
    expect(formatSignedMoney(1298.8, 'USD')).toBe('+$1,298.80');
    expect(formatSignedMoney(1298.8, 'USC')).toBe(`+USC${NBSP}1,298.80`);
  });

  it('formats negative values with a single minus', () => {
    expect(formatSignedMoney(-1009, 'USD')).toBe('-$1,009.00');
    expect(formatSignedMoney(-1009, 'USC')).toBe(`-USC${NBSP}1,009.00`);
  });

  it('renders zero as an explicit plus', () => {
    expect(formatSignedMoney(0, 'USD')).toBe('+$0.00');
    expect(formatSignedMoney(0, 'USC')).toBe(`+USC${NBSP}0.00`);
  });

  it('treats null/undefined/NaN as zero instead of throwing', () => {
    expect(formatSignedMoney(null, 'USD')).toBe('+$0.00');
    expect(formatSignedMoney(undefined, 'USD')).toBe('+$0.00');
    expect(formatSignedMoney(NaN, 'USD')).toBe('+$0.00');
    expect(formatSignedMoney(null, 'USC')).toBe(`+USC${NBSP}0.00`);
  });

  it('defaults to USD when no currency is given', () => {
    expect(formatSignedMoney(12.4)).toBe('+$12.40');
    expect(formatSignedMoney(12.4, null)).toBe('+$12.40');
  });

  it('drops decimals when fractionDigits is 0 (month-calendar badges)', () => {
    expect(formatSignedMoney(25, 'USC', 0)).toBe(`+USC${NBSP}25`);
    expect(formatSignedMoney(-12, 'USD', 0)).toBe('-$12');
    expect(formatSignedMoney(0, 'USD', 0)).toBe('+$0');
  });

  it('never throws on a non-ISO currency code', () => {
    expect(formatSignedMoney(1234.5, 'XYZQ')).toBe('+XYZQ 1234.50');
    expect(formatSignedMoney(-1234.5, 'XYZQ')).toBe('-XYZQ 1234.50');
    expect(formatSignedMoney(1234.5, 'XYZQ', 0)).toBe('+XYZQ 1235');
  });
});

describe('formatRatio', () => {
  it('reads a missing ratio as infinity', () => {
    expect(formatRatio(null)).toBe('∞');
    expect(formatRatio(undefined)).toBe('∞');
  });

  it('formats a present ratio with two decimals', () => {
    expect(formatRatio(1.5)).toBe('1.50');
    expect(formatRatio(0)).toBe('0.00');
  });
});

describe('formatDateTime', () => {
  it('falls back to an em dash for missing or invalid values', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });

  it('formats a valid ISO timestamp', () => {
    // Local-time string (no trailing Z) so the assertion does not depend on the
    // machine's timezone — CI runs UTC while dev machines here run WIB (+07).
    expect(formatDateTime('2026-11-13T10:05:00', 'en-US')).toBe('Nov 13, 2026, 10:05 AM');
  });

  it('honours the requested locale', () => {
    expect(formatDateTime('2026-11-13T10:05:00', 'id-ID')).toContain('2026');
  });
});
