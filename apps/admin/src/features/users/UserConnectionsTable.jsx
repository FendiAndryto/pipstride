import React from 'react';
import { Table } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { formatNumber, formatRelativeTime } from '../../domain/format';
import { ShieldX } from 'lucide-react';

export function UserConnectionsTable({
  connections = [],
  canRevoke = true,
  onRevokeConnection,
  loading = false,
}) {
  const columns = [
    {
      header: 'Label',
      key: 'label',
      render: (c) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }} className="font-mono">
            {c.broker_server || 'No server reported'}
          </div>
        </div>
      ),
    },
    {
      header: 'Token Prefix',
      key: 'token_prefix',
      render: (c) => (
        <span className="font-mono" style={{ color: 'var(--accent-emerald)', fontSize: '12px' }}>
          {c.token_prefix}••••
        </span>
      ),
    },
    {
      header: 'Account #',
      key: 'account_number',
      render: (c) => (
        <span className="font-mono">
          {c.account_number ? `${c.account_number} (${c.account_currency || 'USD'})` : '—'}
        </span>
      ),
    },
    {
      header: 'Status',
      key: 'status',
      render: (c) => {
        let variant = 'neutral';
        if (c.status === 'connected' || c.status === 'active') variant = 'success';
        else if (c.status === 'pending') variant = 'warning';
        else if (c.status === 'revoked') variant = 'danger';
        return <Badge variant={variant}>{c.status}</Badge>;
      },
    },
    {
      header: 'Trades',
      key: 'trade_count',
      render: (c) => <span className="font-mono">{formatNumber(c.trade_count)}</span>,
    },
    {
      header: 'Last Seen',
      key: 'last_seen_at',
      render: (c) => (
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {formatRelativeTime(c.last_seen_at)}
        </span>
      ),
    },
  ];

  if (canRevoke) {
    columns.push({
      header: 'Action',
      key: 'actions',
      render: (c) => {
        const isRevoked = c.status === 'revoked' || Boolean(c.revoked_at);
        if (isRevoked) {
          return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Revoked</span>;
        }
        return (
          <Button
            variant="danger"
            size="sm"
            icon={ShieldX}
            onClick={() => onRevokeConnection(c)}
          >
            Revoke
          </Button>
        );
      },
    });
  }

  return (
    <Table
      columns={columns}
      data={connections}
      keyExtractor={(c) => c.id}
      loading={loading}
      emptyText="No MT5 connections attached to this account"
    />
  );
}
