import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { beforeAll, expect, it, vi } from 'vitest';

const window = {};

beforeAll(async () => {
  const source = await readFile(new URL('../replay/js/replay_drawings.js', import.meta.url), 'utf8');
  runInNewContext(source, { window });
});

function initDrawings(tool) {
  const candles = [
    { time: 100, open: 100, high: 110, low: 90, close: 101 },
    { time: 160, open: 110, high: 125, low: 105, close: 115 },
    { time: 220, open: 140, high: 160, low: 135, close: 145 },
  ];
  const priceAt = (y) => 200 - y;
  let watermark = candles.length - 1;
  let activeTool = tool;
  let onToolChange;
  const onChange = vi.fn();
  const drawings = window.SmcReplayDrawings.init({
    canvasApi: {
      getActiveTool: () => activeTool,
      onToolChange: (fn) => { onToolChange = fn; },
      getCanvas: () => ({ clientWidth: 300, clientHeight: 200 }),
      onPointer() {},
      registerRenderer() {},
      requestRedraw() {},
      setCursor() {},
      setSelectionActive() {},
    },
    chartApi: {
      coordinateToPrice: priceAt,
      getWatermark: () => watermark,
      priceToCoordinate: (price) => (price == null ? null : priceAt(price)),
      timeToCoordinate: (time) => {
        const index = candles.findIndex((bar) => bar.time === time);
        return index < 0 || index > watermark ? null : index * 40;
      },
      timeScale: () => ({ logicalToCoordinate: (index) => index * 40 }),
    },
    getCandles: () => candles,
    onCommit: () => selectTool('cursor'),
    onChange,
  });
  function selectTool(next) {
    activeTool = next;
    onToolChange(next);
  }
  function pointer(type, x, y) {
    const index = Math.round(x / 40);
    const time = index <= watermark ? candles[index]?.time : null;
    drawings.handlePointer({ type, x, y, time, price: priceAt(y) });
  }
  function click(x, y) {
    pointer('pointerdown', x, y);
    pointer('pointerup', x, y);
  }
  return { drawings, click, pointer, onChange, selectTool, rewind: () => { watermark = 1; } };
}

it.each([
  ['ray', [[0, 120], [40, 110]], [120, 90]],
  ['vline', [[40, 120]], [40, 20]],
  ['channel', [[0, 140], [40, 120], [80, 70]], [20, 115]],
  ['fib-extension', [[0, 150], [40, 110], [80, 120]], [175, 80]],
  ['text', [[40, 100]], [54, 100]],
  ['arrow', [[0, 140], [40, 100]], [20, 120]],
  ['horizontal_ray', [[40, 120]], [200, 120]],
  ['price_label', [[40, 100]], [60, 100]],
  ['price_range', [[0, 140], [40, 100]], [20, 120]],
  ['date_range', [[0, 120], [80, 120]], [40, 120]],
  ['date_price_range', [[0, 140], [80, 100]], [40, 120]],
  ['pitchfork', [[0, 140], [40, 100], [80, 120]], [120, 80]],
  ['regression_channel', [[0, 140], [80, 120]], [75, 62]],
  ['fib_fan', [[0, 120], [40, 80]], [120, 60]],
  ['fib_time_zones', [[0, 120], [40, 100]], [120, 40]],
  ['elliott_wave', [[0, 140], [40, 100], [80, 130], [120, 80], [160, 100], [200, 60]], [180, 80]],
  ['risk_reward', [[0, 100], [80, 125], [80, 50]], [40, 75]],
])('places and hit-tests %s using its anchors', (tool, anchors, hit) => {
  const { drawings, click } = initDrawings(tool);
  for (const [x, y] of anchors) click(x, y);
  const [item] = drawings.getDrawings();
  expect(item).toMatchObject({ type: tool, version: 2 });
  expect(drawings.getAnchorHandles(item, 300, 200)).toHaveLength(anchors.length);
  expect(drawings.findDrawingAt(...hit)).toBe(item);
});

