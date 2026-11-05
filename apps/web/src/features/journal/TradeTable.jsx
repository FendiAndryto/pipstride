// Trade history table with pagination and empty states (ticket 006-04).

import React from 'react';
import { BookOpen, Layers } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export default function TradeTable({
  filteredTrades,
  paginatedTrades,
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  isHistoryLoading,
  activeAccountNumber
}) {
  const { t, locale } = useLanguage();

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div className="cardhead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen size={16} style={{ color: 'var(--g)' }} />
          <h3>{t('journal_history_title')}</h3>
        </div>
        <span className="tiny">{t('journal_records', { count: filteredTrades.length })}</span>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: '440px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#0e181e', zIndex: 2 }}>
            <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
              <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_ticket')}</th>
              <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_symbol')}</th>
              <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_direction')}</th>
              <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_lot')}</th>
              <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_exit')}</th>
              <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_source')}</th>
              <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px' }}>{t('journal_th_close_time')}</th>
              <th style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px', textAlign: 'right' }}>{t('journal_th_realized')}</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTrades.map((trade) => {
              const isEa = trade.magic > 0;
              const closeDateStr = trade.close_time
                ? new Date(trade.close_time * 1000).toLocaleString(locale, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
                : '—';
              const digits = trade.symbol.includes('JPY') ? 3 : trade.symbol.includes('XAU') ? 2 : 5;

              return (
                <tr key={trade.ticket} style={{ borderBottom: '1px solid #1c2b33' }}>
                  <td style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '11px', fontFamily: 'monospace' }}>
                    #{trade.ticket}
                  </td>
                  <td style={{ padding: '12px 8px', fontWeight: 800 }}>{trade.symbol}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span className={`tag ${trade.type === 'SELL' ? 'red' : ''}`}>{trade.type}</span>
                  </td>
                  <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>{trade.volume.toFixed(2)}</td>
                  <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>{trade.close_price.toFixed(digits)}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span className={`tag ${isEa ? 'blue' : ''}`}>{isEa ? 'EA' : 'Manual'}</span>
                  </td>
                  <td style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '11px' }}>{closeDateStr}</td>
                  <td
                    style={{
                      padding: '12px 8px',
                      textAlign: 'right',
                      fontWeight: 800,
                      color: trade.profit >= 0 ? 'var(--g)' : 'var(--red)'
                    }}
                  >
                    {trade.profit >= 0 ? '+' : '−'}${Math.abs(trade.profit).toFixed(2)}
                  </td>
                </tr>
              );
            })}
            {filteredTrades.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '36px 8px', textAlign: 'center', color: 'var(--muted)' }}>
                  <Layers size={28} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#c9d8dc' }}>
                    {isHistoryLoading
                      ? t('journal_loading_history')
                      : activeAccountNumber
                        ? t('journal_empty_account', { account: activeAccountNumber })
                        : t('journal_empty')}
                  </div>
                  <div style={{ fontSize: '11px', marginTop: '4px' }}>
                    {activeAccountNumber
                      ? t('journal_empty_desc_account', { account: activeAccountNumber })
                      : t('journal_empty_desc')}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '12px',
            marginTop: '10px',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            fontSize: '11px',
            color: 'var(--muted)'
          }}
        >
          <span>
            {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredTrades.length)} / {filteredTrades.length}
          </span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn alt"
              style={{ padding: '4px 10px', fontSize: '11px', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}
              disabled={currentPage <= 1}
              onClick={() => onPageChange((current) => Math.max(1, current - 1))}
            >
              &larr;
            </button>
            <span style={{ padding: '0 6px', fontWeight: 700, color: '#e6f1f2' }}>
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn alt"
              style={{ padding: '4px 10px', fontSize: '11px', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange((current) => Math.min(totalPages, current + 1))}
            >
              &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
