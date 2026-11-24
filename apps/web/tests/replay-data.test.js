import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';

const publicRoot = new URL('../public/', import.meta.url);
const window = {};
let source;

beforeAll(async () => {
  source = await readFile(new URL('../replay/data-source.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    window,
    AbortSignal,
    DecompressionStream,
    Response,
    fetch: async (url) => new Response(await readFile(new URL(url.slice(1), publicRoot))),
  });
});

it('loads candle archives when the browser has already decoded the gzip transport', async () => {
  const decodedWindow = {};
  runInNewContext(source, {
    window: decodedWindow,
    AbortSignal,
    DecompressionStream,
    Response,
    fetch: async (url) => {
      const data = await readFile(new URL(url.slice(1), publicRoot));
      return url.endsWith('.gz')
        ? new Response(gunzipSync(data), { headers: { 'Content-Encoding': 'gzip' } })
        : new Response(data);
    },
  });
  const params = new URLSearchParams({ timeframe: 'M5', period_mode: 'month', year: '2026', month: '10' });
  const raw = await window.PipstrideReplayData.getData(params);
  const decoded = await decodedWindow.PipstrideReplayData.getData(params);
  expect(decoded).toEqual(raw);
});

it('keeps unique H1 timestamps across overlapping cache months and clips dates in UTC', async () => {
  const { meta, candles } = await window.PipstrideReplayData.getData(new URLSearchParams({
    timeframe: 'H1',
    period_mode: 'custom',
    start_date: '2022-11-01',
    end_date: '2022-11-01',
  }));

  const start = Date.parse('2022-11-01T00:00:00Z') / 1000;
  const end = Date.parse('2022-11-02T00:00:00Z') / 1000;
  expect(meta.months_loaded).toBe(2);
  expect(candles[0]).toMatchObject({ time: start, open: 1632.419, volume: 2599 });
  expect(candles.at(-1).time).toBeLessThan(end);
  expect(candles.every((candle, index) => index === 0 || candle.time > candles[index - 1].time)).toBe(true);
});

it('keeps the legacy monthly session metadata and clips its H1 candles to the selected calendar month', async () => {
  const { meta, candles } = await window.PipstrideReplayData.getData(new URLSearchParams({
    timeframe: 'H1',
    period_mode: 'month',
    year: '2022',
    month: '11',
  }));

  expect(meta).toMatchObject({ period_mode: 'month', year: 2022, month: 11 });
  expect(candles[0].time).toBe(Date.parse('2022-11-01T00:00:00Z') / 1000);
  expect(candles.at(-1).time).toBeLessThan(Date.parse('2022-12-01T00:00:00Z') / 1000);
});

it('loads the complete available M1 range even when it exceeds the former candle cap', async () => {
  const timeframe = 'M1';
  const { timeframe_coverage: { M1 } } = await window.PipstrideReplayData.getCoverage();
  const { meta, candles } = await window.PipstrideReplayData.getData(new URLSearchParams({
    timeframe,
    period_mode: 'multi_month',
    start_date: '2026-01-01',
    end_date: '2026-11-30',
  }));

  expect(meta.total_bars).toBe(M1.total_bars);
  expect(candles.length).toBeGreaterThan(120_000);
});

it('includes both endpoints in the 12-calendar-month limit across years', async () => {
  const params = new URLSearchParams({
    timeframe: 'H1',
    period_mode: 'multi_month',
    start_date: '2018-07-01',
    end_date: '2019-06-30',
  });
  const { meta } = await window.PipstrideReplayData.getData(params);
  expect(meta).toMatchObject({ requested_start_date: '2018-07-01', requested_end_date: '2019-06-30' });

  params.set('end_date', '2019-07-01');
  await expect(window.PipstrideReplayData.getData(params)).rejects.toThrow('maksimal 12 bulan');
});
