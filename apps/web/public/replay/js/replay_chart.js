/**
 * Replay chart renderer for TradingView Lightweight Charts.
 *
 * Renders revealed XAUUSD prices with 3-decimal precision and optional indicators.
 * Viewport interaction:
 *  - When PLAYING: pins right edge to active bar (follow mode).
 *  - Zooming (barSpacing) does not break follow mode.
 *  - Panning to the past releases follow mode and notifies the replay controller.
 *  - When PAUSED: user has free pan/zoom without forced movement.
 *  - Step forward/backward steps viewport precisely by one bar when following.
 */
(function (global) {
  'use strict';

  var THEME = {
    background: '#080f14',
    text: '#91a7ae',
    grid: 'rgba(41, 64, 74, 0.55)',
    border: '#29404a',
    up: '#45e0ad',
    down: '#ff7180',
    crosshair: '#83bdff'
  };

  var DEFAULT_VISIBLE_BARS = 120;
  var RIGHT_OFFSET = 6;
  var MAX_INCREMENTAL_STEPS = 8;
  var INDICATOR_AXIS_WIDTH = 88;
  var INDICATOR_SIZES = { small: 1, default: 2, large: 3 };
  var INDICATORS = {
    sma: { series: [{ name: 'SMA', color: '#fbbf24' }] },
    ema: { series: [{ name: 'EMA', color: '#38bdf8' }] },
    supertrend: {
      series: [{ name: 'Supertrend Up', color: THEME.up }, { name: 'Supertrend Down', color: THEME.down }],
      // v4 line series join across whitespace, so mark only the active trend points.
      style: { lineVisible: false, pointMarkersVisible: true }
    },
    rsi: { independentScale: true, series: [{ name: 'RSI', color: '#c084fc' }] },
    macd: {
      independentScale: true,
      series: [
        { name: 'MACD', color: '#38bdf8' },
        { name: 'MACD Signal', color: '#fbbf24' },
        { name: 'MACD Histogram', color: '#8b5cf6', histogram: true }
      ]
    },
    bollinger: {
      series: [
        { name: 'Bollinger Middle', color: '#a78bfa' },
        { name: 'Bollinger Upper', color: '#818cf8', lineStyle: 2 },
        { name: 'Bollinger Lower', color: '#818cf8', lineStyle: 2 }
      ]
    },
    vwap: { series: [{ name: 'VWAP', color: '#f472b6' }] },
    atr: { independentScale: true, series: [{ name: 'ATR', color: '#fb923c' }] },
    volume: { independentScale: true, volume: true, series: [{ name: 'Volume', color: THEME.up, histogram: true }] },
    stochastic: {
      independentScale: true,
      series: [{ name: 'Stochastic %K', color: '#38bdf8' }, { name: '%D', color: '#fbbf24' }]
    },
    adx: {
      independentScale: true,
      series: [{ name: 'ADX', color: '#c084fc' }, { name: '+DI', color: THEME.up }, { name: '−DI', color: THEME.down }]
    },
    donchian: {
      series: [
        { name: 'Donchian Middle', color: '#fbbf24' },
        { name: 'Donchian Upper', color: '#38bdf8' },
        { name: 'Donchian Lower', color: '#38bdf8' }
      ]
    },
    ichimoku: {
      series: [
        { name: 'Tenkan', color: '#38bdf8' },
        { name: 'Kijun', color: '#fb923c' },
        { name: 'Senkou A', color: THEME.up },
        { name: 'Senkou B', color: THEME.down },
        { name: 'Chikou', color: '#c084fc' }
      ]
    },
    obv: { independentScale: true, volume: true, series: [{ name: 'OBV', color: '#38bdf8' }] }
  };

  function toBar(candle) {
    return {
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    };
  }

  var SERIES_METHODS = {
    candles: 'addCandlestickSeries',
    heikin: 'addCandlestickSeries',
    bars: 'addBarSeries',
    line: 'addLineSeries',
    area: 'addAreaSeries'
  };

  function addPriceSeries(chart, type) {
    var options = {
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      priceLineVisible: false,
      lastValueVisible: true
    };
    if (type === 'line') Object.assign(options, { color: THEME.up, lineWidth: 2 });
    else if (type === 'area') Object.assign(options, {
      lineColor: THEME.up, topColor: 'rgba(69, 224, 173, 0.30)', bottomColor: 'rgba(69, 224, 173, 0.02)', lineWidth: 2
    });
    else Object.assign(options, {
      upColor: THEME.up, downColor: THEME.down, borderUpColor: THEME.up,
      borderDownColor: THEME.down, wickUpColor: THEME.up, wickDownColor: THEME.down
    });
    return chart[SERIES_METHODS[type]](options);
  }

  function formatPrice(value) {
    return typeof value === 'number' && isFinite(value) ? value.toFixed(3) : '—';
  }

  function createChart(container, lib, passive) {
    return lib.createChart(container, {
      layout: {
        background: { type: 'solid', color: THEME.background },
        textColor: THEME.text,
        fontFamily: 'Outfit, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        attributionLogo: false
      },
      grid: {
        vertLines: { color: THEME.grid },
        horzLines: { color: THEME.grid }
      },
      rightPriceScale: {
        borderColor: THEME.border,
        minimumWidth: passive ? INDICATOR_AXIS_WIDTH : 0,
        scaleMargins: { top: 0.1, bottom: 0.1 }
      },
      timeScale: {
        visible: !passive,
        borderColor: THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: RIGHT_OFFSET,
        barSpacing: 7,
        shiftVisibleRangeOnNewBar: false
      },
      crosshair: {
        mode: lib.CrosshairMode ? lib.CrosshairMode.Normal : 0,
        vertLine: { visible: !passive, color: THEME.crosshair, width: 1, style: 3, labelBackgroundColor: '#1d4ed8' },
        horzLine: { visible: !passive, color: THEME.crosshair, width: 1, style: 3, labelBackgroundColor: '#1d4ed8' }
      },
      localization: { priceFormatter: formatPrice },
      handleScale: !passive && { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: !passive && { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }
    });
  }

  function fitContainer(chart, container) {
    var width = container.clientWidth || container.offsetWidth || 0;
    var height = container.clientHeight || container.offsetHeight || 0;
    if (width > 0 && height > 0) chart.applyOptions({ width: width, height: height });
  }

  function createIndicatorLegend(host, specs, size) {
    if (!host) return null;
    var doc = host.ownerDocument;
    var row = doc.createElement('div');
    row.className = 'replay-indicator-values';
    row.dataset.size = size;
    var detail = doc.createElement('span');
    var values = specs.map(function (spec, index) {
      var reading = doc.createElement('span');
      var name = doc.createElement('span');
      var value = doc.createElement('span');
      reading.className = 'replay-indicator-reading';
      reading.style.color = spec.color;
      name.className = 'replay-indicator-name';
      name.textContent = spec.name;
      if (index === 0) name.appendChild(detail);
      value.className = 'replay-indicator-value';
      value.textContent = formatPrice();
      reading.appendChild(name);
      reading.appendChild(value);
      row.appendChild(reading);
      return value;
    });
    host.appendChild(row);
    return { row: row, values: values, detail: detail };
  }

  function createIndicatorPane(host, size, lib, sync) {
    var doc = host.ownerDocument;
    var section = doc.createElement('section');
    var heading = doc.createElement('header');
    var container = doc.createElement('div');
    section.className = 'replay-indicator-pane';
    section.dataset.size = size;
    heading.className = 'replay-indicator-pane-title';
    container.className = 'replay-indicator-pane-chart';
    section.appendChild(heading);
    section.appendChild(container);
    host.appendChild(section);
    var chart = createChart(container, lib, true);
    // A hidden series keeps the logical range anchored even when indicators are warming up.
    var anchor = chart.addLineSeries({ visible: false, priceScaleId: 'indicator-time' });
    function resize() {
      fitContainer(chart, container);
      sync();
    }
    var observer = global.ResizeObserver ? new global.ResizeObserver(resize) : null;
    if (observer) observer.observe(container);
    else global.addEventListener('resize', resize);
    fitContainer(chart, container);
    return {
      chart: chart,
      anchor: anchor,
      section: section,
      heading: heading,
      resize: resize,
      remove: function () {
        if (observer) observer.disconnect();
        else global.removeEventListener('resize', resize);
        chart.remove();
        section.remove();
      }
    };
  }

  function createIchimokuCloud(chart, series) {
    var spanA;
    var spanB;
    var target = -1;
    var shift = 0;
    var timeScale = chart.timeScale();

    function cloudPoint(index) {
      var a = spanA[index - shift].value;
      var b = spanB[index - shift].value;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      var x = timeScale.logicalToCoordinate(index);
      var upper = series.priceToCoordinate(a);
      var lower = series.priceToCoordinate(b);
      return !Number.isFinite(x) || !Number.isFinite(upper) || !Number.isFinite(lower)
        ? null : { x: x, a: upper, b: lower, bullish: a >= b };
    }

    function draw(targetCanvas) {
      if (target <= shift) return;
      var range = timeScale.getVisibleLogicalRange();
      if (!range) return;
      var start = Math.max(shift, Math.floor(range.from));
      var end = Math.min(target, Math.ceil(range.to));
      var bullish = [];
      var bearish = [];
      var previous = null;
      for (var index = start; index <= end; index += 1) {
        var current = cloudPoint(index);
        if (previous && current) {
          var segments = previous.bullish ? bullish : bearish;
          if (previous.bullish === current.bullish) {
            segments.push([previous, current]);
          } else {
            var firstGap = previous.b - previous.a;
            var lastGap = current.b - current.a;
            if (firstGap !== lastGap) {
              var fraction = firstGap / (firstGap - lastGap);
              var x = previous.x + fraction * (current.x - previous.x);
              var y = previous.a + fraction * (current.a - previous.a);
              var crossing = { x: x, a: y, b: y };
              segments.push([previous, crossing]);
              (current.bullish ? bullish : bearish).push([crossing, current]);
            }
          }
        }
        previous = current;
      }
      targetCanvas.useMediaCoordinateSpace(function (scope) {
        var context = scope.context;
        [bullish, bearish].forEach(function (segments, index) {
          if (!segments.length) return;
          context.fillStyle = index ? 'rgba(255, 113, 128, .18)' : 'rgba(69, 224, 173, .18)';
          context.beginPath();
          segments.forEach(function (segment) {
            var from = segment[0];
            var to = segment[1];
            context.moveTo(from.x, from.a);
            context.lineTo(to.x, to.a);
            context.lineTo(to.x, to.b);
            context.lineTo(from.x, from.b);
            context.closePath();
          });
          context.fill();
        });
      });
    }

    var view = {
      zOrder: function () { return 'bottom'; },
      renderer: function () { return renderer; }
    };
    var renderer = { draw: draw };
    return {
      paneViews: function () { return [view]; },
      setData: function (data, lastRevealed, displacement) {
        spanA = data && data[2];
        spanB = data && data[3];
        target = lastRevealed;
        shift = displacement;
      }
    };
  }

  function init(options) {
    options = options || {};
    var container = options.container;
    if (!container) return null;

    var lib = options.chartLib || global.LightweightCharts;
    var chart = createChart(container, lib, false);
    var chartType = 'candles';
    var series = addPriceSeries(chart, chartType);
    var heikinBars = [];

    var candles = [];
    var watermark = -1;
    var indicators = new Map();
    var indicatorCache = new Map();
    var indicatorSettings = new Map();
    var paneCount = 0;
    var isFollowing = true;
    var playing = false;
    var isProgrammaticScroll = false;
    var lastVisibleSpan = DEFAULT_VISIBLE_BARS;
    var lastBarSpacing = null;
    var followChangeCallbacks = [];

    var dragOrigin = null;
    var isPriceScaleDrag = false;
    var latchedAxis = null;
    var horizontalPanUntil = 0;

    function syncIndicatorPanes(range) {
      if (!paneCount) return;
      var visibleRange = range || chart.timeScale().getVisibleLogicalRange();
      if (!visibleRange) return;
      indicators.forEach(function (indicator) {
        if (indicator.pane) indicator.pane.chart.timeScale().setVisibleLogicalRange(visibleRange);
      });
    }

    function getIndicatorData(key, target) {
      if (!indicatorCache.has(key)) {
        var appearance = indicatorSettings.get(key);
        indicatorCache.set(key, global.ReplayIndicators.createCalculator(appearance.type, appearance.parameters));
      }
      var calculator = indicatorCache.get(key);
      for (var i = calculator.data[0].length; i <= target; i += 1) calculator.append(candles[i]);
      return calculator.data;
    }

    function positionIndicatorPoint(points, position, offset) {
      if (!offset) return points[position];
      var source = points[position - offset];
      var time = candles[position].time;
      return source && source.value !== undefined ? { time: time, value: source.value } : { time: time };
    }

    function indicatorOffset(indicator, index) {
      if (index === 4) return -indicator.displacement;
      return index >= 2 ? indicator.displacement : 0;
    }

    function paintIndicator(key, indicator, target, incremental) {
      var data = getIndicatorData(key, target);
      indicator.series.forEach(function (line, index) {
        // Chikou plots each revealed close at an earlier candle's timestamp.
        var offset = indicatorOffset(indicator, index);
        var clipping = Math.min(0, offset);
        var last = target + clipping;
        if (!incremental && !offset) {
          line.setData(data[index].slice(0, last + 1));
          return;
        }
        var start = incremental ? Math.max(0, watermark + 1 + clipping) : 0;
        var history = [];
        for (var i = start; i <= last; i += 1) {
          var point = positionIndicatorPoint(data[index], i, offset);
          if (incremental) line.update(point);
          else history.push(point);
        }
        if (!incremental) line.setData(history);
      });
      if (indicator.pane) {
        var anchor = indicator.pane.anchor;
        if (incremental) {
          for (var i = watermark + 1; i <= target; i += 1) anchor.update(toAnchor(candles[i]));
        } else {
          anchor.setData(candles.slice(0, target + 1).map(toAnchor));
        }
      }
      if (indicator.cloud) indicator.cloud.setData(data, target, indicator.displacement);
      paintIndicatorLegend(indicator, data, target);
    }

    function paintIndicatorLegend(indicator, data, target) {
      if (!indicator.legend) return;
      indicator.legend.values.forEach(function (label, index) {
        var offset = indicatorOffset(indicator, index);
        var position = target + Math.min(0, offset);
        var point = data && position >= 0 && positionIndicatorPoint(data[index], position, offset);
        var value = indicator.volume && point && Number.isFinite(point.value)
          ? point.value.toLocaleString() : formatPrice(point && point.value);
        if (label.textContent !== value) label.textContent = value;
      });
    }

    function toAnchor(candle) {
      return { time: candle.time, value: 0 };
    }

    function isKnownIndicator(key) {
      return global.ReplayIndicators && Object.prototype.hasOwnProperty.call(INDICATORS, key);
    }

    function getIndicatorSettings(key) {
      if (!indicatorSettings.has(key)) {
        indicatorSettings.set(key, {
          type: key,
          parameters: global.ReplayIndicators.normalize(key),
          size: 'default',
          placement: global.ReplayIndicators.placement(key)
        });
      }
      return indicatorSettings.get(key);
    }

    function indicatorLineSize(key, size) {
      var width = INDICATOR_SIZES[size];
      return key === 'supertrend' ? { lineWidth: width, pointMarkersRadius: width } : { lineWidth: width };
    }

    function configureIndicator(key, settings) {
      settings = settings || {};
      var type = settings.type || key;
      if (!isKnownIndicator(type)) return;
      var previous = getIndicatorSettings(key);
      var parameters = global.ReplayIndicators.normalize(type, settings.parameters);
      var placement = global.ReplayIndicators.placement(type, settings.placement);
      var size = Object.prototype.hasOwnProperty.call(INDICATOR_SIZES, settings.size) ? settings.size : 'default';
      var parametersChanged = previous.type !== type || Object.keys(parameters).some(function (name) {
        return parameters[name] !== previous.parameters[name];
      });
      if (parametersChanged) indicatorCache.delete(key);
      indicatorSettings.set(key, { type: type, parameters: parameters, size: size, placement: placement });

      var current = indicators.get(key);
      if (!current) return;
      if (previous.type !== type || previous.placement !== placement) {
        setIndicator(key, false);
        setIndicator(key, true);
        return;
      }
      if (previous.size !== size) {
        current.series.forEach(function (line, index) {
          if (!INDICATORS[type].series[index].histogram) line.applyOptions(indicatorLineSize(type, size));
        });
        if (current.legend) current.legend.row.dataset.size = size;
        if (current.pane) {
          current.pane.section.dataset.size = size;
          current.pane.resize();
        }
      }
      if (parametersChanged) {
        current.displacement = parameters.displacement || 0;
        updateIndicatorLegendTitle(current.legend, parameters);
        if (current.guides) {
          current.guides.forEach(function (guide, index) {
            guide.applyOptions({ price: parameters[index === 0 ? 'lower' : 'upper'] });
          });
        }
        if (watermark >= 0) {
          paintIndicator(key, current, watermark, false);
          syncIndicatorPanes();
        }
      }
    }

    function updateIndicatorLegendTitle(legend, parameters) {
      if (!legend) return;
      var values = Object.values(parameters);
      legend.detail.textContent = values.length ? ' (' + values.join(', ') + ')' : '';
    }

    function setIndicator(key, enabled) {
      var current = indicators.get(key);
      if (enabled) {
        if (current || (!indicatorSettings.has(key) && !isKnownIndicator(key))) return;
        var appearance = getIndicatorSettings(key);
        var type = appearance.type;
        var config = INDICATORS[type];
        var wantsPane = appearance.placement === 'pane';
        if (wantsPane && !options.indicatorPanes) return;
        var pane = wantsPane ? createIndicatorPane(options.indicatorPanes, appearance.size, lib, syncIndicatorPanes) : null;
        var legend = createIndicatorLegend(pane ? pane.heading : options.indicatorLegend, config.series, appearance.size);
        updateIndicatorLegendTitle(legend, appearance.parameters);
        var targetChart = pane ? pane.chart : chart;
        var lines = config.series.map(function (spec) {
          var settings = Object.assign({
            color: spec.color,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false
          }, spec.histogram ? null : indicatorLineSize(type, appearance.size), config.style);
          if (!spec.histogram) settings.lineStyle = spec.lineStyle || 0;
          if (!pane && config.independentScale) settings.priceScaleId = 'indicator-' + key;
          if (config.volume) settings.priceFormat = { type: 'volume' };
          return spec.histogram ? targetChart.addHistogramSeries(settings) : targetChart.addLineSeries(settings);
        });
        if (!pane && config.independentScale) {
          lines[0].priceScale().applyOptions({ scaleMargins: { top: 0.7, bottom: 0.04 } });
        }
        var guides;
        if (type === 'rsi') {
          lines[0].applyOptions({
            autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; }
          });
          guides = ['lower', 'upper'].map(function (name) {
            return lines[0].createPriceLine({
              price: appearance.parameters[name], color: THEME.text, lineWidth: 1, lineStyle: 2, axisLabelVisible: false
            });
          });
        }
        current = {
          pane: pane, series: lines, legend: legend, guides: guides,
          displacement: appearance.parameters.displacement || 0, volume: config.volume
        };
        if (type === 'ichimoku' && typeof lines[2].attachPrimitive === 'function') {
          current.cloud = createIchimokuCloud(targetChart, lines[2]);
          lines[2].attachPrimitive(current.cloud);
        }
        indicators.set(key, current);
        if (pane) {
          paneCount += 1;
          if (paneCount === 1) chart.priceScale('right').applyOptions({ minimumWidth: INDICATOR_AXIS_WIDTH });
        }
        if (watermark >= 0) paintIndicator(key, current, watermark, false);
      } else {
        if (!current) return;
        indicators.delete(key);
        if (current.pane) {
          current.pane.remove();
          paneCount -= 1;
          if (!paneCount) chart.priceScale('right').applyOptions({ minimumWidth: 0 });
        } else {
          current.series.forEach(function (line) { chart.removeSeries(line); });
          if (current.legend) current.legend.row.remove();
        }
      }
      syncIndicatorPanes();
    }

    function removeIndicator(key) {
      setIndicator(key, false);
      indicatorSettings.delete(key);
      indicatorCache.delete(key);
    }

    function getIndicatorScreenshots() {
      return Array.from(indicators.values()).flatMap(function (indicator) {
        return indicator.pane ? [indicator.pane.chart.takeScreenshot()] : [];
      });
    }

    if (container && container.addEventListener) {
      container.addEventListener('pointerdown', function (e) {
        if (e.button != null && e.button !== 0) return;
        var rect = container.getBoundingClientRect();
        var tsWidth = chart.timeScale().width();
        dragOrigin = { x: e.clientX, y: e.clientY };
        isPriceScaleDrag = e.clientX >= rect.left + tsWidth;
        latchedAxis = null;
        horizontalPanUntil = 0;
      });

      var onPointerMove = function (e) {
        if (!dragOrigin) return;
        if (latchedAxis === null) {
          var dx = e.clientX - dragOrigin.x;
          var dy = e.clientY - dragOrigin.y;
          if (Math.abs(dx) >= 4 || Math.abs(dy) >= 4) {
            latchedAxis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
          }
        }
        if (latchedAxis === 'horizontal' && !isPriceScaleDrag) {
          horizontalPanUntil = global.performance.now() + 100;
        }
      };

      var onPointerEnd = function () {
        var wasVertical = latchedAxis === 'vertical';
        var wasPriceScale = isPriceScaleDrag;
        dragOrigin = null;
        isPriceScaleDrag = false;
        latchedAxis = null;

        if ((wasVertical || wasPriceScale) && playing) {
          keepViewportAtEdge();
        }
      };

      container.addEventListener('wheel', function (e) {
        horizontalPanUntil = Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey
          ? global.performance.now() + 100
          : 0;
      }, { capture: true, passive: true });

      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerEnd);
        window.addEventListener('pointercancel', onPointerEnd);
      }
    }

    function emitFollowChange(following) {
      for (var i = 0; i < followChangeCallbacks.length; i += 1) {
        try {
          followChangeCallbacks[i](following);
        } catch (e) {
          if (global.console) global.console.error(e);
        }
      }
    }

    function setFollow(val) {
      var next = Boolean(val);
      if (isFollowing === next) return;
      isFollowing = next;
      emitFollowChange(isFollowing);
    }

    function snapToActive(_animated) {
      if (watermark < 0) return;
      var span = lastVisibleSpan > 0 ? lastVisibleSpan : DEFAULT_VISIBLE_BARS;
      var targetTo = watermark + RIGHT_OFFSET;
      var targetFrom = targetTo - span;

      isProgrammaticScroll = true;
      try {
        chart.timeScale().setVisibleLogicalRange({ from: targetFrom, to: targetTo });
      } finally {
        setTimeout(function () {
          isProgrammaticScroll = false;
        }, 0);
      }
      setFollow(true);
    }

    // Subscribe to visible range changes to detect manual user pan vs zoom
    chart.timeScale().subscribeVisibleLogicalRangeChange(function (newRange) {
      if (!newRange) return;
      syncIndicatorPanes(newRange);

      var currentSpan = newRange.to - newRange.from;
      var tsOptions = chart.timeScale().options();
      var curBs = tsOptions ? tsOptions.barSpacing : null;
      var isZoom = false;
      if (typeof curBs === 'number' && typeof lastBarSpacing === 'number') {
        var eps = Math.max(1e-6, Math.abs(lastBarSpacing) * 1e-6);
        if (Math.abs(curBs - lastBarSpacing) > eps) {
          isZoom = true;
        }
      }
      if (typeof curBs === 'number') {
        lastBarSpacing = curBs;
      }
      if (isProgrammaticScroll) return;

      lastVisibleSpan = currentSpan;
      if (isZoom || isPriceScaleDrag || latchedAxis === 'vertical') {
        if (playing) keepViewportAtEdge();
        else if (isZoom) setFollow(false);
        return;
      }

      if (watermark >= 0 && (latchedAxis === 'horizontal' || horizontalPanUntil > global.performance.now())) {
        if (!playing || watermark + RIGHT_OFFSET - newRange.to > 0.5) {
          setFollow(false);
        } else {
          keepViewportAtEdge();
        }
      }
    });

    function keepViewportAtEdge() {
      if (!isFollowing || watermark < 0) return;
      var span = lastVisibleSpan > 0 ? lastVisibleSpan : DEFAULT_VISIBLE_BARS;
      var targetTo = watermark + RIGHT_OFFSET;
      var targetFrom = targetTo - span;

      isProgrammaticScroll = true;
      try {
        chart.timeScale().setVisibleLogicalRange({ from: targetFrom, to: targetTo });
      } finally {
        setTimeout(function () {
          isProgrammaticScroll = false;
        }, 0);
      }
    }

    function followPrice(candle) {
      var scale = chart.priceScale('right');
      if (scale.options().autoScale || isPriceScaleDrag || latchedAxis === 'vertical') return;
      var high = series.priceToCoordinate(candle.high);
      var low = series.priceToCoordinate(candle.low);
      var height = container.clientHeight - chart.timeScale().height();
      if (high != null && low != null && (high < 0 || low > height)) {
        scale.applyOptions({ autoScale: true });
      }
    }

    function displayBar(index) {
      var candle = candles[index];
      if (chartType === 'line' || chartType === 'area') return { time: candle.time, value: candle.close };
      if (chartType !== 'heikin') return toBar(candle);
      if (heikinBars[index]) return heikinBars[index];
      var previous = heikinBars[index - 1];
      var close = (candle.open + candle.high + candle.low + candle.close) / 4;
      var open = previous ? (previous.open + previous.close) / 2 : (candle.open + candle.close) / 2;
      var bar = {
        time: candle.time, open: open, close: close,
        high: Math.max(candle.high, open, close), low: Math.min(candle.low, open, close)
      };
      heikinBars[index] = bar;
      return bar;
    }

    function displayHistory(target) {
      var history = [];
      for (var index = 0; index <= target; index += 1) history.push(displayBar(index));
      return history;
    }

    function setChartType(type) {
      if (type === chartType || !Object.prototype.hasOwnProperty.call(SERIES_METHODS, type)) return;
      var timeScale = chart.timeScale();
      var range = timeScale.getVisibleLogicalRange();
      var previous = series;
      chartType = type;
      series = addPriceSeries(chart, chartType);
      series.setData(displayHistory(watermark));
      chart.removeSeries(previous);
      if (range) timeScale.setVisibleLogicalRange(range);
      syncIndicatorPanes();
    }

    function setData(candlesList) {
      candles = (candlesList || []).slice();
      heikinBars = [];
      watermark = -1;
      isFollowing = true;
      indicatorCache.clear();
      indicators.forEach(function (indicator) {
        indicator.series.forEach(function (line) { line.setData([]); });
        if (indicator.pane) indicator.pane.anchor.setData([]);
        if (indicator.cloud) indicator.cloud.setData(null, -1, 0);
        paintIndicatorLegend(indicator);
      });
      series.setData([]);
      emitFollowChange(true);
    }

    function seekTo(target, cfg) {
      cfg = cfg || {};
      if (!candles.length) return -1;
      target = Math.max(0, Math.min(target | 0, candles.length - 1));

      if (target === watermark && !cfg.force) return watermark;

      var incremental = watermark >= 0 && target > watermark && target - watermark <= MAX_INCREMENTAL_STEPS;
      if (incremental) {
        for (var i = watermark + 1; i <= target; i += 1) {
          series.update(displayBar(i));
        }
      } else {
        series.setData(displayHistory(target));
      }
      indicators.forEach(function (indicator, key) {
        paintIndicator(key, indicator, target, incremental);
      });

      watermark = target;

      if (isFollowing && cfg.follow !== false) {
        keepViewportAtEdge();
        if (playing) followPrice(candles[target]);
      }
      syncIndicatorPanes();
      return watermark;
    }

    function appendBar(index) {
      return seekTo(index == null ? watermark + 1 : index, { follow: isFollowing });
    }

    function resize() {
      fitContainer(chart, container);
      syncIndicatorPanes();
    }

    if (global.ResizeObserver) {
      var observer = new global.ResizeObserver(resize);
      observer.observe(container);
    } else {
      global.addEventListener('resize', resize);
    }
    resize();

    return {
      chart: chart,
      get series() { return series; },
      setData: setData,
      setChartType: setChartType,
      setGridVisible: function (visible) {
        chart.applyOptions({ grid: { vertLines: { visible: visible }, horzLines: { visible: visible } } });
      },
      setScaleMode: function (mode) {
        chart.priceScale('right').applyOptions({ mode: lib.PriceScaleMode[mode] });
      },
      resetView: function () {
        chart.priceScale('right').applyOptions({ autoScale: true });
        chart.timeScale().applyOptions({ barSpacing: 7 });
        lastVisibleSpan = DEFAULT_VISIBLE_BARS;
        snapToActive();
      },
      onCandleHover: function (onHover) {
        chart.subscribeCrosshairMove(function (event) {
          var index = event.logical;
          var candle = Number.isInteger(index) && index >= 0 && index <= watermark ? candles[index] : null;
          onHover(candle && candle.time === event.time ? candle : null);
        });
      },
      setIndicator: setIndicator,
      configureIndicator: configureIndicator,
      removeIndicator: removeIndicator,
      getIndicatorScreenshots: getIndicatorScreenshots,
      seekTo: seekTo,
      appendBar: appendBar,
      resize: resize,
      fitAll: function () {
        if (watermark >= 0) chart.timeScale().fitContent();
      },
      snapToActive: snapToActive,
      setPlaying: function (next) {
        playing = next;
        if (next) {
          horizontalPanUntil = 0;
          chart.priceScale('right').applyOptions({ autoScale: true });
          snapToActive();
        }
      },
      isFollowing: function () { return isFollowing; },
      onFollowChange: function (fn) {
        if (typeof fn === 'function') followChangeCallbacks.push(fn);
      },
      getWatermark: function () { return watermark; },
      getVisibleBars: function () { return watermark < 0 ? 0 : watermark + 1; },
      timeScale: function () { return chart.timeScale(); },
      getChart: function () { return chart; },
      getSeries: function () { return series; },
      timeToCoordinate: function (time) {
        if (time == null || isNaN(time) || time <= 0) return null;
        try {
          return chart.timeScale().timeToCoordinate(time);
        } catch {
          return null;
        }
      },
      coordinateToTime: function (coordinate) {
        if (coordinate == null || isNaN(coordinate)) return null;
        try {
          return chart.timeScale().coordinateToTime(coordinate);
        } catch {
          return null;
        }
      },
      priceToCoordinate: function (price) {
        if (price == null || isNaN(price)) return null;
        try {
          return series.priceToCoordinate(price);
        } catch {
          return null;
        }
      },
      coordinateToPrice: function (coordinate) {
        if (coordinate == null || isNaN(coordinate)) return null;
        try {
          return series.coordinateToPrice(coordinate);
        } catch {
          return null;
        }
      },
      subscribeRange: function (fn) {
        if (typeof fn === 'function') {
          chart.timeScale().subscribeVisibleLogicalRangeChange(fn);
        }
      },
      subscribeClick: function (fn) {
        if (typeof fn === 'function') {
          chart.subscribeClick(fn);
        }
      }
    };
  }

  global.SmcReplayChart = {
    init: init,
    THEME: THEME,
    VISIBLE_BARS: DEFAULT_VISIBLE_BARS
  };
})(window);
