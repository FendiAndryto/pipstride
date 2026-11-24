import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { beforeAll, expect, it } from 'vitest';

const window = { addEventListener() {} };
const candles = [
  { time: 1, open: 3, high: 5, low: 1, close: 4, volume: 10 },
  { time: 2, open: 5, high: 7, low: 3, close: 6, volume: 20 },
  { time: 3, open: 7, high: 9, low: 5, close: 8, volume: 30 },
  { time: 4, open: 8, high: 8, low: 4, close: 6, volume: 40 },
  { time: 5, open: 6, high: 8, low: 4, close: 6, volume: 50 },
];

beforeAll(async () => {
  for (const file of ['replay_indicators.js', 'replay_chart.js']) {
    const source = await readFile(new URL('../public/replay/js/' + file, import.meta.url), 'utf8');
    runInNewContext(source, { window, setTimeout });
  }
});

it('calculates volume, OBV, stochastic, DMI and Donchian with their expected signs and warmups', () => {
  const read = (type, parameters) => window.ReplayIndicators.calculate(type, candles, parameters)
    .map((series) => series.map((point) => point.value));

  expect(read('volume')).toEqual([[10, 20, 30, 40, 50]]);
  expect(read('obv')).toEqual([[0, 20, 50, 10, 10]]);
  expect(read('stochastic', { period: 2, smooth: 1, signal: 2 })).toEqual([
    [undefined, 100 * 5 / 6, 100 * 5 / 6, 40, 50],
    [undefined, undefined, 100 * 5 / 6, (100 * 5 / 6 + 40) / 2, 45],
  ]);
  const [adx, plus, minus] = read('adx', { period: 2 });
  expect(adx.slice(0, 3)).toEqual([undefined, undefined, undefined]);
  expect(adx[3]).toBeCloseTo(200 / 3);
  expect(adx[4]).toBeCloseTo(50);
  expect(plus).toEqual([undefined, undefined, 50, 25, 12.5]);
  expect(minus).toEqual([undefined, undefined, 0, 12.5, 6.25]);
  expect(read('donchian', { period: 2 })).toEqual([
    [undefined, 4, 6, 6.5, 6],
    [undefined, 7, 9, 9, 8],
    [undefined, 1, 3, 4, 4],
  ]);
});

it('migrates applied legacy settings and round-trips independent instances', () => {
  const { preferences } = window.ReplayIndicators;
  const migrated = preferences(null, {
    ema: { enabled: true, size: 'large', parameters: { period: 5 } },
    rsi: { applied: true, enabled: false, parameters: { period: 11, lower: 70, upper: 30 } },
    atr: { applied: false },
  });
  expect(migrated).toEqual([
    { id: 'legacy-ema', type: 'ema', enabled: true, size: 'large', placement: 'overlay', parameters: { period: 5 } },
    { id: 'legacy-rsi', type: 'rsi', enabled: false, size: 'default', placement: 'pane', parameters: { period: 11, lower: 30, upper: 70 } },
  ]);

  const second = { ...migrated[0], id: 'ema-2', placement: 'pane', parameters: { period: 50 } };
  expect(preferences(JSON.parse(JSON.stringify([...migrated, second, second])))).toEqual([...migrated, second]);
  expect(preferences([], { ema: { enabled: true } })).toEqual([]);
});

function createChartStub(withPrimitives = false) {
  const series = [];
  const timeScale = {
    getVisibleLogicalRange() { return withPrimitives ? { from: 0, to: 20 } : null; },
    logicalToCoordinate: (index) => index,
    subscribeVisibleLogicalRangeChange() {},
  };
  const chart = {
    timeScale: () => timeScale,
    addCandlestickSeries: addSeries,
    addBarSeries: addSeries,
    addAreaSeries: addSeries,
    addLineSeries: addSeries,
    removeSeries() {},
  };

  function addSeries() {
    const current = {
      data: [],
      setData(points) { this.data = [...points]; },
      update(point) {
        expect(point.time).toBeGreaterThan(this.data.at(-1)?.time ?? 0);
        this.data.push(point);
      },
    };
    if (withPrimitives) {
      current.attachPrimitive = (primitive) => { current.primitive = primitive; };
      current.priceToCoordinate = (price) => 100 - price;
    }
    series.push(current);
    return current;
  }
  return { chart, series };
}