it('keeps locked drawing anchors fixed and restores styles and visibility from saved data', () => {
  const { drawings, click, pointer, onChange } = initDrawings('channel');
  drawings.setDrawings([{ id: 'old', type: 'hline', price: 115 }]);
  expect(drawings.getDrawingById('old')).toMatchObject({ version: 2, lineStyle: 'dashed', hidden: false, locked: false });

  click(0, 140);
  click(40, 120);
  click(80, 70);
  const channel = drawings.findDrawingAt(20, 115);
  drawings.selectDrawing(channel.id);
  pointer('pointerdown', 80, 70);
  pointer('pointermove', 80, 79);
  pointer('pointerup', 80, 79);
  expect(channel.p3).toBe(121);
  expect(onChange).toHaveBeenCalledTimes(1);

  drawings.updateDrawing(channel.id, { color: '#123456', lineStyle: 'dotted', lineWidth: 3, locked: true });
  pointer('pointerdown', 80, 79);
  pointer('pointermove', 80, 50);
  pointer('pointerup', 80, 50);
  expect(channel.p3).toBe(121);
  expect(drawings.getAnchorHandles(channel, 300, 200)).toHaveLength(0);

  const duplicate = drawings.duplicateDrawing(channel.id);
  expect(duplicate.id).not.toBe(channel.id);
  expect(duplicate).toMatchObject({ color: '#123456', lineWidth: 3, lineStyle: 'dotted', locked: true });
  drawings.updateDrawing(duplicate.id, { hidden: true });
  drawings.setDrawings(JSON.parse(JSON.stringify(drawings.getDrawings())));
  expect(drawings.getDrawingById(duplicate.id)).toMatchObject({ hidden: true, locked: true });
  expect(drawings.findDrawingAt(20, 115)?.id).toBe(channel.id);
});

it('snaps to the nearest OHLC and ignores unrevealed candle prices after rewind', () => {
  const { drawings, click, selectTool, rewind } = initDrawings('hline');
  drawings.setSnapEnabled(true);
  click(80, 54);
  expect(drawings.getDrawings()[0].price).toBe(145);

  rewind();
  selectTool('hline');
  click(80, 54);
  expect(drawings.getDrawings()[1].price).toBe(146);

  selectTool('hline');
  click(40, 78);
  expect(drawings.getDrawings()[2].price).toBe(125);
});

it('keeps freehand points between bars and moves a persisted brush stroke', () => {
  const { drawings, pointer, onChange, selectTool } = initDrawings('brush');
  pointer('pointerdown', 40, 110);
  pointer('pointermove', 50, 95);
  pointer('pointerup', 60, 90);
  const [brush] = drawings.getDrawings();
  expect(brush.points).toEqual([[160, 90], [175, 105], [190, 110]]);

  drawings.setDrawings(JSON.parse(JSON.stringify(drawings.getDrawings())));
  const persisted = drawings.findDrawingAt(50, 95);
  drawings.selectDrawing(persisted.id);
  pointer('pointerdown', 50, 95);
  pointer('pointermove', 60, 85);
  pointer('pointerup', 60, 85);
  expect(persisted.points).toEqual([[175, 100], [190, 115], [205, 120]]);
  expect(onChange).toHaveBeenCalledTimes(1);

  selectTool('brush');
  pointer('pointerdown', 0, 100);
  pointer('pointermove', 40, 130);
  pointer('pointercancel', 40, 130);
  expect(drawings.getDrawings()).toHaveLength(1);
});

it('recomputes regression using the revealed portion after rewind', () => {
  const { drawings, click, rewind } = initDrawings('regression_channel');
  click(0, 140);
  click(80, 120);
  expect(drawings.findDrawingAt(75, 62)?.type).toBe('regression_channel');
  rewind();
  expect(drawings.findDrawingAt(75, 62)).toBeNull();
  expect(drawings.findDrawingAt(20, 92)?.type).toBe('regression_channel');
});

it('keeps risk and reward on opposing sides during placement and dragging', () => {
  const { drawings, click, pointer, onChange } = initDrawings('risk_reward');
  click(0, 100);
  click(80, 125);
  click(80, 120);
  expect(drawings.getDrawings()).toHaveLength(0);
  click(80, 50);
  const [plan] = drawings.getDrawings();
  drawings.selectDrawing(plan.id);

  pointer('pointerdown', 80, 125);
  pointer('pointermove', 80, 90);
  pointer('pointerup', 80, 90);
  expect(plan.p2).toBe(75);
  expect(onChange).not.toHaveBeenCalled();

  pointer('pointerdown', 40, 75);
  pointer('pointermove', 80, 70);
  pointer('pointerup', 80, 70);
  expect(plan).toMatchObject({ t1: 160, t2: 280, t3: 280, p1: 105, p2: 80, p3: 155 });
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('renders the measured price and duration, numbered waves, and risk ratio', () => {
  const { drawings, click, selectTool } = initDrawings('date_price_range');
  click(0, 140);
  click(80, 110);
  selectTool('elliott_wave');
  [[0, 140], [40, 100], [80, 130], [120, 80], [160, 100], [200, 60]].forEach(([x, y]) => click(x, y));
  selectTool('risk_reward');
  click(0, 100);
  click(80, 125);
  click(80, 50);

  const ctx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {},
    moveTo() {}, lineTo() {}, fillRect() {}, strokeRect() {}, fillText: vi.fn(),
  };
  drawings.render(ctx, { width: 300, height: 200, tool: 'cursor' });
  expect(ctx.fillText.mock.calls.map(([label]) => label)).toEqual([
    '+30.000 (50.00%)', '2m · 3 bars', '(1)', '(2)', '(3)', '(4)', '(5)', '2.00 R',
  ]);
});
