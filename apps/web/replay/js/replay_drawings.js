/**
 * Replay drawing interaction, hit testing, selection, and canvas rendering.
 *
 * Store anchors as UTC epoch seconds and prices so drawings follow the chart
 * when the user pans, zooms, or switches timeframe.
 */
(function (global) {
  'use strict';

  var idCounter = 0;
  var annotationAnchors = {
    ray: 2, vline: 1, channel: 3, 'fib-extension': 3, text: 1, arrow: 2,
    horizontal_ray: 1, price_label: 1, price_range: 2, date_range: 2, date_price_range: 2,
    pitchfork: 3, regression_channel: 2, fib_fan: 2, fib_time_zones: 2,
    elliott_wave: 6, risk_reward: 3
  };
  var extensionLevels = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];
  var fibonacciTimeZones = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
  var timeIntervalTools = ['channel', 'date_range', 'regression_channel', 'fib_fan', 'fib_time_zones'];

  function nextId(prefix) {
    idCounter += 1;
    return (prefix || 'draw') + '_' + Date.now() + '_' + idCounter;
  }

  function clone(obj) {
    if (!obj) return null;
    return JSON.parse(JSON.stringify(obj));
  }

  function formatDuration(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return days + 'd ' + hours + 'h';
    if (hours > 0) return hours + 'h ' + (mins > 0 ? mins + 'm' : '');
    return mins + 'm';
  }

  function init(options) {
    options = options || {};
    var canvasApi = options.canvasApi;
    var chartApi = options.chartApi;
    var onCommit = options.onCommit || function () {};
    var onChange = options.onChange || function () {};
    var onSelectionChange = options.onSelectionChange || function () {};
    var getCandles = options.getCandles || function () { return []; };
    var getSnapCandles = options.getSnapCandles;
    var getText = options.getText;

    var drawings = [];
    var draft = null;
    var rulerState = null;
    var hoverPos = null;
    var selectedId = null;
    var dragState = null;
    var isDestroyed = false;
    var snapEnabled = false;

    function lastRevealedIndex(candles) {
      var wm = chartApi && chartApi.getWatermark ? chartApi.getWatermark() : null;
      return wm == null ? candles.length - 1 : Math.min(wm, candles.length - 1);
    }

    function snapPoint(x, y, time) {
      if (!snapEnabled) return null;
      var candles = getSnapCandles ? getSnapCandles() : getCandles();
      var lastIndex = getSnapCandles ? candles.length - 1 : lastRevealedIndex(candles);
      if (lastIndex < 0) return null;
      var last = candles[lastIndex];
      var lastX = timeToCoord(last.time);
      if (lastX == null || (time == null && x > lastX + 1) || time > last.time) return null;

      var target = time != null ? time : snapToRevealedBar(x);
      var index = lowerBoundTime(candles, target, lastIndex);
      if (index > 0 && Math.abs(candles[index - 1].time - target) < Math.abs(candles[index].time - target)) {
        index -= 1;
      }
      var candle = candles[index];
      var levels = [candle.open, candle.high, candle.low, candle.close];
      var best = null;
      levels.forEach(function (level) {
        if (!Number.isFinite(level)) return;
        var coordinate = priceToCoord(level);
        if (coordinate != null && (!best || Math.abs(coordinate - y) < Math.abs(best.y - y))) {
          best = { time: candle.time, price: level, y: coordinate };
        }
      });
      return best;
    }

    function lowerBoundTime(candles, time, hi) {
      var lo = 0;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (candles[mid].time < time) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    function resolveTime(time, x) {
      if (time != null && !isNaN(time) && time > 0) return time;
      if (chartApi && chartApi.coordinateToTime && x != null) {
        try {
          var ct = chartApi.coordinateToTime(x);
          if (ct != null && !isNaN(ct) && ct > 0) return ct;
        } catch {}
      }
      return snapToRevealedBar(x);
    }

    // The chart refuses to name a time to the right of the last revealed bar:
    // coordinateToTime() returns null in that whitespace, so dragging a shape
    // past the newest candle snapped back onto it and the user could not size a
    // rectangle ahead of price. Extrapolate instead, using the bar spacing that
    // is already on screen. This is how a trader draws a zone before price gets
    // there.
    function extrapolateTime(x) {
      var candles = getCandles();
      if (!Array.isArray(candles) || candles.length < 2 || x == null || isNaN(x)) return null;

      var lastIdx = lastRevealedIndex(candles);
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

      // Round to a whole bar so the anchor lands on a bar boundary rather than
      // an arbitrary fractional timestamp.
      return candles[lastIdx].time + Math.round(barsAhead) * span;
    }

    // resolveTime() for the right-hand edge of a drag. coordinateToTime() wins
    // while the pointer is still over revealed bars; past the newest bar we
    // extrapolate forward instead of collapsing onto the last bar.
    function resolveEdgeTime(time, x) {
      if (time != null && !isNaN(time) && time > 0) return time;
      var ahead = extrapolateTime(x);
      if (ahead != null) return ahead;
      return snapToRevealedBar(x);
    }

    // coordinateToTime() returns null for whitespace (before the first revealed
    // bar / after the last one) and for data gaps (weekends, session breaks).
    // The old fallback used the month's last bar, which is off-screen at replay
    // time, so timeToCoordinate() returned null and the committed rectangle or
    // trendline was never painted. Snap to the nearest revealed bar instead.
    function snapToRevealedBar(x) {
      var candles = getCandles();
      if (!Array.isArray(candles) || candles.length === 0) return 1761868800;

      var lastIdx = lastRevealedIndex(candles);
      if (lastIdx < 0) return null;

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
      var interpolated = interpolateCoord(t);
      return interpolated != null ? interpolated : extrapolateCoord(t);
    }

    // timeToCoordinate() returns null for times past the newest revealed bar, so
    // a rectangle drawn ahead of price would render with a null right edge and
    // disappear. Project forward from the last bar using the on-screen spacing.
    function extrapolateCoord(t) {
      var candles = getCandles();
      if (!Array.isArray(candles) || candles.length < 2) return null;

      var lastIdx = lastRevealedIndex(candles);
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

    // timeToCoordinate() only accepts exact bar times of the *active* series.
    // An M5 anchor is rarely an M15 bar time, so after a timeframe switch the
    // projection returned null and the shape disappeared even though both price
    // anchors were valid (spec §4.3 requires drawings to survive timeframe
    // switches). Same for anchors that fall inside a data gap. Interpolate the
    // pixel position between the two surrounding bars of the active series.
    function interpolateCoord(t) {
      var candles = getCandles();
      if (!Array.isArray(candles) || candles.length < 2) return null;

      var lastIdx = lastRevealedIndex(candles);
      if (lastIdx < 0) return null;
      var lo = lowerBoundTime(candles, t, lastIdx + 1);
      if (lo <= lastIdx && candles[lo].time === t) {
        return logicalCoord(lo);
      }
      if (lo <= 0 || lo > lastIdx) return null;

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

    function coordinateToPrice(y) {
      if (!chartApi || !chartApi.coordinateToPrice || y == null || isNaN(y)) return null;
      try {
        var p = chartApi.coordinateToPrice(y);
        return (p == null || isNaN(p)) ? null : p;
      } catch {
        return null;
      }
    }

    // ------------------------------------------------------------- drawing CRUD

    function getDrawings() {
      return drawings.slice();
    }

    function getDrawingById(id) {
      for (var i = 0; i < drawings.length; i += 1) {
        if (drawings[i].id === id) return drawings[i];
      }
      return null;
    }

    function normalizeDrawing(item) {
      var normalized = Object.assign({
        color: item.type === 'fib' || item.type === 'fib-extension' ? '#a78bfa' : '#38bdf8',
        lineWidth: item.type === 'fib' ? 1 : 1.5,
        lineStyle: item.type === 'hline' ? 'dashed' : 'solid',
        hidden: false,
        locked: false,
        version: 2
      }, item);
      if (!(item.version >= 2)) {
        normalized.version = 2;
        if (item.type === 'fib') {
          normalized.color = '#a78bfa';
          normalized.lineWidth = 1;
        }
      }
      return normalized;
    }

    function addDrawing(item) {
      if (!item || !item.type) return null;
      if (!item.id) item.id = nextId(item.type);
      item = normalizeDrawing(item);
      drawings.push(item);
      if (canvasApi) canvasApi.requestRedraw();
      return item;
    }

    function updateDrawing(id, patch) {
      var item = getDrawingById(id);
      if (!item || !patch) return null;
      if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) item.color = patch.color;
      if (Number.isFinite(patch.lineWidth) && patch.lineWidth > 0) item.lineWidth = patch.lineWidth;
      if (['solid', 'dashed', 'dotted'].indexOf(patch.lineStyle) >= 0) item.lineStyle = patch.lineStyle;
      if (typeof patch.hidden === 'boolean') item.hidden = patch.hidden;
      if (typeof patch.locked === 'boolean') item.locked = patch.locked;
      if (item.type === 'text' && typeof patch.text === 'string' && patch.text.trim()) {
        item.text = patch.text.trim();
      }
      if ((item.hidden || item.locked) && dragState && dragState.item === item) dragState = null;
      if (canvasApi) {
        if (item.id === selectedId) updateCanvasSelection();
        canvasApi.requestRedraw();
      }
      onChange(item);
      return item;
    }

    function duplicateDrawing(id) {
      var original = getDrawingById(id);
      if (!original) return null;
      var copy = clone(original);
      delete copy.id;
      var item = addDrawing(copy);
      onCommit(item);
      selectDrawing(item.id);
      return item;
    }

    function removeDrawing(id) {
      var idx = -1;
      for (var i = 0; i < drawings.length; i += 1) {
        if (drawings[i].id === id) {
          idx = i;
          break;
        }
      }
      if (idx !== -1) {
        var removed = drawings.splice(idx, 1)[0];
        if (selectedId === id) {
          deselect();
        } else if (canvasApi) {
          canvasApi.requestRedraw();
        }
        return removed;
      }
      return null;
    }

    function clearDrawings() {
      var count = drawings.length;
      drawings = [];
      draft = null;
      rulerState = null;
      dragState = null;
      selectDrawing(null);
      return count;
    }

    function setDrawings(list) {
      drawings = Array.isArray(list) ? list.filter(function (item) {
        return item && item.type;
      }).map(normalizeDrawing) : [];
      draft = null;
      dragState = null;
      selectDrawing(null);
    }

    function getSelectedId() {
      return selectedId;
    }

    function selectDrawing(id) {
      var changed = selectedId !== id;
      selectedId = id;
      if (changed) onSelectionChange(id);
      if (canvasApi) {
        if (changed || id != null) updateCanvasSelection();
        if (changed && id == null) canvasApi.setCursor('default');
        canvasApi.requestRedraw();
      }
    }

    function updateCanvasSelection() {
      var selected = getDrawingById(selectedId);
      canvasApi.setSelectionActive(Boolean(selected && !selected.hidden && !selected.locked));
    }

    function deselect() {
      if (selectedId != null) selectDrawing(null);
    }

    function deleteSelected() {
      if (selectedId != null) {
        var id = selectedId;
        removeDrawing(id);
        return id;
      }
      return null;
    }

    // ------------------------------------------------------------- tool changes

    function handleToolChange(newTool) {
      if (newTool !== 'ruler' && rulerState) {
        rulerState = null;
      }
      if (draft) {
        draft = null;
      }
      if (newTool !== 'cursor') {
        deselect();
      }
      hoverPos = null;
      if (canvasApi) canvasApi.requestRedraw();
    }

    if (canvasApi && canvasApi.onToolChange) {
      canvasApi.onToolChange(handleToolChange);
    }

    // ------------------------------------------------------------- pointer events

    function handlePointer(payload) {
      if (isDestroyed || !canvasApi) return;
      var tool = canvasApi.getActiveTool();
      var type = payload.type;
      var x = payload.x;
      var y = payload.y;
      var time = payload.time;
      var price = payload.price;
      var snapped = tool !== 'ruler' && tool !== 'brush' && !payload.shiftKey ? snapPoint(x, y, time) : null;
      var anchorTime = snapped ? snapped.time : time;
      var anchorPrice = snapped ? snapped.price : price;
      var anchorY = snapped ? snapped.y : y;

      // In cursor mode with a selected item, handle selection manipulation
      if (tool === 'cursor' && selectedId != null) {
        handleSelectionPointer(type, x, y, time, price, snapped);
        return;
      }

      // Shift + click trigger for transient ruler in any mode
      if (payload.shiftKey && type === 'pointerdown' && !rulerState) {
        startRuler(x, y, time, price);
        return;
      }

      if (tool === 'hline') {
        handleHLinePointer(type, x, anchorY, anchorTime, anchorPrice);
      } else if (tool === 'rect') {
        handleRectPointer(type, x, anchorY, anchorTime, anchorPrice);
      } else if (tool === 'trendline' || tool === 'fib') {
        handleTwoAnchorPointer(tool, type, x, anchorY, anchorTime, anchorPrice);
      } else if (tool === 'brush') {
        handleBrushPointer(type, x, y, time, price);
      } else if (Object.hasOwn(annotationAnchors, tool)) {
        handleAnnotationPointer(tool, type, x, y, anchorTime, anchorPrice);
      } else if (tool === 'ruler') {
        handleRulerPointer(type, x, y, time, price);
      } else {
        hoverPos = null;
        draft = null;
      }
    }

    function setAnnotationAnchor(item, anchor, time, price) {
      if (Number.isFinite(time)) item['t' + anchor] = time;
      if (item.type !== 'vline' && Number.isFinite(price)) item['p' + anchor] = Number(price.toFixed(3));
    }

    function validAnnotationAnchor(d, anchor, time, price) {
      if (anchor <= 2 && timeIntervalTools.indexOf(d.type) >= 0 && time === d['t' + (3 - anchor)]) return false;
      if ((d.type === 'price_range' || d.type === 'fib_fan') && price === d['p' + (3 - anchor)]) return false;
      if (d.type === 'risk_reward') {
        var entry = anchor === 1 ? price : d.p1;
        var stopOffset = (anchor === 2 ? price : d.p2) - entry;
        var targetOffset = (anchor === 3 ? price : d.p3) - entry;
        return stopOffset !== 0 && targetOffset !== 0 && !(stopOffset * targetOffset > 0);
      }
      return true;
    }

    function handleAnnotationPointer(tool, type, x, y, time, price) {
      if (type === 'pointercancel') {
        draft = null;
        canvasApi.requestRedraw();
        return;
      }
      if (type !== 'pointermove' && type !== 'pointerdown' && type !== 'pointerup') return;
      var t = resolveEdgeTime(time, x);
      if (t == null || (tool !== 'vline' && !Number.isFinite(price))) return;
      var count = annotationAnchors[tool];

      if (!draft) {
        if (type !== 'pointerdown') return;
        var drawing = { type: tool };
        setAnnotationAnchor(drawing, 1, t, price);
        if (count === 1) {
          if (tool === 'text') {
            var value = getText ? getText() : 'Text';
            if (typeof value !== 'string' || !value.trim()) return;
            drawing.text = value.trim();
          }
          onCommit(addDrawing(drawing));
        } else {
          draft = Object.assign(drawing, { anchor: 2, firstX: x, firstY: y });
          canvasApi.requestRedraw();
        }
        return;
      }

      var anchor = draft.anchor;
      var nextPrice = Number.isFinite(price) ? Number(price.toFixed(3)) : price;
      setAnnotationAnchor(draft, anchor, t, nextPrice);
      var moved = Math.hypot(x - draft.firstX, y - draft.firstY) > 5;
      var finishAnchor = type === 'pointerdown' || (type === 'pointerup' && anchor === 2 && moved);
      if (finishAnchor && (!validAnnotationAnchor(draft, anchor, t, nextPrice) ||
          (anchor === 2 && draft.t1 === draft.t2 && draft.p1 === draft.p2))) {
        finishAnchor = false;
      }
      if (finishAnchor && anchor === count) {
        var item = { type: tool };
        for (var n = 1; n <= count; n += 1) {
          setAnnotationAnchor(item, n, draft['t' + n], draft['p' + n]);
        }
        draft = null;
        onCommit(addDrawing(item));
      } else {
        if (finishAnchor) draft.anchor += 1;
        canvasApi.requestRedraw();
      }
    }

    function brushTime(x, time) {
      var candles = getCandles();
      var last = lastRevealedIndex(candles);
      var startX = logicalCoord(0);
      var nextX = logicalCoord(1);
      var step = nextX - startX;
      if (last < 1 || startX == null || nextX == null || !(step > 0)) return resolveEdgeTime(time, x);
      var position = Math.max(0, (x - startX) / step);
      var left = Math.min(Math.floor(position), last - 1);
      return candles[left].time + (position - left) * (candles[left + 1].time - candles[left].time);
    }

    function handleBrushPointer(type, x, y, time, price) {
      if (type === 'pointercancel') {
        draft = null;
      } else if (type === 'pointerdown') {
        draft = { type: 'brush', points: [] };
      } else if (!draft) {
        return;
      }
      if (draft && Number.isFinite(price) && (draft.lastX == null || Math.hypot(x - draft.lastX, y - draft.lastY) >= 2)) {
        var t = brushTime(x, time);
        if (t != null) {
          draft.points.push([t, Number(price.toFixed(3))]);
          draft.lastX = x;
          draft.lastY = y;
        }
      }
      if (type === 'pointerup') {
        var points = draft.points;
        draft = null;
        if (points.length > 1) onCommit(addDrawing({ type: 'brush', points: points }));
      }
      canvasApi.requestRedraw();
    }

    // ------------------------------------------------------------- HLine pointer

    function handleHLinePointer(type, x, y, time, price) {
      if (type === 'pointermove') {
        hoverPos = { x: x, y: y, price: price };
        canvasApi.requestRedraw();
      } else if (type === 'pointerdown') {
        if (price != null && !isNaN(price)) {
          var item = addDrawing({
            type: 'hline',
            price: Number(price.toFixed(3)),
            color: '#38bdf8',
            lineWidth: 1.5,
            label: 'S/R'
          });
          hoverPos = null;
          onCommit(item);
        }
      }
    }

    // ------------------------------------------------------------- Rect pointer

    function handleRectPointer(type, x, y, time, price) {
      var t = resolveTime(time, x);

      if (type === 'pointerdown') {
        if (price != null && !isNaN(price)) {
          if (!draft) {
            draft = {
              type: 'rect',
              t1: t,
              p1: price,
              t2: t,
              p2: price,
              x1: x,
              y1: y,
              x2: x,
              y2: y,
              mode: 'down'
            };
            canvasApi.requestRedraw();
          } else if (draft.mode === 'pending') {
            // Second click in 2-click mode
            commitRectDraft(draft, x, y, t, price);
          }
        }
      } else if (type === 'pointermove') {
        if (draft) {
          draft.x2 = x;
          draft.y2 = y;
          var tEdge = resolveEdgeTime(time, x);
          if (tEdge != null) draft.t2 = tEdge;
          if (price != null && !isNaN(price)) draft.p2 = price;
          canvasApi.requestRedraw();
        }
      } else if (type === 'pointerup' || type === 'pointercancel') {
        if (draft && draft.mode === 'down') {
          var dx = Math.abs(draft.x2 - draft.x1);
          var dy = Math.abs(draft.y2 - draft.y1);
          if (dx > 5 || dy > 5) {
            commitRectDraft(draft, draft.x2, draft.y2, draft.t2, draft.p2);
          } else {
            // Single click detected: enter 2-click pending mode
            draft.mode = 'pending';
          }
        }
      }
    }

    function commitRectDraft(d, x2, y2, t2, p2) {
      var tStart = Math.min(resolveTime(d.t1, d.x1), resolveEdgeTime(t2, x2));
      var tEnd = Math.max(resolveTime(d.t1, d.x1), resolveEdgeTime(t2, x2));
      var pLow = Math.min(d.p1, p2);
      var pHigh = Math.max(d.p1, p2);

      if (Math.abs(pHigh - pLow) >= 0.001 || Math.abs(x2 - d.x1) > 4) {
        var item = addDrawing({
          type: 'rect',
          t1: tStart,
          p1: Number(pHigh.toFixed(3)),
          t2: tEnd,
          p2: Number(pLow.toFixed(3)),
          color: '#38bdf8',
          fillColor: 'rgba(56, 189, 248, 0.15)',
          lineWidth: 1.5,
          label: 'OB / Zone'
        });
        draft = null;
        onCommit(item);
      } else {
        draft = null;
        canvasApi.requestRedraw();
      }
    }

    // ------------------------------------------------------------- Two-anchor drawing pointer

    var fibonacciLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

    function handleTwoAnchorPointer(tool, type, x, y, time, price) {
      var t = resolveTime(time, x);

      if (type === 'pointerdown') {
        if (price != null && !isNaN(price)) {
          if (!draft) {
            draft = {
              type: tool,
              t1: t,
              p1: price,
              t2: t,
              p2: price,
              x1: x,
              y1: y,
              x2: x,
              y2: y,
              mode: 'down'
            };
            canvasApi.requestRedraw();
          } else if (draft.mode === 'pending') {
            commitTwoAnchorDraft(draft, x, y, t, price);
          }
        }
      } else if (type === 'pointermove') {
        if (draft) {
          draft.x2 = x;
          draft.y2 = y;
          var tEdge = resolveEdgeTime(time, x);
          if (tEdge != null) draft.t2 = tEdge;
          if (price != null && !isNaN(price)) draft.p2 = price;
          canvasApi.requestRedraw();
        }
      } else if (type === 'pointerup' || type === 'pointercancel') {
        if (draft && draft.mode === 'down') {
          var dx = Math.abs(draft.x2 - draft.x1);
          var dy = Math.abs(draft.y2 - draft.y1);
          if (dx > 5 || dy > 5) {
            commitTwoAnchorDraft(draft, draft.x2, draft.y2, draft.t2, draft.p2);
          } else {
            draft.mode = 'pending';
          }
        }
      }
    }

    function commitTwoAnchorDraft(d, x2, y2, t2, p2) {
      var dx = Math.abs(x2 - d.x1);
      var dy = Math.abs(y2 - d.y1);
      if ((dx > 4 || dy > 4) && (d.type !== 'fib' || d.p1.toFixed(3) !== p2.toFixed(3))) {
        var item = addDrawing({
          type: d.type,
          t1: resolveTime(d.t1, d.x1),
          p1: Number(d.p1.toFixed(3)),
          t2: resolveEdgeTime(t2, x2),
          p2: Number(p2.toFixed(3)),
          showStats: true
        });
        draft = null;
        onCommit(item);
      } else {
        draft = null;
        canvasApi.requestRedraw();
      }
    }

    // ------------------------------------------------------------- Ruler pointer

    function startRuler(x, y, time, price) {
      var t = time != null ? time : (chartApi && chartApi.coordinateToTime ? chartApi.coordinateToTime(x) : 0);
      rulerState = {
        t1: t,
        p1: price,
        t2: t,
        p2: price,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        active: true,
        committed: false
      };
      if (canvasApi) canvasApi.requestRedraw();
    }

    function handleRulerPointer(type, x, y, time, price) {
      var t = time != null ? time : (chartApi && chartApi.coordinateToTime ? chartApi.coordinateToTime(x) : 0);

      if (type === 'pointerdown') {
        if (rulerState && rulerState.committed) {
          // Clicking anywhere clears the transient ruler
          rulerState = null;
          canvasApi.requestRedraw();
        } else if (!rulerState) {
          startRuler(x, y, t, price);
        }
      } else if (type === 'pointermove') {
        if (rulerState && rulerState.active) {
          rulerState.x2 = x;
          rulerState.y2 = y;
          if (t != null) rulerState.t2 = t;
          if (price != null && !isNaN(price)) rulerState.p2 = price;
          canvasApi.requestRedraw();
        }
      } else if (type === 'pointerup' || type === 'pointercancel') {
        if (rulerState && rulerState.active) {
          rulerState.active = false;
          rulerState.committed = true;
          canvasApi.requestRedraw();
        }
      }
    }

    // ------------------------------------------------------------- Selection & Manipulation

    function findDrawingAt(x, y) {
      if (!chartApi) return null;
      // Hit-test in reverse order (topmost first)
      for (var i = drawings.length - 1; i >= 0; i -= 1) {
        var d = drawings[i];
        if (d.hidden) continue;
        if (d.type === 'hline') {
          var yCoord = priceToCoord(d.price);
          if (yCoord != null && Math.abs(y - yCoord) <= 12) {
            return d;
          }
        } else if (d.type === 'rect') {
          var x1 = timeToCoord(d.t1);
          var x2 = timeToCoord(d.t2);
          var y1 = priceToCoord(d.p1);
          var y2 = priceToCoord(d.p2);
          if (x1 != null && x2 != null && y1 != null && y2 != null) {
            var left = Math.min(x1, x2) - 8;
            var right = Math.max(x1, x2) + 8;
            var top = Math.min(y1, y2) - 8;
            var bottom = Math.max(y1, y2) + 8;
            if (x >= left && x <= right && y >= top && y <= bottom) {
              return d;
            }
          }
        } else if (d.type === 'fib') {
          var bounds = fibonacciBounds(d);
          if (bounds && x >= bounds.left - 8 && x <= bounds.right + 8 &&
              fibonacciLevels.some(function (ratio) {
                var levelY = priceToCoord(fibonacciPrice(d, ratio));
                return levelY != null && Math.abs(y - levelY) <= 8;
              })) {
            return d;
          }
        } else if (d.type === 'trendline') {
          var tx1 = timeToCoord(d.t1);
          var tx2 = timeToCoord(d.t2);
          var ty1 = priceToCoord(d.p1);
          var ty2 = priceToCoord(d.p2);
          if (tx1 != null && tx2 != null && ty1 != null && ty2 != null) {
            var dist = pointToSegmentDistance(x, y, tx1, ty1, tx2, ty2);
            if (dist <= 12) {
              return d;
            }
          }
        } else if ((d.type === 'brush' || Object.hasOwn(annotationAnchors, d.type)) && hitAnnotation(d, x, y)) {
          return d;
        }
      }
      return null;
    }

    function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
      var dx = x2 - x1;
      var dy = y2 - y1;
      var lenSq = dx * dx + dy * dy;
      if (lenSq < 0.001) {
        var ddx = px - x1;
        var ddy = py - y1;
        return Math.sqrt(ddx * ddx + ddy * ddy);
      }
      var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
      var projX = x1 + t * dx;
      var projY = y1 + t * dy;
      var distX = px - projX;
      var distY = py - projY;
      return Math.sqrt(distX * distX + distY * distY);
    }

    function canvasSize() {
      var canvas = canvasApi && canvasApi.getCanvas ? canvasApi.getCanvas() : null;
      var rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      return {
        width: (rect && rect.width) || (canvas && (canvas.clientWidth || canvas.width)) || 1000,
        height: (rect && rect.height) || (canvas && (canvas.clientHeight || canvas.height)) || 600
      };
    }

    function rangeGeometry(d, x1, y1, x2, y2) {
      var left = Math.min(x1, x2);
      var right = Math.max(x1, x2);
      var top = Math.min(y1, y2);
      var bottom = Math.max(y1, y2);
      var labels = [];
      if (d.type !== 'date_range') {
        var change = d.p2 - d.p1;
        var pct = d.p1 !== 0 ? ' (' + (100 * change / d.p1).toFixed(2) + '%)' : '';
        labels.push((change > 0 ? '+' : '') + change.toFixed(3) + pct);
      }
      if (d.type !== 'price_range') {
        labels.push(formatDuration(Math.abs(d.t2 - d.t1)) + ' · ' + countBarsBetween(d.t1, d.t2) + ' bars');
      }
      return {
        segments: [],
        boxes: [{ left: left, top: top, right: right, bottom: bottom }],
        labels: labels.map(function (label, index) {
          return { x: left + 4, y: top - 8 - 15 * (labels.length - 1 - index), text: label };
        })
      };
    }

    function regressionGeometry(d, result) {
      var candles = getCandles();
      var firstTime = Math.min(d.t1, d.t2);
      var lastTime = Math.max(d.t1, d.t2);
      var watermark = lastRevealedIndex(candles);
      var first = lowerBoundTime(candles, firstTime, watermark + 1);
      var count = 0;
      var sumY = 0;
      var sumXY = 0;
      var sumYY = 0;
      var last = first;
      for (var i = first; i <= watermark && candles[i].time <= lastTime; i += 1) {
        var close = candles[i].close;
        sumY += close;
        sumXY += count * close;
        sumYY += close * close;
        count += 1;
        last = i;
      }
      if (count < 2) return result;
      var meanX = (count - 1) / 2;
      var meanY = sumY / count;
      var varianceX = (count * count - 1) / 12;
      var covariance = sumXY / count - meanX * meanY;
      var slope = covariance / varianceX;
      var deviation = Math.sqrt(Math.max(0, sumYY / count - meanY * meanY - slope * covariance));
      var firstPrice = meanY - slope * meanX;
      var lastPrice = meanY + slope * meanX;
      var left = logicalCoord(first);
      var right = logicalCoord(last);
      if (left == null || right == null) return result;
      [-2, 0, 2].forEach(function (multiple) {
        var y1 = priceToCoord(firstPrice + multiple * deviation);
        var y2 = priceToCoord(lastPrice + multiple * deviation);
        if (y1 != null && y2 != null) result.segments.push([left, y1, right, y2]);
      });
      return result;
    }

    function projectRay(segments, x, y, dx, dy, width, height) {
      if (dx === 0 && dy === 0) return;
      var scaleX = dx ? ((dx > 0 ? width : 0) - x) / dx : Infinity;
      var scaleY = dy ? ((dy > 0 ? height : 0) - y) / dy : Infinity;
      var scale = Math.max(0, Math.min(scaleX, scaleY));
      segments.push([x, y, x + scale * dx, y + scale * dy]);
    }

    function riskRewardGeometry(d, x1, y1, x2, y2, x3, y3, width, result) {
      if (!validAnnotationAnchor(d, 3, d.t3, d.p3)) return result;
      var left = Math.min(x1, x2, x3);
      var right = Math.max(x1, x2, x3);
      if (right === left) right = Math.max(left + 40, Math.min(width, left + 80));
      result.boxes = [
        { left: left, top: Math.min(y1, y2), right: right, bottom: Math.max(y1, y2), color: '#f87171' },
        { left: left, top: Math.min(y1, y3), right: right, bottom: Math.max(y1, y3), color: '#34d399' }
      ];
      var ratio = Math.abs((d.p3 - d.p1) / (d.p2 - d.p1));
      result.labels = [{ x: left + 5, y: y1 - 8, text: ratio.toFixed(2) + ' R' }];
      return result;
    }

    function pointPathGeometry(points, numbered) {
      var result = { segments: [], labels: [] };
      var previous = null;
      points.forEach(function (point, index) {
        var x = timeToCoord(point[0]);
        var y = priceToCoord(point[1]);
        if (x == null || y == null) {
          previous = null;
          return;
        }
        if (previous) result.segments.push([previous[0], previous[1], x, y]);
        if (numbered && index > 0) result.labels.push({ x: x + 5, y: y - 8, text: '(' + index + ')' });
        previous = [x, y];
      });
      return result;
    }

    function annotationGeometry(d, width, height) {
      if (d.type === 'brush') return pointPathGeometry(d.points || [], false);
      if (d.type === 'elliott_wave') {
        var points = [];
        for (var i = 1; i <= annotationAnchors[d.type]; i += 1) points.push([d['t' + i], d['p' + i]]);
        return pointPathGeometry(points, true);
      }
      var x1 = timeToCoord(d.t1);
      if (x1 == null) return null;
      var result = { segments: [] };
      if (d.type === 'vline') {
        result.segments.push([x1, 0, x1, height]);
        return result;
      }
      var y1 = priceToCoord(d.p1);
      if (y1 == null) return null;
      if (d.type === 'text' || d.type === 'price_label') {
        var label = d.type === 'price_label' ? d.p1.toFixed(3) : d.text || 'Text';
        result.labels = [{ x: x1 + 6, y: y1, text: label }];
        return result;
      }
      if (d.type === 'horizontal_ray') {
        result.segments.push([x1, y1, Math.max(x1, width), y1]);
        return result;
      }

      var x2 = timeToCoord(d.t2);
      var y2 = priceToCoord(d.p2);
      if (x2 == null || y2 == null) return result;
      var dx = x2 - x1;
      var dy = y2 - y1;
      if (d.type === 'price_range' || d.type === 'date_range' || d.type === 'date_price_range') {
        return rangeGeometry(d, x1, y1, x2, y2);
      }
      if (d.type === 'regression_channel') return regressionGeometry(d, result);
      if (d.type === 'fib_time_zones') {
        fibonacciTimeZones.forEach(function (zone) {
          var x = x1 + dx * zone;
          if (x >= 0 && x <= width) result.segments.push([x, height, x, 16, String(zone)]);
        });
        return result;
      }
      if (d.type === 'fib_fan') {
        [0.382, 0.5, 0.618, 0.786].forEach(function (ratio) {
          var y = priceToCoord(d.p1 + (d.p2 - d.p1) * ratio);
          if (y != null) projectRay(result.segments, x1, y1, dx, y - y1, width, height);
        });
        return result;
      }
      if (d.type === 'ray') {
        var endX = dx > 0 ? width : 0;
        var endY = dy > 0 ? height : 0;
        var factor = dx === 0 ? (dy === 0 ? 1 : (endY - y1) / dy) : (endX - x1) / dx;
        factor = Math.max(1, factor);
        result.segments.push([x1, y1, x1 + dx * factor, y1 + dy * factor]);
        return result;
      }

      result.segments.push([x1, y1, x2, y2]);
      if (d.type === 'arrow') {
        var angle = Math.atan2(dy, dx);
        var head = Math.min(13, Math.hypot(dx, dy) / 2);
        [angle - Math.PI / 6, angle + Math.PI / 6].forEach(function (direction) {
          result.segments.push([x2, y2, x2 - head * Math.cos(direction), y2 - head * Math.sin(direction)]);
        });
        return result;
      }

      var x3 = timeToCoord(d.t3);
      var y3 = priceToCoord(d.p3);
      if (x3 == null || y3 == null) return result;
      if (d.type === 'risk_reward') {
        result.segments.length = 0;
        return riskRewardGeometry(d, x1, y1, x2, y2, x3, y3, width, result);
      }
      if (d.type === 'pitchfork') {
        var midX = (x2 + x3) / 2;
        var midY = (y2 + y3) / 2;
        var forkDx = midX - x1;
        var forkDy = midY - y1;
        result.segments = [[x2, y2, x3, y3], [x1, y1, midX, midY]];
        projectRay(result.segments, midX, midY, forkDx, forkDy, width, height);
        projectRay(result.segments, x2, y2, forkDx, forkDy, width, height);
        projectRay(result.segments, x3, y3, forkDx, forkDy, width, height);
      } else if (d.type === 'channel' && dx !== 0) {
        var offset = y3 - (y1 + dy * (x3 - x1) / dx);
        result.segments.push([x1, y1 + offset, x2, y2 + offset]);
        result.channel = [x1, y1, x2, y2, offset];
      } else if (d.type === 'fib-extension') {
        result.segments.push([x2, y2, x3, y3]);
        var right = Math.max(width - 4, x3);
        extensionLevels.forEach(function (ratio) {
          var price = d.p3 + (d.p2 - d.p1) * ratio;
          var y = priceToCoord(price);
          if (y == null) return;
          var label = Number((ratio * 100).toFixed(1)) + '%  ' + price.toFixed(3);
          result.segments.push([x3, y, right, y, label]);
        });
      }
      return result;
    }

    function hitAnnotation(d, x, y) {
      var size = canvasSize();
      var geometry = annotationGeometry(d, size.width, size.height);
      if (!geometry) return false;
      if ((geometry.labels || []).some(function (label) {
        return Math.abs(y - label.y) <= 10 && x >= label.x - 12 && x <= label.x + 8 * label.text.length + 5;
      })) return true;
      if ((geometry.boxes || []).some(function (box) {
        return x >= box.left - 8 && x <= box.right + 8 && y >= box.top - 8 && y <= box.bottom + 8;
      })) return true;
      if (geometry.channel) {
        var c = geometry.channel;
        if (x >= Math.min(c[0], c[2]) && x <= Math.max(c[0], c[2])) {
          var y1 = c[1] + (c[3] - c[1]) * (x - c[0]) / (c[2] - c[0]);
          if (y >= Math.min(y1, y1 + c[4]) && y <= Math.max(y1, y1 + c[4])) return true;
        }
      }
      return geometry.segments.some(function (segment) {
        return pointToSegmentDistance(x, y, segment[0], segment[1], segment[2], segment[3]) <= 12;
      });
    }

    function getAnchorHandles(d, width, height) {
      if (!d || !chartApi || d.hidden || d.locked) return [];
      var handles = [];

      if (d.type === 'hline') {
        var y = priceToCoord(d.price);
        if (y != null) {
          handles.push({ id: 'h_left', x: 40, y: y, cursor: 'ns-resize' });
          handles.push({ id: 'h_center', x: width / 2, y: y, cursor: 'ns-resize' });
          handles.push({ id: 'h_right', x: Math.max(80, width - 60), y: y, cursor: 'ns-resize' });
        }
      } else if (d.type === 'rect') {
        var rx1 = timeToCoord(d.t1);
        var rx2 = timeToCoord(d.t2);
        var ry1 = priceToCoord(d.p1);
        var ry2 = priceToCoord(d.p2);
        if (rx1 != null && rx2 != null && ry1 != null && ry2 != null) {
          var left = Math.min(rx1, rx2);
          var right = Math.max(rx1, rx2);
          var top = Math.min(ry1, ry2);
          var bottom = Math.max(ry1, ry2);
          var midX = (left + right) / 2;
          var midY = (top + bottom) / 2;

          handles.push({ id: 'tl', x: left, y: top, cursor: 'nwse-resize' });
          handles.push({ id: 'tr', x: right, y: top, cursor: 'nesw-resize' });
          handles.push({ id: 'br', x: right, y: bottom, cursor: 'nwse-resize' });
          handles.push({ id: 'bl', x: left, y: bottom, cursor: 'nesw-resize' });
          handles.push({ id: 'tc', x: midX, y: top, cursor: 'ns-resize' });
          handles.push({ id: 'bc', x: midX, y: bottom, cursor: 'ns-resize' });
          handles.push({ id: 'ml', x: left, y: midY, cursor: 'ew-resize' });
          handles.push({ id: 'mr', x: right, y: midY, cursor: 'ew-resize' });
        }
      } else if (d.type === 'trendline' || d.type === 'fib') {
        var tx1 = timeToCoord(d.t1);
        var tx2 = timeToCoord(d.t2);
        var ty1 = priceToCoord(d.p1);
        var ty2 = priceToCoord(d.p2);
        if (tx1 != null && tx2 != null && ty1 != null && ty2 != null) {
          handles.push({ id: 'p1', x: tx1, y: ty1, cursor: 'crosshair' });
          handles.push({ id: 'p2', x: tx2, y: ty2, cursor: 'crosshair' });
        }
      } else if (Object.hasOwn(annotationAnchors, d.type)) {
        for (var anchor = 1; anchor <= annotationAnchors[d.type]; anchor += 1) {
          var ax = timeToCoord(d['t' + anchor]);
          var ay = d.type === 'vline' ? height / 2 : priceToCoord(d['p' + anchor]);
          if (ax != null && ay != null) {
            handles.push({ id: 'p' + anchor, x: ax, y: ay, cursor: 'crosshair' });
          }
        }
      }

      return handles;
    }

    function findHandleAt(handles, x, y) {
      var best = null;
      var minDist = 20;
      for (var i = 0; i < handles.length; i += 1) {
        var h = handles[i];
        var dx = x - h.x;
        var dy = y - h.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= minDist) {
          minDist = dist;
          best = h;
        }
      }
      return best;
    }

    function handleSelectionPointer(type, x, y, time, price, snapped) {
      var item = getDrawingById(selectedId);
      if (!item) {
        deselect();
        return;
      }

      var size = canvasSize();
      var handles = getAnchorHandles(item, size.width, size.height);

      if (type === 'pointermove') {
        if (dragState) {
          handleDragMove(dragState, x, y, snapped ? snapped.time : time, snapped ? snapped.price : price);
          canvasApi.requestRedraw();
        } else {
          var hoveredHandle = findHandleAt(handles, x, y);
          if (hoveredHandle) {
            canvasApi.setCursor(hoveredHandle.cursor);
          } else {
            var hit = findDrawingAt(x, y);
            if (hit && hit.id === selectedId) {
              canvasApi.setCursor(item.locked ? 'default' : 'move');
            } else {
              canvasApi.setCursor('default');
            }
          }
        }
      } else if (type === 'pointerdown') {
        var clickedHandle = findHandleAt(handles, x, y);
        if (clickedHandle) {
          dragState = {
            mode: 'handle',
            handleId: clickedHandle.id,
            item: item,
            startX: x,
            startY: y,
            startTime: time,
            startEdge: resolveEdgeTime(time, x),
            startPrice: price != null ? price : coordinateToPrice(y),
            orig: clone(item)
          };
          return;
        }

        var clickedDrawing = findDrawingAt(x, y);
        if (clickedDrawing && clickedDrawing.id === selectedId) {
          if (item.locked) return;
          dragState = {
            mode: 'move',
            item: item,
            startX: x,
            startY: y,
            startTime: time,
            startEdge: item.type === 'brush' ? brushTime(x, time) : (snapped ? snapped.time : resolveEdgeTime(time, x)),
            startPrice: snapped ? snapped.price : (price != null ? price : coordinateToPrice(y)),
            orig: clone(item)
          };
          return;
        }

        if (clickedDrawing && clickedDrawing.id !== selectedId) {
          selectDrawing(clickedDrawing.id);
          return;
        }

        // Click on empty space: deselect
        deselect();
      } else if (type === 'pointerup' || type === 'pointercancel') {
        if (dragState) {
          var original = dragState.orig;
          dragState = null;
          if (type === 'pointercancel') Object.assign(item, original);
          canvasApi.requestRedraw();
          if (JSON.stringify(item) !== JSON.stringify(original)) onChange(item);
        }
      }
    }

    function handleDragMove(state, x, y, time, price) {
      var item = state.item;
      var orig = state.orig;
      if (!item || !orig) return;

      // In the whitespace past the newest bar the payload carries no time, so
      // resolve the pointer column ourselves (extrapolating forward when it is
      // beyond the last revealed bar). Without this a right-edge handle could
      // never be dragged further right than the current candle.
      var effTime = item.type === 'brush' ? brushTime(x, time) : resolveEdgeTime(time, x);
      var effPrice = price;
      if (effPrice == null && chartApi && chartApi.coordinateToPrice && y != null) {
        try {
          effPrice = chartApi.coordinateToPrice(y);
        } catch {
          effPrice = null;
        }
      }

      var dt = (effTime != null && state.startEdge != null) ? (effTime - state.startEdge) : 0;
      var dp = (effPrice != null && state.startPrice != null) ? (effPrice - state.startPrice) : 0;

      if (state.mode === 'move') {
        if (item.type === 'hline') {
          if (effPrice != null && !isNaN(effPrice)) {
            item.price = Number((orig.price + dp).toFixed(3));
          }
        } else if (item.type === 'brush') {
          item.points = orig.points.map(function (point) {
            return [point[0] + dt, Number((point[1] + dp).toFixed(3))];
          });
        } else {
          var count = annotationAnchors[item.type] || 2;
          for (var anchor = 1; anchor <= count; anchor += 1) {
            if (Number.isFinite(orig['t' + anchor])) item['t' + anchor] = orig['t' + anchor] + dt;
            if (Number.isFinite(orig['p' + anchor])) item['p' + anchor] = Number((orig['p' + anchor] + dp).toFixed(3));
          }
        }
      } else if (state.mode === 'handle') {
        var hId = state.handleId;
        if (item.type === 'hline') {
          if (effPrice != null && !isNaN(effPrice)) {
            item.price = Number(effPrice.toFixed(3));
          }
        } else if (item.type === 'trendline' || item.type === 'fib' || Object.hasOwn(annotationAnchors, item.type)) {
          var handleAnchor = Number(hId.slice(1));
          var handleTime = effTime == null ? item['t' + handleAnchor] : effTime;
          var handlePrice = Number.isFinite(effPrice) ? Number(effPrice.toFixed(3)) : item[hId];
          if (item.type === 'channel' && !validAnnotationAnchor(item, handleAnchor, handleTime, handlePrice)) {
            handleTime = item['t' + handleAnchor];
          }
          if (validAnnotationAnchor(item, handleAnchor, handleTime, handlePrice)) {
            setAnnotationAnchor(item, handleAnchor, handleTime, handlePrice);
          }
        } else if (item.type === 'rect') {
          if (hId === 'tl') {
            if (effTime != null) item.t1 = effTime;
            if (effPrice != null && !isNaN(effPrice)) item.p1 = Number(effPrice.toFixed(3));
          } else if (hId === 'tr') {
            if (effTime != null) item.t2 = effTime;
            if (effPrice != null && !isNaN(effPrice)) item.p1 = Number(effPrice.toFixed(3));
          } else if (hId === 'br') {
            if (effTime != null) item.t2 = effTime;
            if (effPrice != null && !isNaN(effPrice)) item.p2 = Number(effPrice.toFixed(3));
          } else if (hId === 'bl') {
            if (effTime != null) item.t1 = effTime;
            if (effPrice != null && !isNaN(effPrice)) item.p2 = Number(effPrice.toFixed(3));
          } else if (hId === 'tc') {
            if (effPrice != null && !isNaN(effPrice)) item.p1 = Number(effPrice.toFixed(3));
          } else if (hId === 'bc') {
            if (effPrice != null && !isNaN(effPrice)) item.p2 = Number(effPrice.toFixed(3));
          } else if (hId === 'ml') {
            if (effTime != null) item.t1 = effTime;
          } else if (hId === 'mr') {
            if (effTime != null) item.t2 = effTime;
          }
        }
      }
    }

    function handleChartClick(param) {
      if (isDestroyed || !canvasApi) return;
      var tool = canvasApi.getActiveTool();
      if (tool !== 'cursor') return;

      if (!param || !param.point) {
        deselect();
        return;
      }

      var x = param.point.x;
      var y = param.point.y;
      var hit = findDrawingAt(x, y);
      if (hit) {
        selectDrawing(hit.id);
      } else {
        deselect();
      }
    }

    if (chartApi && chartApi.subscribeClick) {
      chartApi.subscribeClick(handleChartClick);
    }

    // ------------------------------------------------------------- rendering

    function render(ctx, helpers) {
      if (isDestroyed) return;
      var width = helpers.width;
      var height = helpers.height;
      var currentTool = helpers.tool;

      // 1. Render all committed drawings
      for (var i = 0; i < drawings.length; i += 1) {
        var d = drawings[i];
        if (d.hidden) continue;
        var isSelected = (d.id === selectedId);
        if (d.type === 'fib') {
          renderFibonacci(ctx, d, width, height, isSelected);
        } else if (d.type === 'hline') {
          renderHLine(ctx, d, width, height, isSelected);
        } else if (d.type === 'rect') {
          renderRect(ctx, d, width, height, isSelected);
        } else if (d.type === 'trendline') {
          renderTrendline(ctx, d, width, height, isSelected);
        } else if (d.type === 'brush' || Object.hasOwn(annotationAnchors, d.type)) {
          renderAnnotation(ctx, d, width, height, isSelected);
        }
      }

      // 2. Render rubber-band preview if in drawing state
      if (draft) {
        if (draft.type === 'fib') {
          renderFibonacci(ctx, draft);
        } else if (draft.type === 'rect') {
          renderRectDraft(ctx, draft, width, height);
        } else if (draft.type === 'trendline') {
          renderTrendlineDraft(ctx, draft, width, height);
        } else if (draft.type === 'brush' || Object.hasOwn(annotationAnchors, draft.type)) {
          renderAnnotation(ctx, draft, width, height, false);
        }
      } else if (currentTool === 'hline' && hoverPos) {
        renderHLinePreview(ctx, hoverPos, width, height);
      }

      // 3. Render transient ruler if active
      if (rulerState) {
        renderRuler(ctx, rulerState, width, height);
      }
    }

    function applyLineStyle(ctx, d, color, width) {
      ctx.strokeStyle = d.color || color;
      ctx.lineWidth = d.lineWidth || width;
      ctx.setLineDash(d.lineStyle === 'dashed' ? [5, 4] : (d.lineStyle === 'dotted' ? [1, 3] : []));
    }

    function renderAnnotation(ctx, d, width, height, isSelected) {
      var geometry = annotationGeometry(d, width, height);
      if (!geometry) return;
      var color = d.type === 'fib-extension' ? '#a78bfa' : '#38bdf8';
      ctx.save();
      applyLineStyle(ctx, d, color, 1.5);
      if (d === draft) ctx.setLineDash([4, 3]);
      ctx.fillStyle = ctx.strokeStyle;
      (geometry.boxes || []).forEach(function (box) {
        ctx.save();
        ctx.fillStyle = box.color || ctx.strokeStyle;
        ctx.globalAlpha *= 0.16;
        ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        ctx.restore();
        ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
      });
      if (geometry.channel) {
        var c = geometry.channel;
        var alpha = ctx.globalAlpha;
        ctx.globalAlpha = alpha * 0.12;
        ctx.beginPath();
        ctx.moveTo(c[0], c[1]);
        ctx.lineTo(c[2], c[3]);
        ctx.lineTo(c[2], c[3] + c[4]);
        ctx.lineTo(c[0], c[1] + c[4]);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = alpha;
      }
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      ctx.beginPath();
      var previous = null;
      geometry.segments.forEach(function (segment) {
        if (!previous || previous[2] !== segment[0] || previous[3] !== segment[1]) {
          ctx.moveTo(segment[0], segment[1]);
        }
        ctx.lineTo(segment[2], segment[3]);
        if (segment[4]) ctx.fillText(segment[4], segment[2] - 4, segment[3] - 4);
        previous = segment;
      });
      ctx.stroke();
      ctx.font = '13px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      (geometry.labels || []).forEach(function (label) {
        ctx.fillText(label.text, label.x, label.y);
      });
      ctx.restore();
      if (isSelected || d === draft) {
        getAnchorHandles(d, width, height).forEach(function (handle) {
          drawAnchorHandle(ctx, handle.x, handle.y);
        });
      }
    }

    function drawAnchorHandle(ctx, x, y) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // ------------------------------------------------------------- HLine render

    function renderHLine(ctx, d, width, height, isSelected) {
      if (!chartApi || typeof chartApi.priceToCoordinate !== 'function') return;
      var y = chartApi.priceToCoordinate(d.price);
      if (y == null || isNaN(y) || y < -20 || y > height + 20) return;

      var yPixel = Math.round(y) + 0.5;

      ctx.save();
      applyLineStyle(ctx, d, '#38bdf8', 1.5);

      ctx.beginPath();
      ctx.moveTo(0, yPixel);
      ctx.lineTo(width, yPixel);
      ctx.stroke();

      // Right-edge price pill tag
      var priceText = typeof d.price === 'number' ? d.price.toFixed(3) : String(d.price);
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace';
      var textMetrics = ctx.measureText(priceText);
      var pillWidth = textMetrics.width + 12;
      var pillHeight = 18;
      var pillX = Math.max(0, width - pillWidth - 4);
      var pillY = Math.round(y - pillHeight / 2);

      ctx.fillStyle = '#0b0f17';
      ctx.fillRect(pillX, pillY, pillWidth, pillHeight);
      ctx.strokeStyle = d.color || '#38bdf8';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(pillX, pillY, pillWidth, pillHeight);

      ctx.fillStyle = d.color || '#38bdf8';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(priceText, pillX + 6, pillY + pillHeight / 2);

      ctx.restore();

      if (isSelected) {
        var handles = getAnchorHandles(d, width, height);
        for (var h = 0; h < handles.length; h += 1) {
          drawAnchorHandle(ctx, handles[h].x, handles[h].y);
        }
      }
    }

    function renderHLinePreview(ctx, hover, width, _height) {
      if (!hover || hover.y == null) return;
      var yPixel = Math.round(hover.y) + 0.5;

      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.moveTo(0, yPixel);
      ctx.lineTo(width, yPixel);
      ctx.stroke();

      if (hover.price != null && !isNaN(hover.price)) {
        var priceText = hover.price.toFixed(3);
        ctx.font = '10px -apple-system, BlinkMacSystemFont, monospace';
        var pillWidth = ctx.measureText(priceText).width + 10;
        var pillHeight = 16;
        var pillX = Math.max(0, width - pillWidth - 4);
        var pillY = Math.round(hover.y - pillHeight / 2);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(pillX, pillY, pillWidth, pillHeight);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(pillX, pillY, pillWidth, pillHeight);

        ctx.fillStyle = '#38bdf8';
        ctx.textBaseline = 'middle';
        ctx.fillText(priceText, pillX + 5, pillY + pillHeight / 2);
      }

      ctx.restore();
    }

    // ------------------------------------------------------------- Rect render

    function renderRect(ctx, d, width, height, isSelected) {
      var x1 = timeToCoord(d.t1);
      var x2 = timeToCoord(d.t2);
      var y1 = priceToCoord(d.p1);
      var y2 = priceToCoord(d.p2);

      if (x1 == null || x2 == null || y1 == null || y2 == null) return;

      var left = Math.min(x1, x2);
      var right = Math.max(x1, x2);
      var top = Math.min(y1, y2);
      var bottom = Math.max(y1, y2);
      var boxW = right - left;
      var boxH = bottom - top;

      if (right < 0 || left > width || bottom < 0 || top > height) return;

      ctx.save();
      ctx.fillStyle = d.fillColor || 'rgba(56, 189, 248, 0.15)';
      ctx.fillRect(left, top, boxW, boxH);
      applyLineStyle(ctx, d, '#38bdf8', 1.5);
      ctx.strokeRect(left, top, boxW, boxH);

      if (d.label && boxW > 35 && boxH > 14) {
        ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.textBaseline = 'top';
        ctx.fillText(d.label, left + 4, top + 3);
      }

      ctx.restore();

      if (isSelected) {
        var handles = getAnchorHandles(d, width, height);
        for (var h = 0; h < handles.length; h += 1) {
          drawAnchorHandle(ctx, handles[h].x, handles[h].y);
        }
      }
    }

    function renderRectDraft(ctx, d, _width, _height) {
      var x1 = timeToCoord(d.t1);
      if (x1 == null) x1 = d.x1;
      var y1 = priceToCoord(d.p1);
      if (y1 == null) y1 = d.y1;
      var x2 = d.x2;
      var y2 = d.y2;

      var left = Math.min(x1, x2);
      var right = Math.max(x1, x2);
      var top = Math.min(y1, y2);
      var bottom = Math.max(y1, y2);
      var boxW = right - left;
      var boxH = bottom - top;

      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.fillRect(left, top, boxW, boxH);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(left, top, boxW, boxH);
      ctx.restore();
    }

    // ------------------------------------------------------------- Trendline render

    function fibonacciPrice(d, ratio) {
      return d.p2 + (d.p1 - d.p2) * ratio;
    }

    function fibonacciBounds(d) {
      var x1 = timeToCoord(d.t1);
      var x2 = d === draft ? d.x2 : timeToCoord(d.t2);
      if (x1 == null && d === draft) x1 = d.x1;
      if (x1 == null || x2 == null) return null;
      return { left: Math.min(x1, x2), right: Math.max(x1, x2) };
    }

    function renderFibonacci(ctx, d, width, height, isSelected) {
      var bounds = fibonacciBounds(d);
      if (!bounds || (d === draft && d.p1 === d.p2)) return;
      ctx.save();
      applyLineStyle(ctx, d, '#a78bfa', 1);
      ctx.fillStyle = d.color === '#a78bfa' || !d.color ? '#c4b5fd' : d.color;
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      if (d === draft) ctx.setLineDash([4, 3]);

      var levels = d.p1 === d.p2 ? [0] : fibonacciLevels;
      levels.forEach(function (ratio) {
        var price = fibonacciPrice(d, ratio);
        var y = priceToCoord(price);
        if (y == null) return;
        ctx.beginPath();
        ctx.moveTo(bounds.left, y);
        ctx.lineTo(bounds.right, y);
        ctx.stroke();
        var percent = Number((ratio * 100).toFixed(1));
        ctx.fillText(percent + '%  ' + price.toFixed(3), bounds.right - 4, y - 4);
      });
      ctx.restore();

      if (isSelected) {
        getAnchorHandles(d, width, height).forEach(function (handle) {
          drawAnchorHandle(ctx, handle.x, handle.y);
        });
      }
    }

    function renderTrendline(ctx, d, width, height, isSelected) {
      var x1 = timeToCoord(d.t1);
      var x2 = timeToCoord(d.t2);
      var y1 = priceToCoord(d.p1);
      var y2 = priceToCoord(d.p2);

      if (x1 == null || x2 == null || y1 == null || y2 == null) return;

      ctx.save();
      applyLineStyle(ctx, d, '#38bdf8', 1.5);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Trendline stats badge
      if (d.showStats !== false) {
        var dx = x2 - x1;
        var dy = -(y2 - y1); // screen Y is inverted
        var angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
        var priceDiff = (d.p2 != null && d.p1 != null) ? (d.p2 - d.p1) : 0;
        var pips = priceDiff / 0.10; // XAUUSD: 1 pip = $0.10
        var sign = priceDiff >= 0 ? '+' : '';
        var statsText = angle + '° · ' + sign + priceDiff.toFixed(2) + ' (' + sign + pips.toFixed(1) + ' pips)';

        var midX = (x1 + x2) / 2;
        var midY = (y1 + y2) / 2;

        ctx.font = '9px -apple-system, BlinkMacSystemFont, monospace';
        var textW = ctx.measureText(statsText).width + 8;
        var badgeX = Math.max(4, Math.min(width - textW - 4, midX - textW / 2));
        var badgeY = Math.max(4, Math.min(height - 18, midY - 14));

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(badgeX, badgeY, textW, 14);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(badgeX, badgeY, textW, 14);

        ctx.fillStyle = '#38bdf8';
        ctx.textBaseline = 'middle';
        ctx.fillText(statsText, badgeX + 4, badgeY + 7);
      }

      ctx.restore();

      if (isSelected) {
        var handles = getAnchorHandles(d, width, height);
        for (var h = 0; h < handles.length; h += 1) {
          drawAnchorHandle(ctx, handles[h].x, handles[h].y);
        }
      }
    }

    function renderTrendlineDraft(ctx, d, _width, _height) {
      var x1 = timeToCoord(d.t1);
      if (x1 == null) x1 = d.x1;
      var y1 = priceToCoord(d.p1);
      if (y1 == null) y1 = d.y1;
      var x2 = d.x2;
      var y2 = d.y2;

      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      var dx = x2 - x1;
      var dy = -(y2 - y1);
      var angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
      var text = angle + '°';

      ctx.font = '10px -apple-system, BlinkMacSystemFont, monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(text, x2 + 8, y2 + 4);

      ctx.restore();
    }

    // ------------------------------------------------------------- Ruler render

    function countBarsBetween(t1, t2) {
      var candles = getCandles();
      if (Array.isArray(candles) && candles.length > 0) {
        var startT = Math.min(t1, t2);
        var endT = Math.max(t1, t2);
        var count = 0;
        var endIndex = lastRevealedIndex(candles);
        for (var i = 0; i <= endIndex && candles[i].time <= endT; i += 1) {
          var ct = candles[i].time;
          if (ct >= startT) count += 1;
        }
        return Math.max(1, count);
      }
      var dt = Math.abs(t2 - t1);
      return Math.max(1, Math.round(dt / 300));
    }

    function renderRuler(ctx, r, width, _height) {
      var x1 = timeToCoord(r.t1);
      if (x1 == null) x1 = r.x1;
      var y1 = priceToCoord(r.p1);
      if (y1 == null) y1 = r.y1;
      var x2 = timeToCoord(r.t2);
      if (x2 == null) x2 = r.x2;
      var y2 = priceToCoord(r.p2);
      if (y2 == null) y2 = r.y2;

      var left = Math.min(x1, x2);
      var right = Math.max(x1, x2);
      var top = Math.min(y1, y2);
      var bottom = Math.max(y1, y2);
      var boxW = right - left;
      var boxH = bottom - top;

      ctx.save();

      // Translucent shaded corridor
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.fillRect(left, top, boxW, boxH);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(left, top, boxW, boxH);

      // Diagonal line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Measurement card
      var priceDiff = (r.p2 != null && r.p1 != null) ? (r.p2 - r.p1) : 0;
      var pips = priceDiff / 0.10;
      var sign = priceDiff >= 0 ? '+' : '';
      var pct = (r.p1 && r.p1 !== 0) ? ((priceDiff / r.p1) * 100) : 0;
      var bars = countBarsBetween(r.t1, r.t2);
      var durationStr = formatDuration(Math.abs(r.t2 - r.t1));
      var dollarMove = priceDiff * 0.10 * 100; // 0.10 lot standard XAUUSD

      var line1 = sign + priceDiff.toFixed(2) + ' (' + sign + pips.toFixed(1) + ' pips) · ' + sign + pct.toFixed(2) + '%';
      var line2 = bars + ' bars (' + durationStr + ') · ' + sign + '$' + dollarMove.toFixed(2) + ' (0.10 lot)';

      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      var w1 = ctx.measureText(line1).width;
      var w2 = ctx.measureText(line2).width;
      var cardW = Math.max(w1, w2) + 16;
      var cardH = 34;

      var cardX = Math.max(4, Math.min(width - cardW - 4, (left + right) / 2 - cardW / 2));
      var cardY = Math.max(4, top - cardH - 6);
      if (cardY < 4) cardY = bottom + 6;

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(cardX, cardY, cardW, cardH);

      ctx.fillStyle = priceDiff >= 0 ? '#4ade80' : '#f87171';
      ctx.textBaseline = 'top';
      ctx.fillText(line1, cardX + 8, cardY + 5);

      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(line2, cardX + 8, cardY + 19);

      ctx.restore();
    }

    // ------------------------------------------------------------- bind

    if (canvasApi) {
      canvasApi.registerRenderer(render);
      canvasApi.onPointer(handlePointer);
    }

    function destroy() {
      isDestroyed = true;
      if (canvasApi) {
        canvasApi.unregisterRenderer(render);
      }
      drawings = [];
      draft = null;
      rulerState = null;
      hoverPos = null;
      dragState = null;
      deselect();
    }

    return {
      getDrawings: getDrawings,
      getDrawingById: getDrawingById,
      addDrawing: addDrawing,
      updateDrawing: updateDrawing,
      duplicateDrawing: duplicateDrawing,
      setSnapEnabled: function (enabled) { snapEnabled = Boolean(enabled); },
      removeDrawing: removeDrawing,
      clearDrawings: clearDrawings,
      setDrawings: setDrawings,
      getSelectedId: getSelectedId,
      selectDrawing: selectDrawing,
      deselect: deselect,
      deleteSelected: deleteSelected,
      findDrawingAt: findDrawingAt,
      getAnchorHandles: getAnchorHandles,
      handlePointer: handlePointer,
      handleChartClick: handleChartClick,
      render: render,
      destroy: destroy
    };
  }

  global.SmcReplayDrawings = {
    init: init,
    nextId: nextId
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.SmcReplayDrawings;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
