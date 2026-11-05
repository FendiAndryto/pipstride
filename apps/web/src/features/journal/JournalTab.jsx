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

export default function JournalTab({ activeTab, closedTradesCount, bridgeStatus, riskStatus, hasConnection = false }) {
  const { t, locale } = useLanguage();
  const [period, setPeriod] = useState('1M');

  const month = useMonthStepper(locale);
  const data = useJournalData({
    activeTab,
    closedTradesCount,
    bridgeStatus,
    hasConnection,
    period,
    month: { ...month, locale }
  });
  const { filter, setFilter, selectedSymbol, setSelectedSymbol, search, setSearch } = data;

  const basePeriodLabel = period === 'MONTH'
    ? t('journal_month_prefix', { month: month.monthName })
    : t(PERIOD_LABELS[period]);
  const periodLabel = selectedSymbol === 'ALL' ? basePeriodLabel : `${selectedSymbol} • ${basePeriodLabel}`;

  const handleExport = () => {
    const tradesToExport = data.filteredTrades.length > 0 ? data.filteredTrades : data.trades;
    if (!exportTradesCsv(tradesToExport, { symbol: selectedSymbol })) {
      alert(t('journal_export_empty'));
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" className="btn" onClick={handleExport} id="journal-export-btn" style={{ padding: '8px 14px' }}>
            <ArrowUpRight size={14} />
            <span>{t('journal_export')}</span>
          </button>
        </div>
      </div>

      {/* Period filter + month stepper */}
      <div className="journal-period-bar">
        <div className="journal-period-segmented" role="tablist" aria-label={t('journal_filter_aria')}>
          {PERIODS.map((option) => {
            const isActive = period === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`journal-period-tab ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setPeriod(option.value);
                  if (option.value === 'MONTH') month.setSelectedDate(null);
                }}
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
        <div className="journal-symbol-bar animate-fade-in" role="tablist" aria-label={t('journal_filter_symbol_aria')}>
          <div className="journal-symbol-chips">
            <button
              type="button"
              role="tab"
              aria-selected={selectedSymbol === 'ALL'}
              className={`journal-symbol-chip ${selectedSymbol === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedSymbol('ALL')}
              id="journal-symbol-all"
            >
              <span>{t('journal_symbol_all')}</span>
              <span className="journal-symbol-count">{data.trades.length}</span>
            </button>
            {data.tradedSymbols.map((symbol) => {
              const count = data.trades.filter((trade) => trade.symbol?.toUpperCase() === symbol).length;
              const isActive = selectedSymbol === symbol;
              return (
                <button
                  key={symbol}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`journal-symbol-chip ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedSymbol(symbol)}
                  id={`journal-symbol-${symbol.toLowerCase()}`}
                >
                  <span>{symbol}</span>
                  <span className="journal-symbol-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <KpiCards
        netPnl={data.netPnl}
        winRate={data.winRate}
        profitFactor={data.profitFactor}
        totalTrades={data.totalTrades}
        winningTrades={data.winningTrades}
        losingTrades={data.losingTrades}
        periodLabel={periodLabel}
      />

      <DrawdownCard bridgeStatus={bridgeStatus} riskStatus={riskStatus} />

      <JournalAnalytics
        stats={{
          ...data.activeStats,
          by_weekday: data.dayBuckets.length > 0 ? data.dayBuckets : (data.activeStats?.by_weekday || [])
        }}
        loading={data.isStatsLoading}
        periodLabel={periodLabel}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
      />

      {/* Source filter */}
      <div style={{ display: 'flex', gap: '7px', overflowX: 'auto', padding: '4px 0 12px' }}>
        {['All', 'Manual', 'EA'].map((option) => (
          <button
            key={option}
            type="button"
            className={`btn ${filter === option ? '' : 'alt'}`}
            style={{ fontSize: '11px', padding: '7px 14px' }}
            onClick={() => setFilter(option)}
          >
            {option === 'All' ? t('journal_filter_all') : option === 'EA' ? t('journal_filter_ea') : t('journal_filter_manual')}
          </button>
        ))}
      </div>

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
        filteredTrades={data.filteredTrades}
        paginatedTrades={data.paginatedTrades}
        currentPage={data.currentPage}
        totalPages={data.totalPages}
        pageSize={data.pageSize}
        onPageChange={data.setPage}
        isHistoryLoading={data.isHistoryLoading}
        activeAccountNumber={data.activeAccountNumber}
      />

      <MonthCalendar
        daysInMonth={month.daysInMonth}
        monthName={month.monthName}
        dailyPnlMap={data.dailyPnlMap}
        selectedDate={month.selectedDate}
        onSelectDate={month.setSelectedDate}
      />
    </div>
  );
}
