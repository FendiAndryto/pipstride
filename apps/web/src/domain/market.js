/**
 * Market-structure reads over the candles a heartbeat carries.
 *
 * The EA builds its candle arrays with `CopyRates` in series order and then
 * emits them oldest-first, so the wire order is **ascending by open time**. An
 * earlier version of the Market tab assumed newest-first: it sliced the *oldest*
 * bars and compared `window[last].open` against `window[0].close`, which reported
 * a different move than the one the chart shows and flipped the bias (a rising
 * market read as "lower lows"). `normalizeCandles` pins the order down so every
 * read below is chronological, whatever the producer sends.
 */

/** Structure buckets; the component maps them to translation keys. */
export const STRUCTURE = {
  HIGHER_HIGHS: 'higher_highs',
  LOWER_LOWS: 'lower_lows',
  CONSOLIDATION: 'consolidation'
};

function num(value) {
  // `Number(null)` and `Number('')` are 0, which would pass a finite check and
  // turn "no price" into "price 0" — the marker would then sit at the low band.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isUsable(candle) {
  if (!candle) return false;
  const time = num(candle.time);
  const open = num(candle.open);
  const high = num(candle.high);
  const low = num(candle.low);
  const close = num(candle.close);
  if (time === null || time <= 0) return false;
  if (open === null || close === null || open <= 0 || close <= 0) return false;
  if (high === null || low === null) return false;
  return high >= low && high > 0 && low > 0;
}

/** Chronological (oldest-first) copy of the usable candles, deduplicated by time. */
export function normalizeCandles(candles) {
  if (!Array.isArray(candles)) return [];
  const byTime = new Map();
  candles.filter(isUsable).forEach((candle) => {
    byTime.set(num(candle.time), {
      time: num(candle.time),
      open: num(candle.open),
      high: num(candle.high),
      low: num(candle.low),
      close: num(candle.close)
    });
  });
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** HH+HL = up-structure, LH+LL = down-structure, anything mixed = consolidation. */
function readStructure(window) {
  const third = Math.max(1, Math.floor(window.length / 3));
  if (window.length < third * 2) return null;

  const older = window.slice(-third * 2, -third);
  const recent = window.slice(-third);

  const olderHigh = Math.max(...older.map((c) => c.high));
  const olderLow = Math.min(...older.map((c) => c.low));
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));

  if (recentHigh > olderHigh && recentLow > olderLow) return STRUCTURE.HIGHER_HIGHS;
  if (recentHigh < olderHigh && recentLow < olderLow) return STRUCTURE.LOWER_LOWS;
  return STRUCTURE.CONSOLIDATION;
}

const EMPTY = {
  hasData: false,
  bars: 0,
  high: null,
  low: null,
  open: null,
  close: null,
  changePct: null,
  trend: null,
  structure: null,
  pricePositionPct: 50,
  rangeSpan: null,
  avgRange: null
};

/**
 * Read the newest `bars` candles as one window.
 *
 * `price` (the current bid) only places the marker inside the high/low band; a
 * missing price falls back to the middle rather than inventing a position.
 */
export function describeWindow(candles, bars, price) {
  const ordered = normalizeCandles(candles);
  const requested = num(bars);
  const count = requested !== null && requested >= 2 ? Math.floor(requested) : ordered.length;
  const window = ordered.slice(Math.max(0, ordered.length - count));

  if (window.length < 2) return { ...EMPTY, bars: window.length };

  const open = window[0].open;
  const close = window[window.length - 1].close;
  if (open <= 0 || close <= 0) return { ...EMPTY, bars: window.length };

  const highs = window.map((c) => c.high);
  const lows = window.map((c) => c.low);
  const high = Math.max(...highs);
  const low = Math.min(...lows);

  const changePct = ((close - open) / open) * 100;
  const bid = num(price);
  const pricePositionPct =
    bid !== null && high > low
      ? Math.max(2, Math.min(98, ((bid - low) / (high - low)) * 100))
      : 50;

  return {
    hasData: true,
    bars: window.length,
    high,
    low,
    open,
    close,
    changePct,
    trend: changePct >= 0 ? 'BULLISH' : 'BEARISH',
    structure: readStructure(window),
    pricePositionPct,
    rangeSpan: high - low,
    avgRange: average(window.map((c) => c.high - c.low))
  };
}
