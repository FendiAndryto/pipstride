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

function initSimulator(tool, times = [100, 160, 220, 1000], watermark = 2) {
  const candles = times.map((time, index) => ({
    index, time, low: 99, high: 103, close: 100,
  }));
  const revealed = candles.slice(0, watermark + 1);
  const currentBar = revealed.at(-1);
  const priceAt = (y) => 145 - y / 2;
  const logicalToCoordinate = vi.fn((index) => index * 10);
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
      coordinateToTime: (x) => revealed[Math.round(x / 10)]?.time ?? null,
      getWatermark: () => watermark,
      priceToCoordinate: (price) => (145 - price) * 2,
      timeToCoordinate: (time) => {
        const index = revealed.findIndex((bar) => bar.time === time);
        return index < 0 ? null : index * 10;
      },
      timeScale: () => ({ logicalToCoordinate, options: () => ({ barSpacing: 10 }) }),
    },
    getCandles: () => candles,
    getCurrentBar: () => currentBar,
    barEnd: (bar) => bar.time + 60,
    onChange,
    onCommit: () => { activeTool = 'cursor'; },
  });
  const pointer = (type, x, y) => handlePointer({ type, x, y, price: priceAt(y), originalEvent: { pointerType: 'touch' } });
  return { simulator, pointer, currentBar, onChange, logicalToCoordinate };
}

it.each([
  ['long_pos', 87, 98, 104],
  ['short_pos', 93, 102, 96],
])('moves the %s body in time and price using revealed bars', (tool, bodyY, sl, tp) => {
  const { simulator, pointer, currentBar, onChange, logicalToCoordinate } = initSimulator(tool);

  pointer('pointerdown', 10, 90);
  const position = simulator.getActivePosition();
  const duration = position.targetTime - position.entryTime;
  pointer('pointerdown', 25, bodyY);
  pointer('pointermove', 45, bodyY);
  pointer('pointerup', 45, bodyY);
  expect(position).toMatchObject({ entryTime: 280, targetTime: 280 + duration, entryPrice: 100, sl, tp, filled: false });

  simulator.evaluateCandle({ time: 280, index: 3, open: 100, high: 101, low: 99, close: 100 }, 3);
  expect(position.fillTime).toBe(280);

  pointer('pointerdown', 45, bodyY);
  pointer('pointermove', 25, bodyY - 2);
  pointer('pointerup', 25, bodyY - 2);
  expect(position).toMatchObject({ entryTime: 160, targetTime: 160 + duration, entryPrice: 101, sl: sl + 1, tp: tp + 1, filled: true });
  expect(position.fillTime).toBeUndefined();
  expect(position.placedTime).toBe(220);
  expect(simulator.evaluateCandle(currentBar, currentBar.index)).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(logicalToCoordinate).not.toHaveBeenCalledWith(3);
});

it('projects and moves a position with just one revealed candle', () => {
  const { simulator, pointer, logicalToCoordinate } = initSimulator('long_pos', [100, 1000], 0);
  pointer('pointerdown', 0, 90);
  const position = simulator.getActivePosition();
  expect(position).toMatchObject({ entryTime: 100, targetTime: 1300 });

  pointer('pointerdown', 15, 90);
  pointer('pointermove', 25, 92);
  pointer('pointerup', 25, 92);
  expect(position).toMatchObject({ entryTime: 160, targetTime: 1360, entryPrice: 99, filled: false });
  expect(logicalToCoordinate).not.toHaveBeenCalledWith(1);

  pointer('pointerdown', 10, 92);
  pointer('pointermove', 20, 90);
  pointer('pointerup', 20, 90);
  expect(position).toMatchObject({ entryTime: 160, entryPrice: 100, tp: 104, sl: 98 });
});

it('moves a completed position beyond its exit without editing its trade', () => {
  const { simulator, pointer } = initSimulator('long_pos');
  pointer('pointerdown', 30, 90);
  const position = simulator.getActivePosition();
  const candle = { time: 280, index: 3, open: 100, high: 101, low: 99, close: 100 };
  simulator.evaluateCandle(candle, candle.index);
  simulator.closePosition(candle);
  const trade = { ...simulator.getLedger().getTrades()[0] };
  const originalPosition = { ...position };

  pointer('pointerdown', 45, 90);
  pointer('pointermove', 65, 88);
  pointer('pointerup', 65, 88);

  expect(position).toMatchObject(originalPosition);
  expect(position.display).toMatchObject({ entryTime: 400, targetTime: 1600, entryPrice: 101, tp: 105, sl: 99 });
  expect(trade).toMatchObject({ entryTime: 280, exitTime: 280, entryPrice: 100 });
  expect(simulator.getLedger().getTrades()).toEqual([trade]);
});
