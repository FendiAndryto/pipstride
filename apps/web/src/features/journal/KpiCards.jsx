// Journal KPI tiles (ticket 006-04). Numbers come from useJournalData, which
// takes them from the backend stats or domain/analytics for the MONTH window.

import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { formatSignedMoney, formatRatio } from '../../domain/format';

export default function KpiCards({ netPnl, winRate, profitFactor, totalTrades, winningTrades, losingTrades, periodLabel }) {
  const { t } = useLanguage();
  const tinyStyle = { color: 'var(--muted)', marginTop: '2px', fontSize: '9.5px' };

  return (
    <div className="grid-cards-responsive-2col four-cols-desktop">
      <div className="card" id="journal-kpi-net-pnl">
        <div className={`metric ${netPnl >= 0 ? 'positive' : 'negative'}`}>{formatSignedMoney(netPnl)}</div>
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
  );
}
