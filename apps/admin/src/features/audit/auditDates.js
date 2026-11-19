const DAY_MS = 86_400_000;

function utcMidnight(date) {
  const moment = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-') ||
    !Number.isFinite(moment.getTime()) || moment.toISOString().slice(0, 10) !== date) {
    throw new Error('Enter a valid calendar date.');
  }
  return moment;
}

export function auditDateBounds(from, through) {
  const first = from ? utcMidnight(from) : null;
  const last = through ? utcMidnight(through) : null;
  if (first && last && first > last) {
    throw new Error('The start date must be on or before the end date.');
  }
  if (through === '9999-12-31') throw new Error('Choose an earlier end date.');

  return {
    start: first?.toISOString(),
    end: last ? new Date(last.getTime() + DAY_MS).toISOString() : undefined
  };
}
