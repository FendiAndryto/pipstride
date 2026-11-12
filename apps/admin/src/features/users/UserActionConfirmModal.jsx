import React from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { AlertTriangle } from 'lucide-react';

export function UserActionConfirmModal({
  isOpen,
  onClose,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = true,
  loading = false,
  onConfirm,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        <div style={{ color: danger ? 'var(--accent-rose)' : 'var(--accent-amber)', marginTop: '2px' }}>
          <AlertTriangle size={24} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {message}
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            This action will be recorded in the audit log with your operator identity and IP address.
          </p>
        </div>
      </div>
    </Modal>
  );
}
