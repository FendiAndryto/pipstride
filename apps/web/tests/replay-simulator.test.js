import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { beforeAll, expect, it, vi } from 'vitest';

const window = {};

beforeAll(async () => {
  for (const script of ['replay_ledger.js', 'replay_simulator.js']) {
    const source = await readFile(new URL(`../public/replay/js/${script}`, import.meta.url), 'utf8');
    runInNewContext(source, { window });
  }
});

it.each([
  ['long_pos', 80, 98, 104],
  ['short_pos', 120, 102, 96],
])('moves the %s body in time and price using revealed bars', (tool, bodyY, sl, tp) => {
  const candles = [100, 160, 220, 1000].map((time, index) => ({
    index, time, low: 99, high: 103,
  }));
  const currentBar = candles[2];
  const priceAt = (y) => 110 - y / 10;
  const logicalToCoordinate = vi.fn((index) => index * 100);
  const onChange = vi.fn();
  let activeTool = tool;
  let handlePointer;
  const simulator = window.SmcReplaySimulator.init({
    canvasApi: {
      getActiveTool: () => activeTool,
      onPointer: (fn) => { handlePointer = fn; },
      registerRenderer() {},
      requestRedraw() {},
      setCursor() {},
      setSelectionActive() {},
    },
    chartApi: {
      coordinateToPrice: priceAt,
      coordinateToTime: (x) => candles.slice(0, 3)[Math.round(x / 100)]?.time ?? null,
      getWatermark: () => 2,
      priceToCoordinate: (price) => (110 - price) * 10,
      timeToCoordinate: (time) => {
        const index = candles.slice(0, 3).findIndex((bar) => bar.time === time);
        return index < 0 ? null : index * 100;
      },
      timeScale: () => ({ logicalToCoordinate }),
    },
    getCandles: () => candles,
    getCurrentBar: () => currentBar,
    barEnd: (bar) => bar.time + 60,
    onChange,
    onCommit: () => { activeTool = 'cursor'; },
  });
  const pointer = (type, x, y) => handlePointer({ type, x, y, price: priceAt(y) });

  pointer('pointerdown', 100, 100);
  const position = simulator.getActivePosition();
  const duration = position.targetTime - position.entryTime;
  pointer('pointerdown', 140, bodyY);
  pointer('pointermove', 340, bodyY);
  pointer('pointerup', 340, bodyY);
  expect(position).toMatchObject({ entryTime: 280, targetTime: 280 + duration, entryPrice: 100, sl, tp, filled: false });

  simulator.evaluateCandle({ time: 280, index: 3, open: 100, high: 101, low: 99, close: 100 }, 3);
  expect(position.fillTime).toBe(280);

  pointer('pointerdown', 340, bodyY);
  pointer('pointermove', 140, bodyY - 10);
  pointer('pointerup', 140, bodyY - 10);
  expect(position).toMatchObject({ entryTime: 160, targetTime: 160 + duration, entryPrice: 101, sl: sl + 1, tp: tp + 1, filled: true });
  expect(position.fillTime).toBeUndefined();
  expect(position.placedTime).toBe(220);
  expect(simulator.evaluateCandle(currentBar, currentBar.index)).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(logicalToCoordinate).not.toHaveBeenCalledWith(3);
});
