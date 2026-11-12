import React from 'react';
import { Table } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { formatDateTime, truncateId } from '../../domain/format';
import { formatCountdown, isSessionActive } from '../../domain/supportSession';
import { ShieldX } from 'lucide-react';

export function SupportSessionsTable({
  sessions = [],
  onRevokeSession,
  loading = false,
}) {
  const columns = [
    {
      header: 'Target User',
      key: 'target_username',
      render: (s) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {s.target_username || truncateId(s.target_user_id, 12)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }} className="font-mono">
            {truncateId(s.target_user_id, 12)}
          </div>
        </div>
      ),
    },
    {
      header: 'Operator',
      key: 'admin_username',
      render: (s) => (
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {s.admin_username || truncateId(s.admin_id, 10)}
        </span>
      ),
    },
    {
      header: 'Reason',
      key: 'reason',
      render: (s) => (
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {s.reason}
        </span>
      ),
    },
    {
      header: 'Status',
      key: 'active',
      render: (s) => {
        const active = isSessionActive(s);
        if (active) {
          return (
            <Badge variant="warning">
              Active ({formatCountdown(s.seconds_remaining)})
            </Badge>
          );
        }
        if (s.revoked_at) {
          return <Badge variant="danger">Revoked</Badge>;
        }
        return <Badge variant="neutral">Expired</Badge>;
      },
    },
    {
      header: 'Granted At',
      key: 'granted_at',
      render: (s) => (
        <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {formatDateTime(s.granted_at)}
        </span>
      ),
    },
    {
      header: 'Expires At',
      key: 'expires_at',
      render: (s) => (
        <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {formatDateTime(s.expires_at)}
        </span>
      ),
    },
    {
      header: 'Action',
      key: 'actions',
      render: (s) => {
        if (!isSessionActive(s)) {
          return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>;
        }
        return (
          <Button
            variant="danger"
            size="sm"
            icon={ShieldX}
            onClick={() => onRevokeSession(s.id)}
          >
            Revoke
          </Button>
        );
      },
    },
  ];

  return (
    <Table
      columns={columns}
      data={sessions}
      keyExtractor={(s) => s.id}
      loading={loading}
      emptyText="No support sessions recorded"
    />
  );
}
