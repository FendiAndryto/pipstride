// Non-blocking confirmation prompt (replaces window.confirm in ticket 006-03).
// Destructive connection actions are queued by useConnectionManager and rendered
// here inline, so the dialog never blocks the event loop.

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export default function ConfirmInline({ message, confirmLabel, onConfirm, onCancel, busy = false }) {
  const { t } = useLanguage();
  if (!message) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      style={{
        padding: '10px 12px',
        borderRadius: '9px',
        marginBottom: '12px',
        background: 'rgba(255, 113, 128, 0.10)',
        border: '1px solid rgba(255, 113, 128, 0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap'
      }}
    >
      <AlertCircle size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: '180px', fontSize: '11.5px', color: 'var(--text)' }}>{message}</span>
      <button
        type="button"
        className="btn"
        onClick={onConfirm}
        disabled={busy}
        style={{ padding: '5px 12px', fontSize: '11px', background: 'var(--red)', color: '#fff' }}
      >
        {confirmLabel || t('common_confirm')}
      </button>
      <button
        type="button"
        className="btn alt"
        onClick={onCancel}
        disabled={busy}
        style={{ padding: '5px 12px', fontSize: '11px' }}
      >
        {t('common_cancel')}
      </button>
    </div>
  );
}
