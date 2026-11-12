import React, { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Table } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { fetchElevatedDetail } from './api';
import { formatCurrency, formatDateTime } from '../../domain/format';
import { Eye, EyeOff, AlertCircle, TrendingUp, Sliders } from 'lucide-react';

export function ElevatedDetailPanel({
  userId,
  isActiveSession,
}) {
  const [elevatedData, setElevatedData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchElevatedDetail(userId);
      setElevatedData(data);
      setVisible(true);
    } catch (err) {
      setError(err.detail || err.message || 'Failed to fetch elevated detail.');
      setElevatedData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (visible) {
      setVisible(false);
    } else {
      loadData();
    }
  };

  if (!isActiveSession) {
    return null;
  }

  const tradeColumns = [
    {
      header: 'Ticket #',
      key: 'ticket',
      render: (t) => <span className="font-mono">{t.ticket}</span>,
    },
    {
      header: 'Symbol',
      key: 'symbol',
      render: (t) => <strong>{t.symbol}</strong>,
    },
    {
      header: 'Direction',
      key: 'direction',
      render: (t) => (
        <Badge variant={t.direction?.toUpperCase() === 'BUY' ? 'success' : 'danger'}>
          {t.direction?.toUpperCase()}
        </Badge>
      ),
    },
    {
      header: 'Volume',
      key: 'volume',
      render: (t) => <span className="font-mono">{t.volume}</span>,
    },
    {
      header: 'Profit',
      key: 'profit',
      render: (t) => {
        const isPos = t.profit > 0;
        const isNeg = t.profit < 0;
        const color = isPos ? 'var(--accent-emerald)' : isNeg ? 'var(--accent-rose)' : 'inherit';
        return (
          <span className="font-mono" style={{ color, fontWeight: 600 }}>
            {formatCurrency(t.profit)}
          </span>
        );
      },
    },
    {
      header: 'Opened At',
      key: 'opened_at',
      render: (t) => (
        <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {formatDateTime(t.opened_at)}
        </span>
      ),
    },
    {
      header: 'Closed At',
      key: 'closed_at',
      render: (t) => (
        <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {formatDateTime(t.closed_at)}
        </span>
      ),
    },
  ];

  const settingColumns = [
    {
      header: 'Connection ID',
      key: 'connection_id',
      render: (s) => <span className="font-mono">{s.connection_id}</span>,
    },
    {
      header: 'Custom Initial Deposit',
      key: 'custom_initial_deposit',
      render: (s) => (
        <span className="font-mono">
          {formatCurrency(s.custom_initial_deposit)}
        </span>
      ),
    },
    {
      header: 'Updated At',
      key: 'updated_at',
      render: (s) => (
        <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {formatDateTime(s.updated_at)}
        </span>
      ),
    },
  ];

  return (
    <Card
      title="Private Financial Records"
      subtitle="Elevated support access granted under current session"
      badge={<Badge variant="warning">SUPPORT MODE</Badge>}
      actions={
        <Button
          variant={visible ? 'secondary' : 'primary'}
          size="sm"
          icon={visible ? EyeOff : Eye}
          loading={loading}
          onClick={handleToggle}
        >
          {visible ? 'Hide Private Records' : 'View Private Detail'}
        </Button>
      }
    >
      {error ? (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {visible && elevatedData ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <TrendingUp size={16} style={{ color: 'var(--accent-emerald)' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 600 }}>Recorded User Trades</h3>
              <Badge variant="neutral">{elevatedData.trades?.length || 0}</Badge>
            </div>
            <Table
              columns={tradeColumns}
              data={elevatedData.trades || []}
              keyExtractor={(t) => t.id || t.ticket}
              emptyText="No private trades recorded for this user"
            />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Sliders size={16} style={{ color: 'var(--accent-blue)' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 600 }}>Account Settings Overrides</h3>
              <Badge variant="neutral">{elevatedData.account_settings?.length || 0}</Badge>
            </div>
            <Table
              columns={settingColumns}
              data={elevatedData.account_settings || []}
              keyExtractor={(s) => s.connection_id}
              emptyText="No custom account settings configured"
            />
          </div>
        </div>
      ) : (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Financial telemetry records (trades and deposit settings) are hidden by default to enforce
          the ADR 0008 privacy boundary. Click &ldquo;View Private Detail&rdquo; to load them under
          your active session.
        </p>
      )}
    </Card>
  );
}
