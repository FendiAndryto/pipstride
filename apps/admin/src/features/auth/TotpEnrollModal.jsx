import React, { useState } from 'react';
import { Copy, Check, ShieldCheck, AlertCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { verifyTotpEnroll } from './api';

export function TotpEnrollModal({
  isOpen,
  onClose,
  enrollData,
  username,
  password,
  onSuccess,
}) {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCopySecret = async () => {
    if (!enrollData?.secret) return;
    try {
      await navigator.clipboard.writeText(enrollData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!code || code.trim().length < 6) {
      setError('Please enter a 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await verifyTotpEnroll({
        username,
        password,
        code: code.trim(),
      });
      onSuccess(code.trim());
    } catch (err) {
      setError(err.message || 'Verification failed. Please check the code and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !enrollData) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pair Authenticator (2FA)"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleVerify}
            loading={loading}
            icon={ShieldCheck}
          >
            Verify & Activate
          </Button>
        </>
      }
    >
      <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Two-factor authentication is mandatory for administrative accounts.
          Add this secret to your authenticator app (1Password, Google Authenticator, etc.).
        </p>

        {error ? (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="form-group">
          <label className="form-label">Authenticator Secret</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              readOnly
              value={enrollData.secret}
              className="form-input font-mono"
              style={{ letterSpacing: '0.05em' }}
            />
            <Button
              variant="secondary"
              size="md"
              onClick={handleCopySecret}
              icon={copied ? Check : Copy}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Key URI (Alternative)</label>
          <input
            type="text"
            readOnly
            value={enrollData.otpauth_uri}
            className="form-input font-mono"
            style={{ fontSize: '11px', color: 'var(--text-muted)' }}
          />
        </div>

        <Input
          label="Verification Code"
          type="text"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          mono
          autoFocus
          maxLength={8}
          helperText="Enter the 6-digit code shown in your authenticator app"
        />
      </form>
    </Modal>
  );
}
