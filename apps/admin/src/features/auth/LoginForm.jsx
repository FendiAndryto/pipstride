import React, { useState } from 'react';
import { Lock, KeyRound, AlertCircle } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { login, startTotpEnroll } from './api';
import { TotpEnrollModal } from './TotpEnrollModal';
import { setToken, setStoredUser, clearStorage } from '../../lib/storage';

export function LoginForm({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotpField, setShowTotpField] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Pair Authenticator (TOTP enrollment) modal state
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrollData, setEnrollData] = useState(null);

  const performLogin = async (overrideTotp) => {
    setLoading(true);
    setError('');

    const codeToUse = overrideTotp !== undefined ? overrideTotp : totpCode;

    try {
      const res = await login({
        username: username.trim(),
        password,
        totp_code: codeToUse ? codeToUse.trim() : undefined,
      });

      // Role privilege gate: only admin or support permitted
      if (res.role !== 'admin' && res.role !== 'support') {
        clearStorage();
        throw new Error('This account has no admin console access.');
      }

      setToken(res.access_token, true);
      const userObj = {
        username: res.username || username.trim(),
        role: res.role,
        totp_enrolled: res.totp_enrolled,
      };
      setStoredUser(userObj, true);

      if (onLoginSuccess) {
        onLoginSuccess(userObj);
      }
    } catch (err) {
      const detail = err.message || '';

      // Check if 403 enrollment required
      if (err.status === 403 && detail.toLowerCase().includes('two-factor enrollment')) {
        try {
          const enroll = await startTotpEnroll({
            username: username.trim(),
            password,
          });
          setEnrollData(enroll);
          setEnrollModalOpen(true);
        } catch (enrollErr) {
          setError(enrollErr.message || 'Failed to initiate 2FA enrollment.');
        }
        return;
      }

      // Check if 401 requiring TOTP code
      if (err.status === 401 && (detail.toLowerCase().includes('two-factor') || detail.toLowerCase().includes('totp'))) {
        setShowTotpField(true);
      }

      setError(detail || 'Authentication failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Username and password are required.');
      return;
    }
    performLogin();
  };

  const handleEnrollSuccess = async (verifiedCode) => {
    setEnrollModalOpen(false);
    setEnrollData(null);
    setTotpCode(verifiedCode);
    setShowTotpField(true);
    // Automatic retry login with the verified TOTP code
    await performLogin(verifiedCode);
  };

  return (
    <div className="login-box">
      <div className="login-header">
        <div className="brand-badge">TELEMETRY ACCESS</div>
        <h1 style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-0.02em' }}>
          Pipstride Admin
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Authorized personnel only. Sessions are audited.
        </p>
      </div>

      {error ? (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input
          label="Operator Username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="admin"
          autoFocus
          required
          mono
        />

        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
          required
        />

        {showTotpField ? (
          <Input
            label="Two-Factor Code (TOTP)"
            type="text"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="123456"
            mono
            helperText="6-digit authenticator code"
            required
          />
        ) : null}

        <Button
          type="submit"
          variant="primary"
          loading={loading}
          icon={showTotpField ? KeyRound : Lock}
          style={{ marginTop: '8px' }}
        >
          {showTotpField ? 'Verify & Authenticate' : 'Sign In'}
        </Button>
      </form>

      {enrollModalOpen && enrollData ? (
        <TotpEnrollModal
          isOpen={enrollModalOpen}
          onClose={() => setEnrollModalOpen(false)}
          enrollData={enrollData}
          username={username.trim()}
          password={password}
          onSuccess={handleEnrollSuccess}
        />
      ) : null}
    </div>
  );
}
