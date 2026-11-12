// Pure domain formatting functions (ADR 0009 §2).
// Pure logic only: no React, no DOM, no IO.

export function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(isoString);
  }
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 19);
    return `${date} ${time} UTC`;
  } catch {
    return String(isoString);
  }
}

export function formatRelativeTime(isoString, now = Date.now()) {
  if (!isoString) return 'Never';
  try {
    const d = new Date(isoString);
    const timestamp = d.getTime();
    if (Number.isNaN(timestamp)) return 'Never';

    const diffMs = now - timestamp;
    if (diffMs < 0) return 'Just now';

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;

    return formatDate(isoString);
  } catch {
    return 'Never';
  }
}

export function formatNumber(val) {
  if (val === null || val === undefined) return '0';
  const num = Number(val);
  if (Number.isNaN(num)) return '0';
  return num.toLocaleString('en-US');
}

export function formatCurrency(amount, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  const num = Number(amount);
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function truncateId(id, len = 8) {
  if (!id) return '';
  const s = String(id);
  if (s.length <= len) return s;
  return `${s.slice(0, len)}…`;
}
