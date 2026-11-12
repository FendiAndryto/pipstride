import React from 'react';
import { Table } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { formatDateTime, truncateId } from '../../domain/format';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function AuditTable({
  logs = [],
  total = 0,
  limit = 100,
  offset = 0,
  onOffsetChange,
  loading = false,
}) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const columns = [
    {
      header: 'Timestamp',
      key: 'created_at',
      render: (log) => (
        <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {formatDateTime(log.created_at)}
        </span>
      ),
    },
    {
      header: 'Actor',
      key: 'actor_username',
      render: (log) => (
        <div>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {log.actor_username || truncateId(log.user_id, 10)}
          </span>
          {log.ip_address ? (
            <div className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {log.ip_address}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      header: 'Action',
      key: 'action',
      render: (log) => {
        let variant = 'neutral';
        const act = (log.action || '').toLowerCase();
        if (act.includes('revoke') || act.includes('deactivate')) {
          variant = 'danger';
        } else if (act.includes('support') || act.includes('elevate')) {
          variant = 'warning';
        } else if (act.includes('activate') || act.includes('grant') || act.includes('entitlement')) {
          variant = 'success';
        }
        return <Badge variant={variant}>{log.action}</Badge>;
      },
    },
    {
      header: 'Target User',
      key: 'target_username',
      render: (log) => (
        log.target_username || log.target_user_id ? (
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>
              {log.target_username || truncateId(log.target_user_id, 10)}
            </span>
            {log.target_user_id && log.target_username ? (
              <div className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {truncateId(log.target_user_id, 10)}
              </div>
            ) : null}
          </div>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )
      ),
    },
    {
      header: 'Detail / Payload',
      key: 'detail',
      render: (log) => (
        <span
          className="font-mono"
          style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            maxWidth: '380px',
            display: 'inline-block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={log.detail || ''}
        >
          {log.detail || '—'}
        </span>
      ),
    },
  ];

  return (
    <div>
      <Table
        columns={columns}
        data={logs}
        keyExtractor={(l) => l.id}
        loading={loading}
        emptyText="No audit log entries recorded"
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
            Showing <span className="font-mono">{offset + 1}</span>–<span className="font-mono">{Math.min(offset + limit, total)}</span> of <span className="font-mono">{total}</span> entries
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
