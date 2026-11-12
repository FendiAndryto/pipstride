import React from 'react';
import { Table } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { formatNumber, formatRelativeTime, truncateId } from '../../domain/format';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function UsersTable({
  users = [],
  total = 0,
  limit = 50,
  offset = 0,
  onOffsetChange,
  onSelectUser,
  loading = false,
}) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const columns = [
    {
      header: 'User',
      key: 'username',
      render: (u) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.username}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }} className="font-mono">
            {truncateId(u.id, 12)}
          </div>
        </div>
      ),
    },
    {
      header: 'Role',
      key: 'role',
      render: (u) => {
        let variant = 'neutral';
        if (u.role === 'admin') variant = 'danger';
        else if (u.role === 'support') variant = 'warning';
        return <Badge variant={variant}>{u.role}</Badge>;
      },
    },
    {
      header: 'Status',
      key: 'is_active',
      render: (u) => (
        <Badge variant={u.is_active ? 'success' : 'neutral'}>
          {u.is_active ? 'Active' : 'Deactivated'}
        </Badge>
      ),
    },
    {
      header: 'Plan',
      key: 'plan_code',
      render: (u) => (
        <Badge variant={u.plan_code === 'pro' ? 'purple' : u.plan_code === 'plus' ? 'info' : 'neutral'}>
          {u.plan_code?.toUpperCase() || 'FREE'}
        </Badge>
      ),
    },
    {
      header: 'Connections',
      key: 'connections',
      render: (u) => (
        <span className="font-mono">
          <strong style={{ color: u.active_connection_count > 0 ? 'var(--accent-emerald)' : 'inherit' }}>
            {u.active_connection_count}
          </strong>
          <span style={{ color: 'var(--text-muted)' }}> / {u.max_connections}</span>
        </span>
      ),
    },
    {
      header: 'Trades',
      key: 'trade_count',
      render: (u) => <span className="font-mono">{formatNumber(u.trade_count)}</span>,
    },
    {
      header: 'Last Seen',
      key: 'last_seen_at',
      render: (u) => (
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {formatRelativeTime(u.last_seen_at)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <Table
        columns={columns}
        data={users}
        keyExtractor={(u) => u.id}
        onRowClick={onSelectUser}
        loading={loading}
        emptyText="No users found matching query"
      />

      {total > limit ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          <div>
            Showing <span className="font-mono">{offset + 1}</span>–<span className="font-mono">{Math.min(offset + limit, total)}</span> of <span className="font-mono">{total}</span> users
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button
              variant="secondary"
              size="sm"
              icon={ChevronLeft}
              disabled={offset <= 0 || loading}
              onClick={() => onOffsetChange(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <span style={{ padding: '0 8px' }}>
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + limit >= total || loading}
              onClick={() => onOffsetChange(offset + limit)}
            >
              Next
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
