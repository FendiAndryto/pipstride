import React, { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { createSupportSession } from './api';
import { ShieldAlert, AlertCircle } from 'lucide-react';

export function SupportGrantModal({
  isOpen,
  onClose,
  targetUser,
  onSuccess,
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason || reason.trim().length < 3) {
      setError('A specific reason (minimum 3 characters) is required for support elevation.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const session = await createSupportSession({
        target_user_id: targetUser.id,
        reason: reason.trim(),
      });
      onSuccess(session);
      onClose();
    } catch (err) {
      setError(err.detail || err.message || 'Failed to grant support session.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Open Elevated Support Session"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            icon={ShieldAlert}
          >
            Grant 30-Minute Access
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="alert alert-warning">
          <ShieldAlert size={18} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '12px' }}>
            <strong>Privacy Boundary Warning (ADR 0008 §6):</strong>
            <p style={{ marginTop: '4px' }}>
              Opening a support session temporarily lifts metadata redaction for{' '}
              <strong>{targetUser?.username}</strong>. This grant is logged in the audit trail
              and <strong>will be visible to the user</strong> in their account access log.
            </p>
          </div>
        </div>

        {error ? (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <Input
          label="Support Justification / Ticket Reference"
          placeholder="e.g. Investigating trade reconciliation mismatch on ticket #4928"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          helperText="Reason must explain the operational requirement (min 3 chars)"
          autoFocus
          required
        />
      </form>
    </Modal>
  );
}
