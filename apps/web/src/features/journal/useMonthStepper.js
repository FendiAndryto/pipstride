// Month selection for the journal calendar (ticket 006-04).
// Owns the "YYYY-MM" value, the month arithmetic and the parsed parts, so the
// component only renders the stepper.

import { useMemo, useState } from 'react';

export const currentYearMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export function useMonthStepper(locale) {
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
  const [selectedDate, setSelectedDate] = useState(null);
  // Captured once per mount so render stays pure (no Date call in the body).
  const [todayYearMonth] = useState(currentYearMonth);

  const isCurrentOrFutureMonth = selectedMonth >= todayYearMonth;

  const { selectedYear, selectedMonthIndex, daysInMonth, monthName } = useMemo(() => {
    const parts = (selectedMonth || '').split('-');
    const fallbackYear = parseInt(todayYearMonth.slice(0, 4), 10) || 1970;
    const year = parseInt(parts[0], 10) || fallbackYear;
    const monthIdx = (parseInt(parts[1], 10) || 1) - 1;
    const days = new Date(year, monthIdx + 1, 0).getDate();
    const name = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, monthIdx, 1));
    return { selectedYear: year, selectedMonthIndex: monthIdx, daysInMonth: days, monthName: name };
  }, [selectedMonth, locale, todayYearMonth]);

  const shiftMonth = (delta) => {
    let year = selectedYear;
    let month = selectedMonthIndex + delta;
    if (month < 0) {
      month = 11;
      year -= 1;
    } else if (month > 11) {
      month = 0;
      year += 1;
    }
    setSelectedMonth(`${year}-${String(month + 1).padStart(2, '0')}`);
    setSelectedDate(null);
  };

  const prevMonth = () => shiftMonth(-1);
  const nextMonth = () => {
    if (isCurrentOrFutureMonth) return;
    shiftMonth(1);
  };

  const selectMonth = (value) => {
    if (!value) return;
    const max = currentYearMonth();
    setSelectedMonth(value > max ? max : value);
    setSelectedDate(null);
  };

  /** Opens the native month picker from the display element. */
  const openPicker = (event) => {
    const input = event?.currentTarget?.querySelector('input[type="month"]');
    if (!input || event.target === input) return;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        // Fall through to focus/click for browsers without a usable picker.
      }
    }
    input.focus();
    input.click();
  };

  return {
    selectedMonth,
    selectedDate,
    setSelectedDate,
    maxMonth: todayYearMonth,
    isCurrentOrFutureMonth,
    selectedYear,
    selectedMonthIndex,
    daysInMonth,
    monthName,
    prevMonth,
    nextMonth,
    selectMonth,
    openPicker
  };
}
