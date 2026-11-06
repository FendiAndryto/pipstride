/**
 * Market-structure reads over the candles a heartbeat carries.
 *
 * Two separate questions, deliberately answered by two separate windows:
 *
 * *bias* — which way price has been moving **lately**. Six recent candles, open
 * of the oldest of them to the latest close. A net change across a whole
 * 24-candle window is a different animal: on H4 that is four days, so a rally
 * earlier in the week kept the badge green while the current leg turned down.
 * Three candles were too twitchy at the other end — H4 flipped red on a single
 * red H4 bar even though the higher lows were intact. Six matches the read a
 * trader makes off the chart: H1 stays bearish through a pullback while H4 is
 * still bullish (spec 003, D8).
 *
 * *structure* — whether the latest swing made a higher high + higher low or a
 * lower high + lower low, comparing the last six candles against the six before
 * them. Mixed means consolidation: price is inside the prior range.
 *
 * *range* — high/low/support/resistance over the full window (`bars`), which is
 * what the card's range strip and stats grid describe.
 *
 * The wire order is **ascending by open time** (the EA emits `CopyRates` output
 * reversed), so `normalizeCandles` sorts explicitly: slicing `[0, bars]` used to
 * read the oldest bars and flip every number.
 */

/** Candles that define "lately": the direction of the current leg. */
export const BIAS_BARS = 6;

/** Candles per half when comparing swings: six recent against six before them. */
export const STRUCTURE_BARS = 6;

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

/**
 * Compare a watchlist base symbol (`XAUUSD`) with the raw chart symbol the EA
 * reports (`XAUUSDc`, `XAUUSD.a`, `XAUUSD#`, ...).
 *
 * MT5 names the chart symbol with the broker's suffix while the watchlist uses
 * the plain base name, so comparing the two strings literally marked a healthy
 * feed as a different instrument and blanked the whole structure card. The rule
 * mirrors the EA's `FindBrokerSymbol`: equal names, or the base as a prefix with
 * at most four extra characters.
 */
export function isSameInstrument(baseSymbol, chartSymbol) {
  const base = typeof baseSymbol === 'string' ? baseSymbol.toUpperCase().replace(/[^A-Z0-9]+/g, '') : '';
  const chart = typeof chartSymbol === 'string' ? chartSymbol.toUpperCase().replace(/[^A-Z0-9]+/g, '') : '';
  if (!base || !chart) return false;
  if (base === chart) return true;
  if (!chart.startsWith(base)) return false;
  return chart.length - base.length <= 4;
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
function readStructure(bars) {
  if (bars.length < STRUCTURE_BARS * 2) return null;
  const recent = bars.slice(-STRUCTURE_BARS);
  const older = bars.slice(-STRUCTURE_BARS * 2, -STRUCTURE_BARS);

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
  biasBars: 0,
  high: null,
  low: null,
  open: null,
  close: null,
  changePct: null,
  windowChangePct: null,
  trend: null,
  structure: null,
  pricePositionPct: 50,
  rangeSpan: null,
  avgRange: null
};

/**
 * Read the newest `bars` candles: bias from the last three, structure from the
 * last six, range statistics from the whole window.
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

  const biasWindow = window.slice(-BIAS_BARS);
  const biasOpen = biasWindow[0].open;
  const changePct = ((close - biasOpen) / biasOpen) * 100;
  const windowChangePct = ((close - open) / open) * 100;

  const bid = num(price);
  const pricePositionPct =
    bid !== null && high > low
      ? Math.max(2, Math.min(98, ((bid - low) / (high - low)) * 100))
      : 50;

  return {
    hasData: true,
    bars: window.length,
    biasBars: biasWindow.length,
    high,
    low,
    open,
    close,
    changePct,
    windowChangePct,
    trend: changePct >= 0 ? 'BULLISH' : 'BEARISH',
    structure: readStructure(window),
    pricePositionPct,
    rangeSpan: high - low,
    avgRange: average(window.map((c) => c.high - c.low))
  };
}
