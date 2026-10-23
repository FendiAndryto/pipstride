import React from 'react';
import { Layers } from 'lucide-react';

const formatCurrency = (val, currency = 'USD') => {
  if (val === null || val === undefined) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

export default function PositionsTable({ positions = [], currency = 'USD' }) {
  const totalPnL = positions.reduce((acc, p) => acc + (p.pnl || 0), 0);

  return (
    <div className="positions-panel glass-panel" id="positions-table-panel">
      <div className="positions-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="metric-icon-box" style={{ color: 'var(--accent-cyan)' }}>
            <Layers size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Active Open Positions</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {positions.length} active trade{positions.length === 1 ? '' : 's'} on MT5 · Full-Auto Telemetry
            </span>
          </div>
        </div>

        {positions.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Floating</span>
              <div
                className="font-mono"
                style={{
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  color: totalPnL >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                }}
              >
                {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL, currency)}
              </div>
            </div>
          </div>
        )}
      </div>

      {positions.length === 0 ? (
        <div className="empty-positions-state" id="empty-positions-placeholder">
          <Layers size={36} style={{ opacity: 0.25, marginBottom: '0.5rem' }} />
          <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>No Active Open Positions</p>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Posisi akan dibuka secara otomatis oleh robot AutoPilot saat konfluensi sinyal terpenuhi.
          </span>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="positions-table" id="positions-data-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Symbol</th>
                <th>Type</th>
                <th>Lots</th>
                <th>Open Price</th>
                <th>Current</th>
                <th>SL / TP</th>
                <th style={{ textAlign: 'right' }}>Profit / Loss</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const isProfit = (pos.pnl || 0) >= 0;
                return (
                  <tr key={pos.ticket} id={`position-row-${pos.ticket}`}>
                    <td className="font-mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      #{pos.ticket}
                    </td>
                    <td style={{ fontWeight: 700, color: '#ffffff' }}>
                      {pos.symbol}
                    </td>
                    <td>
                      <span className={`trade-badge ${pos.type === 'BUY' ? 'buy' : 'sell'}`}>
                        {pos.type}
                      </span>
                    </td>
                    <td className="font-mono">{pos.volume?.toFixed(2)}</td>
                    <td className="font-mono">{pos.open_price?.toFixed(5)}</td>
                    <td className="font-mono">{pos.current_price ? pos.current_price.toFixed(5) : '-'}</td>
                    <td className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {pos.sl ? pos.sl.toFixed(5) : '-'} / {pos.tp ? pos.tp.toFixed(5) : '-'}
                    </td>
                    <td
                      className="font-mono"
                      style={{
                        fontWeight: 700,
                        textAlign: 'right',
                        color: isProfit ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                      }}
                    >
                      {isProfit ? '+' : ''}{formatCurrency(pos.pnl, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
