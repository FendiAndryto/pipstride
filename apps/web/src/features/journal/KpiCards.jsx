// Journal KPI tiles (ticket 006-04). Numbers come from useJournalData, which
// takes them from the backend stats or domain/analytics for the MONTH window.
//
// The second row is the cash flow stream (ticket 013-03). It is rendered as a
// separate grid on purpose: deposits and withdrawals are funding events, not
// trading results, so they must not sit inside the PnL/win-rate cluster.

import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { formatCurrency, formatSignedMoney, formatRatio } from '../../domain/format';

export default function KpiCards({
  netPnl,
  winRate,
  profitFactor,
  totalTrades,
  winningTrades,
  losingTrades,
  cashFlow,
  periodLabel,
  period = 'ALL',
  currency = 'USD'
}) {
  const { t } = useLanguage();
  const tinyStyle = { color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' };

  return (
    <>
      <div className="grid-cards-responsive-2col four-cols-desktop">
        <div className="card" id="journal-kpi-net-pnl">
          <div className={`metric ${netPnl >= 0 ? 'positive' : 'negative'}`}>{formatSignedMoney(netPnl, currency)}</div>
          <div className="label">{t('journal_realized_pnl')}</div>
          <div className="tiny" style={tinyStyle}>{periodLabel}</div>
        </div>
        <div className="card" id="journal-kpi-win-rate">
          <div className="metric">{winRate.toFixed(1)}%</div>
          <div className="label">{t('journal_win_rate_detail', { wins: winningTrades, losses: losingTrades })}</div>
          <div className="tiny" style={tinyStyle}>{periodLabel}</div>
        </div>
        <div className="card" id="journal-kpi-profit-factor">
          <div className="metric">{formatRatio(profitFactor)}</div>
          <div className="label">{t('journal_profit_factor')}</div>
          <div className="tiny" style={tinyStyle}>
            {profitFactor === null ? t('journal_no_loss_trades') : periodLabel}
          </div>
        </div>
        <div className="card" id="journal-kpi-total-trades">
          <div className="metric">{totalTrades}</div>
          <div className="label">{t('journal_total_deals')}</div>
          <div className="tiny" style={tinyStyle}>{periodLabel}</div>
        </div>
      </div>

      {/* Cash flow: a separate grid, never merged into the trading metrics above. */}
      {cashFlow && (
        <>
          <div className="grid-cards-responsive-2col three-cols-desktop">
            <div className="card" id="journal-kpi-total-deposits">
              <div className="metric" style={{ color: 'var(--g)' }}>{formatCurrency(cashFlow.deposits, currency)}</div>
              <div className="label">{t('journal_stat_total_deposits_period', { period: periodLabel })}</div>
            </div>
            <div className="card" id="journal-kpi-total-withdrawals">
              <div className="metric" style={{ color: 'var(--muted)' }}>{formatCurrency(cashFlow.withdrawals, currency)}</div>
              <div className="label">{t('journal_stat_total_withdrawals_period', { period: periodLabel })}</div>
            </div>
            <div className="card" id="journal-kpi-net-funding">
              <div className={`metric ${cashFlow.netFunding >= 0 ? 'positive' : 'negative'}`}>{formatSignedMoney(cashFlow.netFunding, currency)}</div>
              <div className="label">{t('journal_stat_net_funding_period', { period: periodLabel })}</div>
            </div>
          </div>
          {period !== 'ALL' && cashFlow.deposits === 0 && cashFlow.withdrawals === 0 && (
            <div className="tiny" style={{ ...tinyStyle, marginTop: '6px' }}>
              {t('journal_cashflow_period_hint')}
            </div>
          )}
        </>
      )}
    </>
  );
}
