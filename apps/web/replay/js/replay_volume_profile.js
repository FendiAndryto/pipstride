(function () {
  'use strict';

  var UTC_DAY_SECONDS = 86400;
  var DEFAULT_BINS = 24;
  var VALUE_AREA_FRACTION = 0.7;

  function timeBound(candles, end, time, inclusive) {
    var start = 0;
    while (start < end) {
      var middle = Math.floor((start + end) / 2);
      var candidate = candles[middle].time;
      if (candidate < time || (inclusive && candidate === time)) start = middle + 1;
      else end = middle;
    }
    return start;
  }

  function createCalculator(options) {
    var limit = Math.max(2, Math.min(200, Math.floor(Number(options.bins) || DEFAULT_BINS)));
    var fixedStart = Math.min(options.startTime, options.endTime);
    var fixedEnd = Math.max(options.startTime, options.endTime);
    var candles = null;
    var start = 0;
    var end = 0;
    var profile = null;
    var volumes = new Map();
    var origin = 0;
    var width = 0;
    var firstBin = 0;
    var lastBin = 0;

    function add(candle) {
      var low = candle.low;
      var high = candle.high;
      var volume = candle.volume;
      if (!Number.isFinite(low) || !Number.isFinite(high) || high < low || !Number.isFinite(volume) || volume <= 0) return;

      var span = high - low;
      if (!width) {
        origin = low;
        var minimumWidth = Math.max(1e-8, Math.abs(origin) * Number.EPSILON);
        width = Math.max(minimumWidth, span / limit);
      }

      var lowBin = Math.floor((low - origin) / width);
      var highBin = span ? Math.max(lowBin, Math.ceil((high - origin) / width) - 1) : lowBin;
      var minBin = Math.min(firstBin, lowBin);
      var maxBin = Math.max(lastBin, highBin);
      if (maxBin - minBin >= limit) {
        // Doubling the price step lets us merge the old buckets without rereading candles.
        var factor = 1;
        while (Math.floor(maxBin / factor) - Math.floor(minBin / factor) >= limit) factor *= 2;
        var merged = new Map();
        volumes.forEach(function (value, index) {
          var bucket = Math.floor(index / factor);
          merged.set(bucket, (merged.get(bucket) || 0) + value);
        });
        volumes = merged;
        width *= factor;
        lowBin = Math.floor((low - origin) / width);
        highBin = span ? Math.max(lowBin, Math.ceil((high - origin) / width) - 1) : lowBin;
        minBin = Math.min(Math.floor(firstBin / factor), lowBin);
        maxBin = Math.max(Math.floor(lastBin / factor), highBin);
      }
      firstBin = minBin;
      lastBin = maxBin;

      if (lowBin === highBin) {
        volumes.set(lowBin, (volumes.get(lowBin) || 0) + volume);
        return;
      }
      for (var index = lowBin; index <= highBin; index += 1) {
        var lowerEdge = origin + index * width;
        var upperEdge = origin + (index + 1) * width;
        var overlap = Math.min(high, upperEdge) - Math.max(low, lowerEdge);
        if (overlap > 0) volumes.set(index, (volumes.get(index) || 0) + volume * (overlap / span));
      }
    }

    function readProfile() {
      if (!volumes.size) return null;
      var rows = [];
      var peakVolume = 0;
      var pointOfControl = 0;
      var totalVolume = 0;
      for (var index = firstBin; index <= lastBin; index += 1) {
        var volume = volumes.get(index) || 0;
        rows.push({ low: origin + index * width, high: origin + (index + 1) * width, volume: volume });
        totalVolume += volume;
        if (volume > peakVolume) {
          peakVolume = volume;
          pointOfControl = rows.length - 1;
        }
      }

      var valueAreaLow = pointOfControl;
      var valueAreaHigh = pointOfControl;
      var valueAreaVolume = peakVolume;
      while (valueAreaVolume < totalVolume * VALUE_AREA_FRACTION) {
        var lower = rows[valueAreaLow - 1];
        var higher = rows[valueAreaHigh + 1];
        if (lower && (!higher || lower.volume >= higher.volume)) {
          valueAreaLow -= 1;
          valueAreaVolume += lower.volume;
        } else if (higher) {
          valueAreaHigh += 1;
          valueAreaVolume += higher.volume;
        } else break;
      }
      return {
        startTime: candles[start].time, endTime: candles[end - 1].time, rows: rows,
        totalVolume: totalVolume, peakVolume: peakVolume, pointOfControl: pointOfControl,
        valueAreaLow: valueAreaLow, valueAreaHigh: valueAreaHigh
      };
    }

    return function (nextCandles, targetIndex) {
      var nextEnd = Math.min(nextCandles.length, Math.floor(targetIndex) + 1);
      var nextStart = 0;
      if (nextEnd > 0 && options.type === 'session') {
        var session = Math.floor(nextCandles[nextEnd - 1].time / UTC_DAY_SECONDS) * UTC_DAY_SECONDS;
        nextStart = timeBound(nextCandles, nextEnd, session, false);
      } else if (nextEnd > 0 && options.type === 'fixed' && Number.isFinite(fixedStart) && Number.isFinite(fixedEnd)) {
        nextStart = timeBound(nextCandles, nextEnd, fixedStart, false);
        nextEnd = timeBound(nextCandles, nextEnd, fixedEnd, true);
      }
      if (nextEnd <= nextStart || !Number.isFinite(nextEnd) || (options.type !== 'session' && !Number.isFinite(fixedStart))) {
        nextStart = 0;
        nextEnd = 0;
      }
      if (candles === nextCandles && start === nextStart && end === nextEnd) return profile;
      if (candles !== nextCandles || start !== nextStart || end > nextEnd) {
        volumes.clear();
        width = 0;
        firstBin = 0;
        lastBin = 0;
        end = nextStart;
      }
      candles = nextCandles;
      start = nextStart;
      for (var index = end; index < nextEnd; index += 1) add(candles[index]);
      end = nextEnd;
      profile = readProfile();
      return profile;
    };
  }

  function create(options) {
    var calculate = createCalculator(options);
    var profile = null;
    var series = null;
    var chart = null;
    var requestUpdate = null;

    function draw(targetCanvas) {
      if (!profile || !series || !chart) return;
      var timeScale = chart.timeScale();
      var start = timeScale.timeToCoordinate(profile.startTime);
      var end = timeScale.timeToCoordinate(profile.endTime);
      if (start == null || end == null) return;
      var spacing = timeScale.options().barSpacing;
      var left = start - spacing / 2;
      targetCanvas.useMediaCoordinateSpace(function (scope) {
        var width = Math.min(scope.mediaSize.width * 0.35, Math.max(spacing, (end - start + spacing) * 0.55));
        if (left + width <= 0 || left >= scope.mediaSize.width) return;
        var context = scope.context;
        profile.rows.forEach(function (row, index) {
          if (!row.volume) return;
          var top = series.priceToCoordinate(row.high);
          var bottom = series.priceToCoordinate(row.low);
          if (top == null || bottom == null) return;
          var inValueArea = index >= profile.valueAreaLow && index <= profile.valueAreaHigh;
          context.fillStyle = index === profile.pointOfControl ? 'rgba(251, 191, 36, .64)'
            : (inValueArea ? 'rgba(56, 189, 248, .43)' : 'rgba(56, 189, 248, .22)');
          context.fillRect(left, Math.min(top, bottom), width * row.volume / profile.peakVolume, Math.max(1, Math.abs(bottom - top)));
        });
      });
    }

    var renderer = { draw: draw };
    var view = {
      zOrder: function () { return 'bottom'; },
      renderer: function () { return renderer; }
    };
    var primitive = {
      paneViews: function () { return [view]; },
      attached: function (context) {
        series = context.series;
        chart = context.chart;
        requestUpdate = context.requestUpdate;
        requestUpdate();
      },
      detached: function () {
        series = null;
        chart = null;
        requestUpdate = null;
      }
    };

    function detach() {
      if (series) series.detachPrimitive(primitive);
    }

    return {
      attach: function (nextSeries) {
        if (series === nextSeries) return;
        detach();
        if (nextSeries && typeof nextSeries.attachPrimitive === 'function') nextSeries.attachPrimitive(primitive);
      },
      detach: detach,
      setData: function (candles, targetIndex) {
        var next = calculate(candles, targetIndex);
        if (next === profile) return;
        profile = next;
        if (requestUpdate) requestUpdate();
      }
    };
  }

  window.ReplayVolumeProfile = {
    create: create,
    calculate: function (options, candles, targetIndex) { return createCalculator(options)(candles, targetIndex); }
  };
})();
