import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { beforeAll, expect, it } from 'vitest';

const publicRoot = new URL('../public/', import.meta.url);
const window = {};

beforeAll(async () => {
  const source = await readFile(new URL('replay/data-source.js', publicRoot), 'utf8');
  runInNewContext(source, {
    window,
    AbortSignal,
    DecompressionStream,
    Response,
    fetch: async (url) => new Response(await readFile(new URL(url.slice(1), publicRoot))),
  });
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
