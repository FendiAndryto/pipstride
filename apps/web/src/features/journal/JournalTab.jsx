// Journal screen composition (ticket 006-04). All data, month state and
// analytics live in hooks/domain modules; this file only arranges the UI.

import React, { useState } from 'react';
import { Calendar, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import JournalAnalytics from '../../components/JournalAnalytics';
import { exportTradesCsv } from '../../lib/csv';
import { useMonthStepper } from './useMonthStepper';
import { useJournalData } from './useJournalData';
import KpiCards from './KpiCards';
import DrawdownCard from './DrawdownCard';
import TradeTable from './TradeTable';
import MonthCalendar from './MonthCalendar';

const PERIODS = [
  { value: '1M', label: 'journal_period_1m' },
  { value: '3M', label: 'journal_period_3m' },
  { value: '1Y', label: 'journal_period_1y' },
  { value: 'ALL', label: 'journal_period_all' },
  { value: 'MONTH', label: 'journal_period_month' }
];

const PERIOD_LABELS = {
  '1M': 'journal_period_label_1m',
  '3M': 'journal_period_label_3m',
  '1Y': 'journal_period_label_1y',
  ALL: 'journal_period_label_all',
  MONTH: 'journal_period_label_month'
};

export default function JournalTab({ activeTab, closedTradesCount, bridgeStatus, riskStatus, hasConnection = false, connectionId }) {
  const { t, locale } = useLanguage();
  const [period, setPeriod] = useState('ALL');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const month = useMonthStepper(locale);
  const calendarMonth = useMonthStepper(locale);
  // Account currency drives every nominal on this screen (ticket 011-02):
  // Cent accounts quote in USC, so hardcoded "$" would misreport 1,298.80 USC as dollars.
  const currency = bridgeStatus?.metrics?.currency || 'USD';
  const data = useJournalData({
    activeTab,
    closedTradesCount,
    bridgeStatus,
    hasConnection,
    connectionId,
    period,
    month,
    calendarMonth
  });
  const { filter, setFilter, selectedSymbol, setSelectedSymbol, search, setSearch } = data;

  const basePeriodLabel = period === 'MONTH'
    ? t('journal_month_prefix', { month: month.monthName })
    : t(PERIOD_LABELS[period]);
  const periodLabel = selectedSymbol === 'ALL' ? basePeriodLabel : `${selectedSymbol} • ${basePeriodLabel}`;

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const trades = await data.exportTrades();
      if (!exportTradesCsv(trades, { symbol: selectedSymbol })) setExportError('journal_export_empty');
    } catch {
      setExportError('journal_export_error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="journal-tab-container animate-fade-in">
      <div className="heading">
        <div>
          <div className="eyebrow">{t('journal_eyebrow')}</div>
          <h1>{t('journal_title')}</h1>
          <div className="sub">{t('journal_sub')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            onClick={handleExport}
            disabled={exporting || data.isHistoryLoading || data.historyError || !data.canExportTrades}
            id="journal-export-btn"
            style={{ padding: '8px 14px' }}
          >
            <ArrowUpRight size={14} />
            <span>{exporting ? t('journal_export_loading') : t('journal_export')}</span>
          </button>
          {exportError && <span role="alert" className="tiny">{t(exportError)}</span>}
        </div>
      </div>

      {/* Period filter + month stepper */}
      <div className="journal-period-bar">
        <div className="journal-period-segmented" role="group" aria-label={t('journal_filter_aria')}>
          {PERIODS.map((option) => {
            const isActive = period === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                className={`journal-period-tab ${isActive ? 'active' : ''}`}
                onClick={() => setPeriod(option.value)}
                id={`journal-period-${option.value.toLowerCase()}`}
              >
                {option.value === 'MONTH' && <Calendar size={12} />}
                <span>{t(option.label)}</span>
              </button>
            );
          })}
        </div>

        {period === 'MONTH' && (
          <div className="journal-month-stepper animate-fade-in" id="journal-month-stepper">
            <button
              type="button"
              className="journal-stepper-btn"
              onClick={month.prevMonth}
              aria-label={t('journal_prev_month')}
              title={t('journal_prev_month')}
              id="journal-prev-month-btn"
            >
              <ChevronLeft size={15} />
            </button>

            <div className="journal-month-display" onClick={month.openPicker} title={t('journal_pick_month')}>
              <Calendar size={13} style={{ color: 'var(--g)' }} />
              <span style={{ textTransform: 'capitalize' }}>{month.monthName}</span>
              <input
                type="month"
                id="journal-month-input"
                name="selected_month"
                value={month.selectedMonth}
                max={month.maxMonth}
                aria-label={t('journal_select_month')}
                onChange={(e) => month.selectMonth(e.target.value)}
                className="journal-month-input-overlay"
              />
            </div>

            <button
              type="button"
              className="journal-stepper-btn"
              onClick={month.nextMonth}
              disabled={month.isCurrentOrFutureMonth}
              aria-label={t('journal_next_month')}
              title={t('journal_next_month')}
              id="journal-next-month-btn"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Symbol chips */}
      {data.tradedSymbols.length > 0 && (
        <div className="journal-symbol-bar animate-fade-in" role="group" aria-label={t('journal_filter_symbol_aria')}>
          <div className="journal-symbol-chips">
            <button
              type="button"
              aria-pressed={selectedSymbol === 'ALL'}
              className={`journal-symbol-chip ${selectedSymbol === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedSymbol('ALL')}
              id="journal-symbol-all"
            >
              <span>{t('journal_symbol_all')}</span>
              <span className="journal-symbol-count">{data.symbolTradeCount}</span>
            </button>
            {data.tradedSymbols.map((symbol) => {
              const isActive = selectedSymbol === symbol;
              return (
                <button
                  key={symbol}
                  type="button"
                  aria-pressed={isActive}
                  className={`journal-symbol-chip ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedSymbol(symbol)}
                  id={`journal-symbol-${symbol.toLowerCase()}`}
                >
                  <span>{symbol}</span>
                  <span className="journal-symbol-count">{data.symbolCounts[symbol]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Source filter */}
      <div role="group" aria-label={t('journal_filter_source_aria')} style={{ display: 'flex', gap: '7px', overflowX: 'auto', padding: '4px 0 12px' }}>
        {['All', 'Manual', 'EA'].map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            className={`btn ${filter === option ? '' : 'alt'}`}
            style={{ fontSize: '11px', padding: '7px 14px' }}
            onClick={() => setFilter(option)}
          >
            {option === 'All' ? t('journal_filter_all') : option === 'EA' ? t('journal_filter_ea') : t('journal_filter_manual')}
          </button>
        ))}
      </div>

      {data.isStatsLoading || data.statsError ? (
        <div className="card tiny" role={data.statsError ? 'alert' : 'status'} style={{ marginBottom: '16px' }}>
          {data.statsError ? t('journal_stats_error') : t('ja_calculating')} · {periodLabel}
        </div>
      ) : (
        <KpiCards
          netPnl={data.netPnl}
          winRate={data.winRate}
          profitFactor={data.profitFactor}
          totalTrades={data.totalTrades}
          winningTrades={data.winningTrades}
          losingTrades={data.losingTrades}
          cashFlow={data.cashFlowStats}
          periodLabel={periodLabel}
          cashFlowPeriodLabel={basePeriodLabel}
          period={period}
          currency={currency}
        />
      )}

      <DrawdownCard bridgeStatus={bridgeStatus} riskStatus={riskStatus} />

      {!data.isStatsLoading && !data.statsError && (
        <JournalAnalytics
          stats={data.activeStats}
          periodLabel={periodLabel}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={setSelectedSymbol}
          currency={currency}
        />
      )}

      {/* Search */}
      <div style={{ marginBottom: '14px' }}>
        <input
          id="journal-search-input"
          name="search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('journal_search_ph')}
          aria-label={t('journal_search_ph')}
          style={{
            width: '100%',
            background: '#0b151b',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            padding: '10px 14px',
            borderRadius: '10px',
            outline: 'none',
            fontSize: '12px'
          }}
        />
      </div>

      <TradeTable
        totalRows={data.totalRows}
        paginatedRows={data.paginatedRows}
        currentPage={data.currentPage}
        totalPages={data.totalPages}
        pageSize={data.pageSize}
        onPageChange={data.setPage}
        isHistoryLoading={data.isHistoryLoading}
        historyError={data.historyError}
        hasFilters={period !== 'ALL' || selectedSymbol !== 'ALL' || filter !== 'All' || Boolean(search.trim())}
        periodLabel={periodLabel}
        activeAccountNumber={data.activeAccountNumber}
        currency={currency}
      />

      <MonthCalendar
        month={calendarMonth}
        dailyPnlMap={data.calendarDailyPnl}
        loading={data.calendarLoading}
        error={data.calendarError}
        currency={currency}
      />
    </div>
  );
}
