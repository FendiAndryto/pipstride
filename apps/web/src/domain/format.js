// Value formatters for the Pipstride web app. Pure functions, no React/DOM.
// This is the single copy of each money/ratio format (ticket 006-02).
// Currency is dynamic since Fase 011: Cent accounts quote in USC, not USD.

/** Unsigned money in the account's currency, e.g. "USC 1,392.80" / "$1,392.80". */
export const formatCurrency = (val, currency = 'USD') => {
  const safeCurrency = currency || 'USD';
  const num = val === null || val === undefined || isNaN(val) ? 0 : Number(val);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  } catch {
    // Non-ISO currency code: never crash the render, fall back to a plain prefix.
    return `${safeCurrency} ${num.toFixed(2)}`;
  }
};

/**
 * Signed compact money, e.g. "+$12.40" / "-$3.05" — used for narratives, not balances.
 * `fractionDigits` exists for the narrow month-calendar badges (0) while tooltips keep 2.
 */
export const formatSignedMoney = (value, currency = 'USD', fractionDigits = 2) => {
  const safeCurrency = currency || 'USD';
  const num = value === null || value === undefined || isNaN(value) ? 0 : Number(value);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      signDisplay: 'always',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(num);
  } catch {
    const prefix = num >= 0 ? '+' : '-';
    return `${prefix}${safeCurrency} ${Math.abs(num).toFixed(fractionDigits)}`;
  }
};

/** The one null-safe ratio formatter: null/undefined (infinite ratio) reads as '∞'. */
export const formatRatio = (value) =>
  value === null || value === undefined ? '∞' : Number(value).toFixed(2);

/**
 * Formats an ISO date-time string according to the given locale.
 * Fallback to '—' if invalid or missing.
 */
export const formatDateTime = (value, locale = 'en-US') => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
