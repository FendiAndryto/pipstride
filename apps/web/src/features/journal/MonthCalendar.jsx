// Month calendar with daily PnL (ticket 006-04). Selection state lives in
// useMonthStepper; the daily map is derived by useJournalData.

import React from 'react';
import { Calendar } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { formatSignedMoney } from '../../domain/format';

const WEEKDAYS = [
  'journal_weekday_mon',
  'journal_weekday_tue',
  'journal_weekday_wed',
  'journal_weekday_thu',
  'journal_weekday_fri',
  'journal_weekday_sat',
  'journal_weekday_sun'
];

export default function MonthCalendar({ daysInMonth, monthName, dailyPnlMap, selectedDate, onSelectDate, currency = 'USD' }) {
  const { t } = useLanguage();

  return (
    <>
      <div className="section" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <Calendar size={16} style={{ color: 'var(--g)' }} />
        <span>{t('journal_calendar')}</span>
        <span className="tiny" style={{ textTransform: 'capitalize' }}>{monthName}</span>
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px' }}>
          {WEEKDAYS.map((day) => (
            <div key={day} className="tiny" style={{ textAlign: 'center', padding: '4px', fontWeight: 700 }}>
              {t(day)}
            </div>
          ))}
          {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
            const dayPnl = dailyPnlMap[day];
            const hasTrades = dayPnl !== undefined;
            const isLoss = hasTrades && dayPnl < 0;
            const isWin = hasTrades && dayPnl > 0;
            return (
              <button
                key={day}
                type="button"
                onClick={() => onSelectDate(day)}
                style={{
                  border: selectedDate === day ? '1px solid var(--g)' : '1px solid #23373f',
                  borderRadius: '8px',
                  padding: '6px 2px',
                  background: isLoss ? '#48242a' : isWin ? '#164236' : '#142229',
                  color: isLoss ? '#ff9ba5' : isWin ? '#7ce8be' : '#8fa2a8',
                  fontSize: '9.5px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  minWidth: 0,
                  overflow: 'hidden'
                }}
              >
                <span>{day}</span>
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '8.5px',
                    fontWeight: hasTrades ? 700 : 400
                  }}
                >
                  {hasTrades ? formatSignedMoney(dayPnl, currency, 0) : '·'}
                </span>
              </button>
            );
          })}
        </div>
        {selectedDate && (
          <div className="tiny" style={{ marginTop: '12px', color: 'var(--g)' }}>
            {t('journal_day_detail', {
              day: selectedDate,
              month: monthName,
              pnl: dailyPnlMap[selectedDate] !== undefined
                ? formatSignedMoney(dailyPnlMap[selectedDate], currency)
                : t('journal_no_closed_trade')
            })}
          </div>
        )}
      </div>
    </>
  );
}
