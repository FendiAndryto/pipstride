// Value formatters for the Pipstride web app. Pure functions, no React/DOM.
// This is the single copy of each money/ratio format (ticket 006-02).

export const formatCurrency = (val, currency = 'USD') => {
  if (val === null || val === undefined || isNaN(val)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

/** Signed compact money, e.g. "+$12.40" / "−$3.05" — used for narratives, not balances. */
export const formatSignedMoney = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '+$0.00';
  const prefix = value >= 0 ? '+' : '−';
  return `${prefix}$${Math.abs(value).toFixed(2)}`;
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