it('keeps EMA instances separate and clips shifted Ichimoku series across step, seek and rewind', () => {
  const { chart, series } = createChartStub();
  const replay = window.SmcReplayChart.init({ container: {}, chartLib: { createChart: () => chart } });
  let lastCandleRevealed = false;
  const last = candles.at(-1);
  const guardedCandles = [...candles.slice(0, -1), {
    ...last,
    get close() {
      expect(lastCandleRevealed).toBe(true);
      return last.close;
    },
  }];
  replay.setData(guardedCandles);
  replay.configureIndicator('ema-1', { type: 'ema', parameters: { period: 1 } });
  replay.configureIndicator('ema-2', { type: 'ema', parameters: { period: 2 } });
  replay.configureIndicator('cloud', {
    type: 'ichimoku', parameters: { conversion: 1, base: 2, span: 3, displacement: 1 },
  });
  for (const id of ['ema-1', 'ema-2', 'cloud']) replay.setIndicator(id, true);
  const [, ema1, ema2, conversion, base, leadingA, leadingB, lagging] = series;

  replay.seekTo(1, { follow: false });
  expect(ema1.data[0]).toEqual({ time: 1, value: 4 });
  expect(ema2.data[0]).toEqual({ time: 1 });
  expect(lagging.data).toEqual([{ time: 1, value: 6 }]);
  expect(leadingA.data).toEqual([{ time: 1 }, { time: 2 }]);
  const indicators = [conversion, base, leadingA, leadingB, lagging];
  const atSecondCandle = indicators.map((line) => [...line.data]);

  replay.seekTo(2, { follow: false });
  expect(lagging.data.at(-1)).toEqual({ time: 2, value: 8 });
  expect(leadingA.data.at(-1)).toEqual({ time: 3, value: 4.5 });
  expect(leadingB.data.at(-1)).toEqual({ time: 3 });
  lastCandleRevealed = true;
  replay.seekTo(4, { follow: false });
  expect(leadingB.data.at(-1)).toEqual({ time: 5, value: 6 });
  expect(lagging.data.at(-1)).toEqual({ time: 4, value: 6 });

  lastCandleRevealed = false;
  replay.seekTo(1, { follow: false });
  expect(indicators.map((line) => line.data)).toEqual(atSecondCandle);
  replay.seekTo(0, { follow: false });
  expect(lagging.data).toEqual([]);
});

it('fills both cloud polarities without connecting whitespace or revealing future spans', () => {
  const { chart, series } = createChartStub(true);
  const replay = window.SmcReplayChart.init({ container: {}, chartLib: { createChart: () => chart } });
  const input = [4, 6, 8, 6, NaN, 2, 1, 3, 6, 9].map((close, index) => ({
    time: index + 1, open: close, high: close + 1, low: close - 1, close,
  }));
  replay.setData(input);
  replay.configureIndicator('cloud', {
    type: 'ichimoku', parameters: { conversion: 1, base: 2, span: 3, displacement: 1 },
  });
  replay.setIndicator('cloud', true);
  const view = series[3].primitive.paneViews()[0];
  expect(view.zOrder()).toBe('bottom');

  function filledPaths() {
    const paths = [];
    let path;
    const context = {
      beginPath() { path = []; },
      moveTo(x) { path.push(x); },
      lineTo(x) { path.push(x); },
      closePath() {},
      fill() { paths.push({ color: this.fillStyle, range: [Math.min(...path), Math.max(...path)] }); },
    };
    view.renderer().draw({ useMediaCoordinateSpace: (draw) => draw({ context }) });
    return paths;
  }

  replay.seekTo(3, { follow: false });
  expect(filledPaths()).toEqual([]);
  replay.seekTo(4, { follow: false });
  const firstCloud = [
    { color: 'rgba(69, 224, 173, .18)', range: [3, 3.75] },
    { color: 'rgba(255, 113, 128, .18)', range: [3.75, 4] },
  ];
  expect(filledPaths()).toEqual(firstCloud);
  replay.seekTo(8, { follow: false });
  expect(filledPaths()).toEqual(firstCloud);
  replay.seekTo(9, { follow: false });
  expect(filledPaths()[0].range).toEqual([3, 9]);
  replay.seekTo(4, { follow: false });
  expect(filledPaths()).toEqual(firstCloud);
  replay.setData(input);
  expect(filledPaths()).toEqual([]);
});

it('switches chart types without reading past the active candle or changing source OHLC', () => {
  const { chart } = createChartStub();
  const replay = window.SmcReplayChart.init({ container: {}, chartLib: { createChart: () => chart } });
  const input = [
    { time: 1, open: 4, high: 9, low: 3, close: 8 },
    { time: 2, open: 8, high: 11, low: 7, close: 10 },
    { time: 3, get open() { throw new Error('Future candle accessed'); } },
  ];
  replay.setData(input);
  replay.seekTo(0, { follow: false });
  replay.setChartType('heikin');
  expect(replay.getSeries().data).toEqual([{ time: 1, open: 6, high: 9, low: 3, close: 6 }]);
  replay.seekTo(1, { follow: false });
  expect(replay.getSeries().data.at(-1)).toEqual({ time: 2, open: 6, high: 11, low: 6, close: 9 });

  replay.seekTo(0, { follow: false });
  for (const type of ['line', 'area']) {
    replay.setChartType(type);
    expect(replay.getSeries().data).toEqual([{ time: 1, value: 8 }]);
  }
  for (const type of ['bars', 'candles']) {
    replay.setChartType(type);
    expect(replay.getSeries().data).toEqual([input[0]]);
  }
  expect(replay.getWatermark()).toBe(0);
});
