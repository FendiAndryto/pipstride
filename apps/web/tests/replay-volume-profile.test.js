import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { beforeAll, expect, it, vi } from 'vitest';

const window = {};
let profiles;

beforeAll(async () => {
  const source = await readFile(new URL('../replay/js/replay_volume_profile.js', import.meta.url), 'utf8');
  runInNewContext(source, { window });
  profiles = window.ReplayVolumeProfile;
});

it('distributes candle volume by price overlap and highlights the adjacent 70% value area', () => {
  const result = profiles.calculate({ type: 'fixed', startTime: 40, endTime: 10, bins: 4 }, [
    { time: 10, low: 0, high: 4, volume: 40 },
    { time: 20, low: 1.5, high: 2.5, volume: 12 },
    { time: 40, low: 2, high: 2, volume: 10 },
    { time: 50, low: 0, high: 4, volume: 1000 },
  ], 3);

  expect(result).toMatchObject({
    startTime: 10, endTime: 40, totalVolume: 62, peakVolume: 26,
    pointOfControl: 2, valueAreaLow: 0, valueAreaHigh: 2,
  });
  expect(result.rows.map((row) => row.volume)).toEqual([10, 16, 26, 10]);
});

it('uses only revealed candles in the target UTC day, including across a data gap', () => {
  const candles = [
    { time: 86399, low: 9, high: 10, volume: 40 },
    { time: 86400, low: 3, high: 4, volume: 15 },
    { time: 86520, low: 4, high: 5, volume: 25 },
    { time: 172800, low: 9, high: 10, volume: 0 },
  ];
  const config = { type: 'session' };

  expect(profiles.calculate(config, candles, 1)).toMatchObject({ startTime: 86400, endTime: 86400, totalVolume: 15 });
  const profile = profiles.calculate(config, candles, 2);
  expect(profile).toMatchObject({ startTime: 86400, endTime: 86520 });
  expect(profile.totalVolume).toBeCloseTo(40);
  expect(profiles.calculate(config, candles, 3)).toBeNull();
  expect(profiles.calculate(config, candles, -1)).toBeNull();
  expect(profiles.calculate({ type: 'fixed', startTime: 86400, endTime: 86520 }, candles, 0)).toBeNull();
});

it('merges buckets as price expands without rereading revealed volume and conserves it', () => {
  const readVolume = vi.fn(() => 12);
  const candles = [
    { time: 1, low: 10, high: 11, get volume() { return readVolume(); } },
    { time: 2, low: -10, high: 110, volume: 30 },
    { time: 5, low: 700, high: 1000, get volume() { throw new Error('Future candle'); } },
  ];
  const options = { type: 'fixed', startTime: 1, endTime: 5, bins: 8 };
  const profile = profiles.create(options);
  profile.setData(candles, 0);
  profile.setData(candles, 1);
  expect(readVolume).toHaveBeenCalledTimes(1);

  const result = profiles.calculate(options, candles, 1);
  expect(result.rows.length).toBeLessThanOrEqual(8);
  expect(result.totalVolume).toBeCloseTo(42);
  expect(result.rows[0].low).toBeLessThanOrEqual(-10);
  expect(result.rows.at(-1).high).toBeGreaterThanOrEqual(110);
});

function mockSeries() {
  const requestUpdate = vi.fn();
  const fillRect = vi.fn();
  const chart = { timeScale: () => ({ timeToCoordinate: (time) => 20 * time, options: () => ({ barSpacing: 20 }) }) };
  let primitive;
  const series = {
    attachPrimitive: vi.fn((value) => {
      primitive = value;
      value.attached({ chart, series, requestUpdate });
    }),
    detachPrimitive: vi.fn((value) => {
      primitive = null;
      value.detached();
    }),
    priceToCoordinate: (price) => 100 - price * 10,
  };
  return {
    series, requestUpdate,
    draw() {
      fillRect.mockClear();
      primitive.paneViews()[0].renderer().draw({
        useMediaCoordinateSpace: (draw) => draw({ mediaSize: { width: 200 }, context: { fillRect } }),
      });
      return fillRect.mock.calls.slice();
    },
  };
}

it('updates the primitive through rewind, data replacement, series swap and reset', () => {
  const candles = [
    { time: 1, low: 0, high: 4, volume: 12 },
    { time: 2, low: 0, high: 0, volume: 12 },
  ];
  const profile = profiles.create({ type: 'session', bins: 4 });
  const first = mockSeries();
  const second = mockSeries();
  profile.attach(first.series);
  profile.setData(candles, 0);
  const before = first.draw();
  expect(before).toHaveLength(4);
  profile.setData(candles, 1);
  expect(first.draw()).not.toEqual(before);
  profile.setData(candles, 0);
  expect(first.draw()).toEqual(before);

  profile.attach(second.series);
  expect(first.series.detachPrimitive).toHaveBeenCalledOnce();
  expect(second.draw()).toEqual(before);
  profile.setData([{ time: 1, low: 5, high: 5, volume: 10 }], 0);
  expect(second.draw()).toHaveLength(1);
  profile.setData(candles, -1);
  expect(second.draw()).toEqual([]);
  profile.detach();
  expect(second.series.detachPrimitive).toHaveBeenCalledOnce();
});
