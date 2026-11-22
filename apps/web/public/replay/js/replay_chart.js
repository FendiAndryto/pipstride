/**
 * Replay chart renderer for TradingView Lightweight Charts.
 *
 * Renders XAUUSD candlesticks with 3-decimal precision and optional indicators.
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
    rsi: { pane: true, series: [{ name: 'RSI', color: '#c084fc' }] },
    macd: {
      pane: true,
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
    atr: { pane: true, series: [{ name: 'ATR', color: '#fb923c' }] }
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
    var values = specs.map(function (spec) {
      var reading = doc.createElement('span');
      var name = doc.createElement('span');
      var value = doc.createElement('span');
      reading.className = 'replay-indicator-reading';
      reading.style.color = spec.color;
      name.className = 'replay-indicator-name';
      name.textContent = spec.name;
      value.className = 'replay-indicator-value';
      value.textContent = formatPrice();
      reading.appendChild(name);
      reading.appendChild(value);
      row.appendChild(reading);
      return value;
    });
    host.appendChild(row);
    return { row: row, values: values };
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

  function init(options) {
    options = options || {};
    var container = options.container;
    if (!container) return null;

    var lib = options.chartLib || global.LightweightCharts;
    var chart = createChart(container, lib, false);
    var series = chart.addCandlestickSeries({
      upColor: THEME.up,
      downColor: THEME.down,
      borderUpColor: THEME.up,
      borderDownColor: THEME.down,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      priceLineVisible: false,
      lastValueVisible: true
    });

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

    function getIndicatorData(key) {
      if (!indicatorCache.has(key)) {
        indicatorCache.set(key, global.ReplayIndicators.calculate(key, candles, indicatorSettings.get(key).parameters));
      }
      return indicatorCache.get(key);
    }

    function paintIndicator(key, indicator, target, incremental) {
      var data = getIndicatorData(key);
      indicator.series.forEach(function (line, index) {
        if (incremental) {
          for (var i = watermark + 1; i <= target; i += 1) line.update(data[index][i]);
        } else {
          line.setData(data[index].slice(0, target + 1));
        }
      });
      if (indicator.pane) {
        var anchor = indicator.pane.anchor;
        if (incremental) {
          for (var i = watermark + 1; i <= target; i += 1) anchor.update(toAnchor(candles[i]));
        } else {
          anchor.setData(candles.slice(0, target + 1).map(toAnchor));
        }
      }
      paintIndicatorLegend(indicator, data, target);
    }

    function paintIndicatorLegend(indicator, data, target) {
      if (!indicator.legend) return;
      indicator.legend.values.forEach(function (label, index) {
        var point = data && data[index][target];
        var value = formatPrice(point && point.value);
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
        indicatorSettings.set(key, { parameters: global.ReplayIndicators.normalize(key), size: 'default' });
      }
      return indicatorSettings.get(key);
    }

    function indicatorLineSize(key, size) {
      var width = INDICATOR_SIZES[size];
      return key === 'supertrend' ? { lineWidth: width, pointMarkersRadius: width } : { lineWidth: width };
    }

    function configureIndicator(key, settings) {
      if (!isKnownIndicator(key)) return;
      settings = settings || {};
      var previous = getIndicatorSettings(key);
      var parameters = global.ReplayIndicators.normalize(key, settings.parameters);
      var size = Object.prototype.hasOwnProperty.call(INDICATOR_SIZES, settings.size) ? settings.size : 'default';
      var parametersChanged = Object.keys(parameters).some(function (name) {
        return parameters[name] !== previous.parameters[name];
      });
      if (parametersChanged) indicatorCache.delete(key);
      indicatorSettings.set(key, { parameters: parameters, size: size });

      var current = indicators.get(key);
      if (!current) return;
      if (previous.size !== size) {
        current.series.forEach(function (line, index) {
          if (!INDICATORS[key].series[index].histogram) line.applyOptions(indicatorLineSize(key, size));
        });
        if (current.legend) current.legend.row.dataset.size = size;
        if (current.pane) {
          current.pane.section.dataset.size = size;
          current.pane.resize();
        }
      }
      if (parametersChanged) {
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

    function setIndicator(key, enabled) {
      var current = indicators.get(key);
      if (enabled) {
        if (current || !isKnownIndicator(key)) return;
        var config = INDICATORS[key];
        if (config.pane && !options.indicatorPanes) return;
        var appearance = getIndicatorSettings(key);
        var pane = config.pane ? createIndicatorPane(options.indicatorPanes, appearance.size, lib, syncIndicatorPanes) : null;
        var legend = createIndicatorLegend(pane ? pane.heading : options.indicatorLegend, config.series, appearance.size);
        var targetChart = pane ? pane.chart : chart;
        var lines = config.series.map(function (spec) {
          var settings = Object.assign({
            color: spec.color,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false
          }, spec.histogram ? null : indicatorLineSize(key, appearance.size), config.style);
          if (!spec.histogram) settings.lineStyle = spec.lineStyle || 0;
          return spec.histogram ? targetChart.addHistogramSeries(settings) : targetChart.addLineSeries(settings);
        });
        var guides;
        if (key === 'rsi') {
          lines[0].applyOptions({
            autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; }
          });
          guides = ['lower', 'upper'].map(function (name) {
            return lines[0].createPriceLine({
              price: appearance.parameters[name], color: THEME.text, lineWidth: 1, lineStyle: 2, axisLabelVisible: false
            });
          });
        }
        current = { pane: pane, series: lines, legend: legend, guides: guides };
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

    function setData(candlesList) {
      candles = (candlesList || []).slice();
      watermark = -1;
      isFollowing = true;
      indicatorCache.clear();
      indicators.forEach(function (indicator) {
        indicator.series.forEach(function (line) { line.setData([]); });
        if (indicator.pane) indicator.pane.anchor.setData([]);
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
          series.update(toBar(candles[i]));
        }
      } else {
        series.setData(candles.slice(0, target + 1).map(toBar));
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
      series: series,
      setData: setData,
      setIndicator: setIndicator,
      configureIndicator: configureIndicator,
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
          chart.subscribeClick(function (param) {
            if (!playing) fn(param);
          });
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
