/**
 * Interactive Strategy & Position Simulator Engine (Fase 4: T-SIM-06 & T-SIM-07).
 *
 * Implements Long & Short position boxes, interactive risk-reward calculator,
 * draggable TP/SL/Entry anchor handles, bar-by-bar TP/SL hit evaluation with
 * pessimistic tie-break resolution, anti look-ahead prevention, and manual close.
 *
 * Works in both Browser and Node.js environments.
 */
(function (global) {
  'use strict';

  var Ledger = global.SmcReplayLedger || (typeof require !== 'undefined' ? require('./replay_ledger.js') : null);

  var posIdCounter = 0;
  function nextPosId(prefix) {
    posIdCounter += 1;
    return (prefix || 'pos') + '_' + Date.now() + '_' + posIdCounter;
  }

  function init(options) {
    options = options || {};
    var canvasApi = options.canvasApi;
    var chartApi = options.chartApi;
    var getCandles = options.getCandles || function () { return []; };
    var getCurrentBar = options.getCurrentBar || function () { return null; };
    var onCommit = options.onCommit || function () {};
    var onChange = options.onChange || function () {};
    var onEditStart = options.onEditStart || function () {};
    var barEnd = options.barEnd;

    var ledger = (options.ledger) || (Ledger ? Ledger.create(options.ledgerOptions) : null);
    var defaultLot = 0.10;
    var spreadPerOz = (options.spreadPerOz != null) ? Number(options.spreadPerOz) : 0.20;

    var positions = [];
    var activePosition = null;
    var history = [];
    var selectedId = null;
    var draft = null;
    var hoverPos = null;
    var dragState = null;
    var isDestroyed = false;

    function setLot(lot) {
      if (Ledger && Ledger.validateLot) {
        var valid = Ledger.validateLot(lot);
        if (valid != null) {
          defaultLot = valid;
          return true;
        }
        return false;
      }
      if (typeof lot === 'number' && lot >= 0.01 && lot <= 5.0) {
        defaultLot = Number(lot.toFixed(2));
        return true;
      }
      return false;
    }

    function getLot() {
      return defaultLot;
    }

    function resolveTime(time, x) {
      if (time != null && !isNaN(time) && time > 0) return time;
      if (chartApi && chartApi.coordinateToTime && x != null) {
        try {
          var ct = chartApi.coordinateToTime(x);
          if (ct != null && !isNaN(ct) && ct > 0) return ct;
        } catch {}
      }
      var ahead = extrapolateTime(x);
      if (ahead != null) return ahead;
      return snapToRevealedBar(x);
    }

    // coordinateToTime() returns null to the right of the newest revealed bar.
    // A position's targetTime is entry + 20 bars (already in that whitespace),
    // so dragging the right handle needed a forward projection rather than a
    // snap back onto the last candle.
    function extrapolateTime(x) {
      var candles = getCandles();
      if (!Array.isArray(candles) || candles.length < 2 || x == null || isNaN(x)) return null;

      var lastIdx = candles.length - 1;
      if (chartApi && chartApi.getWatermark) {
        var wm = chartApi.getWatermark();
        if (wm != null && wm >= 0) lastIdx = Math.min(wm, lastIdx);
      }
      if (lastIdx < 1) return null;

      var lastX = logicalCoord(lastIdx);
      var prevX = logicalCoord(lastIdx - 1);
      if (lastX == null || prevX == null) return null;

      var stepPx = lastX - prevX;
      if (!(stepPx > 0)) return null;

      var barsAhead = (x - lastX) / stepPx;
      if (!(barsAhead > 0)) return null;

      var span = candles[lastIdx].time - candles[lastIdx - 1].time;
      if (!(span > 0)) return null;

      return candles[lastIdx].time + Math.round(barsAhead) * span;
    }

    // coordinateToTime() returns null for whitespace and data gaps. Falling back
    // to the month's last bar anchored the box off-screen during replay, so
    // timeToCoordinate() returned null and the position was never painted. Snap
    // to the nearest revealed bar instead (same rule as the drawing module).
    function snapToRevealedBar(x) {
      var candles = getCandles();
      if (!Array.isArray(candles) || candles.length === 0) {
        return Math.floor(Date.now() / 1000);
      }

      var lastIdx = candles.length - 1;
      if (chartApi && chartApi.getWatermark) {
        var wm = chartApi.getWatermark();
        if (wm != null && wm >= 0) lastIdx = Math.min(wm, lastIdx);
      }

      var idx = lastIdx;
      var ts = (chartApi && chartApi.timeScale) ? chartApi.timeScale() : null;
      var range = (ts && ts.getVisibleLogicalRange) ? ts.getVisibleLogicalRange() : null;
      var opts = (ts && ts.options) ? ts.options() : null;
      var spacing = (opts && opts.barSpacing > 0) ? opts.barSpacing : null;

      if (range && spacing && x != null && !isNaN(x)) {
        var lo = Math.max(0, Math.ceil(range.from));
        var hi = Math.min(lastIdx, Math.floor(range.to));
        if (hi >= lo) {
          var approx = range.from + (x / spacing);
          idx = Math.max(lo, Math.min(hi, Math.round(approx)));
        } else {
          idx = range.to < 0 ? 0 : lastIdx;
        }
      }

      idx = Math.max(0, Math.min(lastIdx, idx));
      return candles[idx].time;
    }

    function timeToCoord(t) {
      if (!chartApi || !chartApi.timeToCoordinate || t == null || isNaN(t) || t <= 0) return null;
      try {
        var exact = chartApi.timeToCoordinate(t);
        if (exact != null) return exact;
      } catch {}
      var interp = interpolateCoord(t);
      if (interp != null) return interp;
      return extrapolateCoord(t);
    }

    // A freshly placed position gets targetTime = entry + 20 bars, which is
    // past the newest revealed bar. timeToCoordinate() returns null there, so
    // the box was drawn with the +180px fallback but findPositionAt() skipped
    // it (x2 == null) — the R:R handles could not be grabbed at all right after
    // placing. Project forward from the last bar instead.
    function extrapolateCoord(t) {
      var candles = getCandles();
      if (!Array.isArray(candles) || candles.length < 2) return null;

      var lastIdx = candles.length - 1;
      if (chartApi && chartApi.getWatermark) {
        var wm = chartApi.getWatermark();
        if (wm != null && wm >= 0) lastIdx = Math.min(wm, lastIdx);
      }
      if (lastIdx < 1) return null;

      var lastBar = candles[lastIdx];
      if (!(t > lastBar.time)) return null;

      var span = lastBar.time - candles[lastIdx - 1].time;
      if (!(span > 0)) return null;

      var lastX = logicalCoord(lastIdx);
      var prevX = logicalCoord(lastIdx - 1);
      if (lastX == null || prevX == null) return null;

      var stepPx = lastX - prevX;
      if (!(stepPx > 0)) return null;

      return lastX + ((t - lastBar.time) / span) * stepPx;
    }

    // timeToCoordinate() only accepts exact bar times of the active series. A
    // position opened on M5 keeps its M5 entryTime after switching to M15, so
    // the projection returned null and the box disappeared. Interpolate between
    // the two surrounding bars of the active series.
    function interpolateCoord(t) {
      var candles = getCandles();
      if (!Array.isArray(candles) || candles.length < 2) return null;

      var lo = 0;
      var hi = candles.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (candles[mid].time < t) lo = mid + 1;
        else hi = mid;
      }
      if (candles[lo] && candles[lo].time === t) {
        return logicalCoord(lo);
      }
      if (lo <= 0 || lo >= candles.length) return null;

      var a = candles[lo - 1];
      var b = candles[lo];
      var span = b.time - a.time;
      if (!(span > 0) || t <= a.time || t >= b.time) return null;

      var xa = logicalCoord(lo - 1);
      var xb = logicalCoord(lo);
      if (xa == null || xb == null) return null;
      return xa + ((t - a.time) / span) * (xb - xa);
    }

    function logicalCoord(index) {
      if (!chartApi || !chartApi.timeScale) return null;
      try {
        var ts = chartApi.timeScale();
        if (!ts || typeof ts.logicalToCoordinate !== 'function') return null;
        var x = ts.logicalToCoordinate(index);
        return (x == null || isNaN(x)) ? null : x;
      } catch {
        return null;
      }
    }

    function priceToCoord(p) {
      if (!chartApi || !chartApi.priceToCoordinate || p == null || isNaN(p)) return null;
      try {
        return chartApi.priceToCoordinate(p);
      } catch {
        return null;
      }
    }

    // ------------------------------------------------------------- Position CRUD

    function getPositions() {
      return positions.slice();
    }

    function getActivePosition() {
      return activePosition;
    }

    function getPositionById(id) {
      for (var i = 0; i < positions.length; i += 1) {
        if (positions[i].id === id) return positions[i];
      }
      return null;
    }

    // Record the inverse splice and ledger totals for each simulated change.
    function rememberAction(candle, index, removeCount, previous) {
      if (!barEnd || !candle) return;
      history.push([barEnd(candle), ledger.checkpoint(), index, removeCount,
        previous.map(function (pos) { return Object.assign({}, pos); })]);
    }

    function rewindTo(time) {
      var point = null;
      while (history.length && history[history.length - 1][0] > time) {
        point = history.pop();
        var previous = point[4];
        if (Array.isArray(previous)) {
          positions.splice.apply(positions, [point[2], point[3]].concat(previous));
        } else if (typeof previous === 'number') {
          positions[point[2]].targetTime = previous;
        }
      }
      if (!point) return false;
      ledger.rewind(point[1]);
      dragState = null;
      setPositions(positions);
      return true;
    }

    function loadHistory(saved) {
      history = Array.isArray(saved) ? saved : [];
      dragState = null;
    }

    function trimLegacyState(time) {
      setPositions(positions.filter(function (pos) {
        if (pos.status === 'ACTIVE') return pos.placedTime <= time;
        return pos.exitTime != null && pos.exitTime <= time;
      }));
      ledger.trimLegacyTrades(time);
    }

    function addPosition(pos) {
      if (!pos || !pos.side) return null;
      var current = getCurrentBar();
      if (pos.placedTime == null && current) pos.placedTime = current.time;
      if (!pos.id) pos.id = nextPosId(pos.side.toLowerCase());
      if (pos.lot == null) pos.lot = defaultLot;
      if (pos.filled == null) {
        var currBar = getCurrentBar();
        if (currBar && currBar.low != null && currBar.high != null && pos.entryPrice != null) {
          var isFuture = (currBar.time != null && pos.entryTime != null && pos.entryTime > currBar.time);
          pos.filled = !isFuture && (pos.entryPrice >= currBar.low - 1e-4 && pos.entryPrice <= currBar.high + 1e-4);
        } else {
          pos.filled = true;
        }
      }

      // Single Position Rule: if an active position exists, close it first at entry price or current candle close
      if (activePosition && activePosition.status === 'ACTIVE' && pos.status === 'ACTIVE') {
        var currBar = getCurrentBar();
        closePosition(currBar);
      }

      rememberAction(current, positions.length, 1, []);
      positions.push(pos);
      if (pos.status === 'ACTIVE') {
        activePosition = pos;
      }
      selectedId = pos.id;
      if (canvasApi) {
        canvasApi.setSelectionActive(true);
        canvasApi.requestRedraw();
      }
      return pos;
    }

    function removePosition(id) {
      var idx = -1;
      for (var i = 0; i < positions.length; i += 1) {
        if (positions[i].id === id) {
          idx = i;
          break;
        }
      }
      if (idx !== -1) {
        rememberAction(getCurrentBar(), idx, 0, [positions[idx]]);
        var removed = positions.splice(idx, 1)[0];
        if (activePosition && activePosition.id === id) {
          activePosition = null;
          if (ledger) ledger.updateFloating(null);
        }
        if (selectedId === id) {
          selectedId = null;
          if (canvasApi) {
            canvasApi.setSelectionActive(false);
            canvasApi.setCursor('default');
          }
        }
        if (canvasApi) canvasApi.requestRedraw();
        return removed;
      }
      return null;
    }

    function clearPositions() {
      var count = positions.length;
      if (count) rememberAction(getCurrentBar(), 0, 0, positions);
      positions = [];
      if (ledger) ledger.updateFloating(null);
      activePosition = null;
      selectedId = null;
      draft = null;
      dragState = null;
      if (canvasApi) {
        canvasApi.setSelectionActive(false);
        canvasApi.setCursor('default');
        canvasApi.requestRedraw();
      }
      return count;
    }

    function setPositions(list) {
      positions = Array.isArray(list) ? list.slice() : [];
      activePosition = null;
      for (var i = 0; i < positions.length; i += 1) {
        if (positions[i].status === 'ACTIVE') {
          activePosition = positions[i];
          break;
        }
      }
      selectedId = null;
      if (canvasApi) {
        canvasApi.setSelectionActive(false);
        canvasApi.setCursor('default');
        canvasApi.requestRedraw();
      }
    }

    function restoreLedger(summary) {
      if (!ledger || !ledger.restore) return null;
      var restored = ledger.restore(summary);
      if (canvasApi) canvasApi.requestRedraw();
      return restored;
    }

    function selectPosition(id) {
      selectedId = id;
      if (canvasApi) {
        canvasApi.setSelectionActive(Boolean(id));
        canvasApi.requestRedraw();
      }
    }

    function deselect() {
      if (selectedId != null) {
        selectedId = null;
        if (canvasApi) {
          canvasApi.setSelectionActive(false);
          canvasApi.setCursor('default');
          canvasApi.requestRedraw();
        }
      }
    }

    function deleteSelected() {
      if (selectedId != null) {
        var id = selectedId;
        removePosition(id);
        return id;
      }
      return null;
    }

    // ------------------------------------------------------------- Bar-by-Bar TP/SL Engine

    function closePositionWithOutcome(pos, outcome, exitPrice, exitTime, reason) {
      pos.status = outcome;
      pos.exitPrice = Number(exitPrice.toFixed(3));
      pos.exitTime = exitTime;
      pos.exitReason = reason;

      if (ledger) {
        var record = ledger.recordTrade({
          id: pos.id,
          side: pos.side,
          entryPrice: pos.entryPrice,
          exitPrice: pos.exitPrice,
          sl: pos.sl,
          tp: pos.tp,
          lot: pos.lot,
          entryTime: pos.fillTime == null ? pos.entryTime : pos.fillTime,
          exitTime: pos.exitTime,
          outcome: outcome,
          reason: reason
        });
        pos.netPnl = record ? record.netPnl : 0;
      }

      if (activePosition && activePosition.id === pos.id) {
        activePosition = null;
      }
      if (canvasApi) canvasApi.requestRedraw();
      return pos;
    }

    function closePosition(currentCandle) {
      if (!activePosition || activePosition.status !== 'ACTIVE') return null;
      var candle = currentCandle || getCurrentBar();
      rememberAction(candle, positions.indexOf(activePosition), 1, [activePosition]);
      if (activePosition.filled === false) {
        var pending = activePosition;
        pending.status = 'CANCELLED';
        pending.exitTime = candle ? candle.time : null;
        pending.exitReason = 'PENDING_CANCELLED';
        activePosition = null;
        if (ledger) ledger.updateFloating(null);
        if (canvasApi) canvasApi.requestRedraw();
        return pending;
      }
      var exitPrice = candle ? candle.close : activePosition.entryPrice;
      var exitTime = candle ? candle.time : Math.floor(Date.now() / 1000);

      var pnl = Ledger ? Ledger.calculatePnl({
        side: activePosition.side,
        entryPrice: activePosition.entryPrice,
        exitPrice: exitPrice,
        lot: activePosition.lot,
        spreadPerOz: spreadPerOz
      }) : { netPnl: 0 };

      var outcome = (pnl.netPnl >= 0) ? 'WIN_MANUAL' : 'LOSS_MANUAL';
      return closePositionWithOutcome(activePosition, outcome, exitPrice, exitTime, 'MANUAL_CLOSE (KEY_C)');
    }

    function evaluateCandle(candle, barIndex) {
      if (!candle || !activePosition || activePosition.status !== 'ACTIVE') return null;

      // Anti Look-Ahead Prevention (§5.1):
      // If position was created at barIndex N while paused, bar N is excluded.
      if (activePosition.placedTime != null
        ? candle.time <= activePosition.placedTime
        : barIndex != null && activePosition.entryBarIndex != null && barIndex <= activePosition.entryBarIndex) {
        return null;
      }

      // Future time guard: candle must be at or after position entry time
      if (candle.time != null && activePosition.entryTime != null && candle.time < activePosition.entryTime) {
        return null;
      }

      var high = Number(candle.high);
      var low = Number(candle.low);
      var pos = activePosition;

      var canTakeProfit = true;
      if (pos.filled === false) {
        var touchesEntry = low - 1e-4 <= pos.entryPrice && high + 1e-4 >= pos.entryPrice;
        if (!touchesEntry) return null;
        pos.filled = true;
        pos.fillTime = candle.time;
        // An open on the entry side or a close beyond TP establishes the
        // order of the two touches. Defer ambiguous profits and retain SL.
        canTakeProfit = pos.side === 'BUY'
          ? candle.open <= pos.entryPrice + 1e-4 || candle.close >= pos.tp
          : candle.open >= pos.entryPrice - 1e-4 || candle.close <= pos.tp;
        if (canvasApi) canvasApi.requestRedraw();
      }

      // Ensure position visual box expands to enclose ongoing candle
      if (candle.time > pos.targetTime) {
        pos.targetTime = candle.time;
      }

      if (pos.side === 'BUY') {
        var isTpHit = canTakeProfit && high >= pos.tp;
        var isSlHit = low <= pos.sl;

        // Pessimistic Tie-Break: if both hit in the same candle -> SL HIT (Loss)
        if (isTpHit && isSlHit) {
          return closePositionWithOutcome(pos, 'SL_HIT', pos.sl, candle.time, 'SL_HIT (TIE_BREAK_PESSIMISTIC)');
        }
        if (isSlHit) {
          return closePositionWithOutcome(pos, 'SL_HIT', pos.sl, candle.time, 'SL_HIT');
        }
        if (isTpHit) {
          return closePositionWithOutcome(pos, 'TP_HIT', pos.tp, candle.time, 'TP_HIT');
        }
      } else if (pos.side === 'SELL') {
        var isShortSlHit = high >= pos.sl;
        var isShortTpHit = canTakeProfit && low <= pos.tp;

        // Pessimistic Tie-Break: if both hit in the same candle -> SL HIT (Loss)
        if (isShortTpHit && isShortSlHit) {
          return closePositionWithOutcome(pos, 'SL_HIT', pos.sl, candle.time, 'SL_HIT (TIE_BREAK_PESSIMISTIC)');
        }
        if (isShortSlHit) {
          return closePositionWithOutcome(pos, 'SL_HIT', pos.sl, candle.time, 'SL_HIT');
        }
        if (isShortTpHit) {
          return closePositionWithOutcome(pos, 'TP_HIT', pos.tp, candle.time, 'TP_HIT');
        }
      }

      // Position remains active -> update floating PnL
      if (ledger) {
        ledger.updateFloating(pos, candle.close);
      }
      return null;
    }

    function evaluateTimelineCandle(candle, index) {
      if (!activePosition) return false;
      var pos = activePosition;
      var previous = Object.assign({}, pos);
      var wallet = ledger.checkpoint();
      var positionIndex = positions.lastIndexOf(pos);
      var hit = evaluateCandle(candle, index);
      var executionChanged = Boolean(hit) || pos.filled !== previous.filled;
      var targetChanged = pos.targetTime !== previous.targetTime;
      if (executionChanged || targetChanged || ledger.checkpoint().some(function (value, i) { return value !== wallet[i]; })) {
        history.push([barEnd(candle), wallet, positionIndex, 1,
          executionChanged ? [previous] : targetChanged ? previous.targetTime : null]);
      }
      return executionChanged;
    }

    // ------------------------------------------------------------- Tool & Pointer Handling

    function handleToolChange(newTool) {
      if (draft) draft = null;
      if (newTool !== 'cursor') {
        deselect();
      }
      hoverPos = null;
      if (canvasApi) canvasApi.requestRedraw();
    }

    if (canvasApi && canvasApi.onToolChange) {
      canvasApi.onToolChange(handleToolChange);
    }

    function createDraftPosition(side, x, y, time, price) {
      var t = resolveTime(time, x);
      var p = price != null ? Number(price.toFixed(3)) : 4000.0;
      var isBuy = side === 'BUY';
      var slDist = 2.0; // $2.00 = 20 pips
      var tpDist = 4.0; // $4.00 = 40 pips (R:R 2.0)

      var candles = getCandles();
      var barSpanSeconds = 300; // default 5m
      if (Array.isArray(candles) && candles.length >= 2) {
        barSpanSeconds = Math.max(60, candles[1].time - candles[0].time);
      }
      var targetTime = t + (20 * barSpanSeconds);

      var currBar = getCurrentBar();
      var entryBarIndex = null;
      var filled = true;

      if (currBar && currBar.index != null) {
        entryBarIndex = currBar.index;
      } else if (Array.isArray(candles) && candles.length > 0) {
        entryBarIndex = Math.max(0, candles.length - 1);
      }

      if (currBar) {
        var barTime = currBar.time;
        var barLow = currBar.low != null ? Number(currBar.low) : null;
        var barHigh = currBar.high != null ? Number(currBar.high) : null;
        var barClose = currBar.close != null ? Number(currBar.close) : null;

        if (barTime != null && t > barTime) {
          filled = false;
        } else if (barLow != null && barHigh != null) {
          filled = (p >= barLow - 1e-4 && p <= barHigh + 1e-4);
        } else if (barClose != null) {
          filled = (Math.abs(p - barClose) <= 1.0);
        }
      }

      return {
        id: nextPosId(side.toLowerCase()),
        type: 'position',
        side: side,
        status: 'ACTIVE',
        filled: filled,
        entryPrice: p,
        sl: isBuy ? Number((p - slDist).toFixed(3)) : Number((p + slDist).toFixed(3)),
        tp: isBuy ? Number((p + tpDist).toFixed(3)) : Number((p - tpDist).toFixed(3)),
        lot: defaultLot,
        entryTime: t,
        entryBarIndex: entryBarIndex,
        targetTime: targetTime,
        exitPrice: null,
        exitTime: null,
        exitReason: null,
        netPnl: null
      };
    }

    function handlePointer(payload) {
      if (isDestroyed || !canvasApi) return;
      var tool = canvasApi.getActiveTool();
      var type = payload.type;
      var x = payload.x;
      var y = payload.y;
      var time = payload.time;
      var price = payload.price;

      if (tool === 'cursor' && selectedId != null) {
        handleSelectionPointer(type, x, y, time, price, payload);
        return;
      }

      if (tool === 'long_pos' || tool === 'short_pos') {
        var side = tool === 'long_pos' ? 'BUY' : 'SELL';
        if (type === 'pointermove') {
          hoverPos = { x: x, y: y, price: price, time: time, side: side };
          canvasApi.requestRedraw();
        } else if (type === 'pointerdown') {
          if (price != null && !isNaN(price)) {
            var newPos = createDraftPosition(side, x, y, time, price);
            addPosition(newPos);
            hoverPos = null;
            onCommit(newPos);
          }
        }
      }
    }

    // ------------------------------------------------------------- Selection & Drag Manipulation

    function findPositionAt(px, py) {
      for (var i = positions.length - 1; i >= 0; i -= 1) {
        var pos = positions[i];
        var x1 = timeToCoord(pos.entryTime);
        var x2 = timeToCoord(pos.targetTime);
        var yEntry = priceToCoord(pos.entryPrice);
        var ySl = priceToCoord(pos.sl);
        var yTp = priceToCoord(pos.tp);

        if (x1 == null || x2 == null || yEntry == null || ySl == null || yTp == null) continue;

        var minX = Math.min(x1, x2);
        var maxX = Math.max(x1, x2);
        var minY = Math.min(yEntry, ySl, yTp);
        var maxY = Math.max(yEntry, ySl, yTp);
        var midX = (minX + maxX) / 2;

        // Handles are tested first and with a generous radius: they are the
        // reason the user reaches for the box at all (R:R / TP / SL are set by
        // dragging them), and an 18px circle gives accurate touch hit-testing.
        if (Math.hypot(px - midX, py - yTp) <= 18) {
          return { pos: pos, part: 'tp_handle' };
        }
        if (Math.hypot(px - midX, py - ySl) <= 18) {
          return { pos: pos, part: 'sl_handle' };
        }
        if (Math.hypot(px - midX, py - yEntry) <= 18) {
          return { pos: pos, part: 'entry_handle' };
        }
        var midY = (minY + maxY) / 2;
        if (Math.hypot(px - maxX, py - midY) <= 18) {
          return { pos: pos, part: 'right_handle' };
        }

        // Check if inside box bounds
        if (px >= minX - 10 && px <= maxX + 10 && py >= minY - 10 && py <= maxY + 10) {
          // A horizontal band is only claimed away from the box edges so the
          // right-edge handle keeps priority.
          if (Math.abs(py - yTp) <= 6 && px >= minX && px <= maxX - 8) {
            return { pos: pos, part: 'tp_handle' };
          }
          if (Math.abs(py - ySl) <= 6 && px >= minX && px <= maxX - 8) {
            return { pos: pos, part: 'sl_handle' };
          }
          if (Math.abs(py - yEntry) <= 6 && px >= minX && px <= maxX - 8) {
            return { pos: pos, part: 'entry_handle' };
          }
          if (Math.abs(px - maxX) <= 10) {
            return { pos: pos, part: 'right_handle' };
          }
          return { pos: pos, part: 'body' };
        }
      }
      return null;
    }

    function handleSelectionPointer(type, x, y, time, price, _payload) {
      var sel = getPositionById(selectedId);
      if (!sel) return;

      if (type === 'pointerdown') {
        var hit = findPositionAt(x, y);
        if (hit && hit.pos.id === sel.id) {
          onEditStart();
          rememberAction(getCurrentBar(), positions.indexOf(sel), 1, [sel]);
          dragState = {
            part: hit.part,
            origX: x,
            origY: y,
            origEntry: sel.entryPrice,
            origSl: sel.sl,
            origTp: sel.tp,
            origTime: sel.entryTime,
            origTargetTime: sel.targetTime
          };
        } else if (!hit) {
          deselect();
        }
      } else if (type === 'pointermove') {
        if (!dragState) {
          var hoverHit = findPositionAt(x, y);
          if (hoverHit && hoverHit.pos.id === sel.id) {
            if (hoverHit.part === 'tp_handle' || hoverHit.part === 'sl_handle' || hoverHit.part === 'entry_handle') {
              canvasApi.setCursor('ns-resize');
            } else if (hoverHit.part === 'right_handle') {
              canvasApi.setCursor('ew-resize');
            } else {
              canvasApi.setCursor('move');
            }
          } else {
            canvasApi.setCursor('default');
          }
          return;
        }

        // Active dragging
        var currPrice = price != null ? price : (chartApi && chartApi.coordinateToPrice ? chartApi.coordinateToPrice(y) : null);
        var currTime = resolveTime(time, x);

        if (dragState.part === 'tp_handle' && currPrice != null) {
          if (sel.side === 'BUY') {
            sel.tp = Math.max(Number((sel.entryPrice + 0.1).toFixed(3)), Number(currPrice.toFixed(3)));
          } else {
            sel.tp = Math.min(Number((sel.entryPrice - 0.1).toFixed(3)), Number(currPrice.toFixed(3)));
          }
        } else if (dragState.part === 'sl_handle' && currPrice != null) {
          if (sel.side === 'BUY') {
            sel.sl = Math.min(Number((sel.entryPrice - 0.1).toFixed(3)), Number(currPrice.toFixed(3)));
          } else {
            sel.sl = Math.max(Number((sel.entryPrice + 0.1).toFixed(3)), Number(currPrice.toFixed(3)));
          }
        } else if (dragState.part === 'entry_handle' && currPrice != null) {
          var deltaP = currPrice - dragState.origEntry;
          sel.entryPrice = Number(currPrice.toFixed(3));
          sel.sl = Number((dragState.origSl + deltaP).toFixed(3));
          sel.tp = Number((dragState.origTp + deltaP).toFixed(3));
          var currBar = getCurrentBar();
          if (currBar && currBar.low != null && currBar.high != null) {
            sel.filled = sel.entryTime <= currBar.time &&
              sel.entryPrice >= currBar.low - 1e-4 && sel.entryPrice <= currBar.high + 1e-4;
          }
        } else if (dragState.part === 'right_handle' && currTime != null) {
          if (currTime > sel.entryTime) {
            sel.targetTime = currTime;
          }
        } else if (dragState.part === 'body' && currPrice != null && currTime != null) {
          var origPrice = chartApi ? chartApi.coordinateToPrice(dragState.origY) : null;
          var deltaPrice = (origPrice != null) ? (currPrice - origPrice) : 0;
          sel.entryPrice = Number((dragState.origEntry + deltaPrice).toFixed(3));
          sel.sl = Number((dragState.origSl + deltaPrice).toFixed(3));
          sel.tp = Number((dragState.origTp + deltaPrice).toFixed(3));
          var currBar = getCurrentBar();
          if (currBar && currBar.low != null && currBar.high != null) {
            sel.filled = sel.entryTime <= currBar.time &&
              sel.entryPrice >= currBar.low - 1e-4 && sel.entryPrice <= currBar.high + 1e-4;
          }
        }
        canvasApi.requestRedraw();
      } else if (type === 'pointerup' || type === 'pointercancel') {
        if (dragState) {
          dragState = null;
          canvasApi.setCursor('default');
          onChange(sel);
        } else {
          canvasApi.setCursor('default');
        }
      }
    }

    function handleChartClick(param) {
      if (!canvasApi) return;
      var tool = canvasApi.getActiveTool();
      if (tool !== 'cursor') return;

      var px = param.point ? param.point.x : param.x;
      var py = param.point ? param.point.y : param.y;
      if (px == null || py == null) return;

      var hit = findPositionAt(px, py);
      if (hit) {
        selectPosition(hit.pos.id);
      }
    }

    if (chartApi && chartApi.subscribeClick) {
      chartApi.subscribeClick(handleChartClick);
    }

    // ------------------------------------------------------------- Rendering

    // replay_canvas invokes renderers as fn(ctx, helpers), so the second
    // argument is an object — not a numeric width. Read the geometry from it.
    function renderPositions(ctx, helpers) {
      if (!ctx || isDestroyed) return;
      var width = helpers && helpers.width ? helpers.width : 0;
      var height = helpers && helpers.height ? helpers.height : 0;

      // Render all saved positions
      for (var i = 0; i < positions.length; i += 1) {
        var pos = positions[i];
        drawPositionBox(ctx, pos, pos.id === selectedId, false, width, height);
      }

      // Render hover placement ghost
      if (hoverPos && (canvasApi.getActiveTool() === 'long_pos' || canvasApi.getActiveTool() === 'short_pos')) {
        var ghost = createDraftPosition(hoverPos.side, hoverPos.x, hoverPos.y, hoverPos.time, hoverPos.price);
        drawPositionBox(ctx, ghost, true, true, width, height);
      }
    }

    function drawPositionBox(ctx, pos, isSelected, isGhost, width, height) {
      var x1 = timeToCoord(pos.entryTime);
      var x2 = timeToCoord(pos.targetTime);
      var yEntry = priceToCoord(pos.entryPrice);
      var ySl = priceToCoord(pos.sl);
      var yTp = priceToCoord(pos.tp);

      if (x1 == null || yEntry == null || ySl == null || yTp == null) return;
      if (x2 == null) x2 = x1 + 180; // fallback width

      var left = Math.min(x1, x2);
      var right = Math.max(x1, x2);
      var boxWidth = Math.max(30, right - left);

      var rr = Ledger ? Ledger.calculateRiskReward({
        side: pos.side,
        entryPrice: pos.entryPrice,
        sl: pos.sl,
        tp: pos.tp,
        lot: pos.lot
      }) : { riskUsd: 20, rewardUsd: 40, ratio: 2.0, riskPips: 20, rewardPips: 40 };

      ctx.save();
      if (isGhost) {
        ctx.globalAlpha = 0.55;
      }

      // 1. TP Zone (Green)
      var tpTop = Math.min(yEntry, yTp);
      var tpHeight = Math.abs(yEntry - yTp);
      ctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
      ctx.fillRect(left, tpTop, boxWidth, tpHeight);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(left, tpTop, boxWidth, tpHeight);

      // 2. SL Zone (Red)
      var slTop = Math.min(yEntry, ySl);
      var slHeight = Math.abs(yEntry - ySl);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.fillRect(left, slTop, boxWidth, slHeight);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(left, slTop, boxWidth, slHeight);

      // 3. Entry Line
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(left, yEntry);
      ctx.lineTo(right, yEntry);
      ctx.stroke();
      ctx.setLineDash([]);

      // 4. Info card — placed OUTSIDE the box (left side preferred) so the TP
      // and SL zones stay fully visible. Small monospace type keeps it legible
      // without covering candles or the position body.
      var isPending = (pos.status === 'ACTIVE' && pos.filled === false);
      var statusText = isPending ? '⏳ PENDING' : (pos.status === 'ACTIVE' ? '● ACTIVE' : (pos.status === 'TP_HIT' ? '✔ TP HIT' : (pos.status === 'SL_HIT' ? '✖ SL HIT' : '■ CLOSED')));
      if (pos.status === 'CANCELLED') statusText = '? CANCELLED';
      var statusColor = isPending ? '#f59e0b' : (pos.status === 'ACTIVE' ? '#38bdf8' : (pos.status === 'TP_HIT' ? '#22c55e' : (pos.status === 'SL_HIT' ? '#ef4444' : '#94a3b8')));

      var lines = [
        { text: statusText + ' · ' + pos.side + ' ' + (pos.lot || defaultLot) + 'L', color: statusColor },
        { text: 'R:R 1:' + rr.ratio.toFixed(2), color: '#e2e8f0' },
        { text: 'TP +' + rr.rewardPips + 'p · SL -' + rr.riskPips + 'p', color: '#94a3b8' },
        {
          text: pos.netPnl != null ? ('PnL $' + pos.netPnl) : ('+$' + rr.rewardUsd + ' / -$' + rr.riskUsd),
          color: '#94a3b8'
        }
      ];

      var cardFont = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.font = cardFont;
      var textW = 0;
      for (var li = 0; li < lines.length; li += 1) {
        textW = Math.max(textW, ctx.measureText(lines[li].text).width);
      }

      var lineH = 11;
      var padX = 6;
      var padY = 4;
      var cardW = Math.max(84, Math.min(150, Math.ceil(textW) + padX * 2));
      var cardH = lines.length * lineH + padY * 2;
      var gap = 8;

      // Prefer the left gutter; flip to the right when the box hugs the edge.
      var cardX = left - gap - cardW;
      if (cardX < 2) cardX = right + gap;
      if (cardX + cardW > width - 2) {
        cardX = Math.max(2, Math.min(width - cardW - 2, left + 4));
      }
      var cardY = yEntry - cardH / 2;
      cardY = Math.max(2, Math.min(Math.max(2, height - cardH - 2), cardY));

      // Leader line ties the card to its box without crossing the zones.
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      if (cardX + cardW <= left) {
        ctx.moveTo(cardX + cardW, cardY + cardH / 2);
        ctx.lineTo(left, yEntry);
      } else if (cardX >= right) {
        ctx.moveTo(cardX, cardY + cardH / 2);
        ctx.lineTo(right, yEntry);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = isSelected ? '#38bdf8' : '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 5);
      else ctx.rect(cardX, cardY, cardW, cardH);
      ctx.fill();
      ctx.stroke();

      ctx.font = cardFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (var ti = 0; ti < lines.length; ti += 1) {
        ctx.fillStyle = lines[ti].color;
        ctx.fillText(lines[ti].text, cardX + padX, cardY + padY + lineH * ti + lineH / 2);
      }

      // 5. Anchor handles when selected
      if (isSelected && !isGhost) {
        var midX = left + boxWidth / 2;
        var handleColor = '#0284c7';
        var handleFill = '#ffffff';

        // TP Handle
        drawHandle(ctx, midX, yTp, handleFill, handleColor);
        // SL Handle
        drawHandle(ctx, midX, ySl, handleFill, handleColor);
        // Entry Handle
        drawHandle(ctx, midX, yEntry, handleFill, handleColor);
        // Right Edge Handle
        drawHandle(ctx, right, (yTp + ySl) / 2, handleFill, handleColor);
      }

      ctx.restore();
    }

    function drawHandle(ctx, x, y, fill, stroke) {
      ctx.save();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (canvasApi && canvasApi.registerRenderer) {
      canvasApi.registerRenderer(renderPositions);
      canvasApi.onPointer(handlePointer);
    }

    function destroy() {
      isDestroyed = true;
      if (canvasApi && canvasApi.unregisterRenderer) {
        canvasApi.unregisterRenderer(renderPositions);
      }
    }

    return {
      getPositions: getPositions,
      getActivePosition: getActivePosition,
      getPositionById: getPositionById,
      addPosition: addPosition,
      removePosition: removePosition,
      clearPositions: clearPositions,
      setPositions: setPositions,
      selectPosition: selectPosition,
      deselect: deselect,
      deleteSelected: deleteSelected,
      getSelectedId: function () { return selectedId; },
      setLot: setLot,
      getLot: getLot,
      closePosition: closePosition,
      evaluateCandle: evaluateCandle,
      evaluateTimelineCandle: evaluateTimelineCandle,
      rewindTo: rewindTo,
      trimLegacyState: trimLegacyState,
      loadHistory: loadHistory,
      getHistory: function () { return history; },
      getLedger: function () { return ledger; },
      restoreLedger: restoreLedger,
      destroy: destroy
    };
  }

  var SmcReplaySimulator = {
    init: init
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SmcReplaySimulator;
  }
  global.SmcReplaySimulator = SmcReplaySimulator;
})(typeof window !== 'undefined' ? window : globalThis);
