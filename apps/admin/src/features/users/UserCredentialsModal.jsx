import React, { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Check, Copy, KeyRound } from 'lucide-react';

const DASHBOARD_URL =
  import.meta.env.VITE_APP_URL || 'https://app-pipstride.homever.my.id';

export function UserCredentialsModal({ isOpen, onClose, credentials }) {
  const [copied, setCopied] = useState(false);

  if (!credentials) return null;

  const formattedText = [
    'Kredensial Akun Pipstride:',
    `- URL Dashboard: ${DASHBOARD_URL}`,
    `- Username: ${credentials.username}`,
    `- Password: ${credentials.password}`,
    `- Paket: ${credentials.planLabel || 'Free'}`,
    `- Masa Aktif: ${credentials.durationLabel || '30 Hari'}`,
    credentials.email ? `- Email: ${credentials.email}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback if clipboard API fails
      setCopied(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Akun Berhasil Dibuat"
      icon={KeyRound}
      footer={
        <>
          <Button
            variant="primary"
            onClick={handleCopy}
            title="Salin rincian kredensial ke clipboard"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? 'Tersalin ke Clipboard!' : 'Salin Kredensial'}</span>
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Tutup
          </Button>
        </>
      }
    >
      <div className="stack-gap-md">
        <p className="text-secondary" style={{ fontSize: '0.875rem' }}>
          Akun pengguna telah berhasil didaftarkan di sistem. Salin kredensial di
          bawah ini dan berikan kepada pengguna. Password ini tidak dapat dilihat
          kembali setelah dialog ini ditutup.
        </p>

        <div
          style={{
            background: 'var(--surface-sunken)',
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
            lineHeight: 1.6,
            wordBreak: 'break-all',
          }}
        >
          <div><strong>URL Dashboard:</strong> {DASHBOARD_URL}</div>
          <div><strong>Username:</strong> {credentials.username}</div>
          <div><strong>Password:</strong> <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{credentials.password}</span></div>
          <div><strong>Paket:</strong> {credentials.planLabel}</div>
          <div><strong>Masa Aktif:</strong> {credentials.durationLabel}</div>
          {credentials.email ? <div><strong>Email:</strong> {credentials.email}</div> : null}
        </div>
      </div>
    </Modal>
  );
}
