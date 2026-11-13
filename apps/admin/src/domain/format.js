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

export function formatExpiryStatus(expiresAt, isActive, isExpired = false) {
  // 1. Nonaktif manual (is_active=false) mengalahkan status tanggal
  if (!isActive) {
    return { label: 'Nonaktif', variant: 'neutral' };
  }
  // 2. Lifetime / permanen
  if (!expiresAt) {
    return { label: 'Permanen', variant: 'neutral' };
  }
  // 3. Flag is_expired dari backend atau kalkulasi tanggal sudah lewat
  if (isExpired) {
    return { label: 'Kedaluwarsa', variant: 'danger' };
  }
  const expiry = new Date(expiresAt);
  // Guard: tanggal tidak valid → safe fallback
  if (isNaN(expiry.getTime())) {
    return { label: 'Tidak Diketahui', variant: 'neutral' };
  }
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  // 4. Perhitungan tanggal browser jika sudah lewat
  if (diffDays <= 0) {
    return { label: 'Kedaluwarsa', variant: 'danger' };
  }
  // 5. Kurang dari 1 hari (sisa jam < 24 jam)
  if (diffMs < 86_400_000) {
    return { label: 'Kurang dari 1 hari', variant: 'danger' };
  }
  // 6. Segera berakhir (≤3 hari) — berlaku untuk semua plan
  if (diffDays <= 3) {
    return { label: `Segera Berakhir (${diffDays} hari)`, variant: 'warning' };
  }
  // 7. Aktif normal
  return { label: `Aktif (${diffDays} hari)`, variant: 'success' };
}
