(function (global) {
  'use strict';

  function periodParameter(defaultValue, key, label) {
    return { key: key || 'period', label: label || 'Periode', defaultValue: defaultValue, min: 1, max: 500, step: 1 };
  }

  function multiplierParameter(defaultValue) {
    return { key: 'multiplier', label: 'Pengali', defaultValue: defaultValue, min: 0.01, max: 100, step: 0.01 };
  }

  var parameters = {
    sma: [periodParameter(20)],
    ema: [periodParameter(20)],
    supertrend: [periodParameter(10), multiplierParameter(3)],
    rsi: [
      periodParameter(14),
      { key: 'lower', label: 'Level bawah', defaultValue: 30, min: 0, max: 100, step: 1 },
      { key: 'upper', label: 'Level atas', defaultValue: 70, min: 0, max: 100, step: 1 }
    ],
    macd: [
      periodParameter(12, 'fast', 'Periode cepat'),
      periodParameter(26, 'slow', 'Periode lambat'),
      periodParameter(9, 'signal', 'Periode sinyal')
    ],
    bollinger: [periodParameter(20), multiplierParameter(2)],
    vwap: [{ key: 'resetHour', label: 'Jam reset (UTC)', defaultValue: 0, min: 0, max: 23, step: 1 }],
    atr: [periodParameter(14)],
    volume: [],
    stochastic: [
      periodParameter(14, 'period', 'Periode %K'),
      periodParameter(3, 'smooth', 'Penghalusan %K'),
      periodParameter(3, 'signal', 'Periode %D')
    ],
    adx: [periodParameter(14)],
    donchian: [periodParameter(20)],
    ichimoku: [
      periodParameter(9, 'conversion', 'Periode konversi'),
      periodParameter(26, 'base', 'Periode dasar'),
      periodParameter(52, 'span', 'Periode Span B'),
      periodParameter(26, 'displacement', 'Pergeseran')
    ],
    obv: []
  };

  var paneTypes = new Set(['rsi', 'macd', 'atr', 'volume', 'stochastic', 'adx', 'obv']);

  function placement(key, value) {
    if (value === 'overlay' || value === 'pane') return value;
    return paneTypes.has(key) ? 'pane' : 'overlay';
  }

  function preferences(saved, legacy) {
    if (!Array.isArray(saved)) {
      saved = Object.keys(legacy || {}).map(function (type) {
        var stored = legacy[type];
        if (!stored || !(stored.applied === true || stored.enabled === true)) return null;
        return Object.assign({}, stored, { id: 'legacy-' + type, type: type });
      });
    }
    var ids = new Set();
    return saved.reduce(function (instances, stored) {
      if (!stored || typeof stored.id !== 'string' || !stored.id || ids.has(stored.id)
        || !Object.prototype.hasOwnProperty.call(parameters, stored.type)) return instances;
      ids.add(stored.id);
      instances.push({
        id: stored.id,
        type: stored.type,
        enabled: stored.enabled === true,
        parameters: normalize(stored.type, stored.parameters),
        size: stored.size === 'small' || stored.size === 'large' ? stored.size : 'default',
        placement: placement(stored.type, stored.placement)
      });
      return instances;
    }, []);
  }

  function normalize(key, settings) {
    if (!Object.prototype.hasOwnProperty.call(parameters, key)) return {};
    var effective = {};
    var defaults = {};
    parameters[key].forEach(function (parameter) {
      var value = settings && settings[parameter.key];
      var valid = Number.isFinite(value) && value >= parameter.min && value <= parameter.max
        && (parameter.step !== 1 || Number.isInteger(value));
      defaults[parameter.key] = parameter.defaultValue;
      effective[parameter.key] = valid ? value : parameter.defaultValue;
    });
    if (key === 'macd' && effective.fast >= effective.slow) {
      effective.fast = defaults.fast;
      effective.slow = defaults.slow;
    }
    if (key === 'rsi' && effective.lower >= effective.upper) {
      effective.lower = defaults.lower;
      effective.upper = defaults.upper;
    }
    return effective;
  }

  function rollingWindow(period, summarize) {
    var values = [];
    return function (value) {
      if (value === null) values.length = 0;
      else values.push(value);
      if (values.length > period) values.shift();
      return values.length === period ? summarize(values) : null;
    };
  }

  function mean(values) {
    return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
  }

  function smoother(period, alpha) {
    var count = 0;
    var sum = 0;
    var average = null;
    return function (value) {
      if (value === null) {
        count = 0;
        sum = 0;
        average = null;
      } else if (count < period) {
        sum += value;
        count++;
        if (count === period) average = sum / period;
      } else {
        average += alpha * (value - average);
      }
      return average;
    };
  }

  function closeOf(candle) {
    return Number.isFinite(candle.close) ? candle.close : null;
  }

  function hasRange(candle) {
    return Number.isFinite(candle.high) && Number.isFinite(candle.low);
  }

  function trueRange() {
    var previousClose = null;
    return function (candle) {
      var range = null;
      var close = closeOf(candle);
      if (close !== null && hasRange(candle)) {
        range = candle.high - candle.low;
        if (previousClose !== null) {
          range = Math.max(range,
            Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
        }
      }
      previousClose = range === null ? null : close;
      return range;
    };
  }

  function closeSeries(average) {
    return function (candle) { return [average(closeOf(candle))]; };
  }

  function bollinger(period, multiplier) {
    return rollingWindow(period, function (values) {
      var middle = mean(values);
      var variance = mean(values.map(function (value) { return (value - middle) ** 2; }));
      var width = multiplier * Math.sqrt(variance);
      return [middle, middle + width, middle - width];
    });
  }

  function relativeStrength(period) {
    var previousClose = null;
    var gainAverage = smoother(period, 1 / period);
    var lossAverage = smoother(period, 1 / period);
    return function (candle) {
      var close = closeOf(candle);
      var change = close === null || previousClose === null ? null : close - previousClose;
      previousClose = close;
      var gain = gainAverage(change === null ? null : Math.max(change, 0));
      var loss = lossAverage(change === null ? null : Math.max(-change, 0));
      if (gain === null) return [null];
      if (gain === 0 && loss === 0) return [50];
      return [100 * gain / (gain + loss)];
    };
  }

  function macd(fastPeriod, slowPeriod, signalPeriod) {
    var fastAverage = smoother(fastPeriod, 2 / (fastPeriod + 1));
    var slowAverage = smoother(slowPeriod, 2 / (slowPeriod + 1));
    var signalAverage = smoother(signalPeriod, 2 / (signalPeriod + 1));
    return function (candle) {
      var close = closeOf(candle);
      var fast = fastAverage(close);
      var slow = slowAverage(close);
      var line = slow === null ? null : fast - slow;
      var signal = signalAverage(line);
      return [line, signal, signal === null ? null : line - signal];
    };
  }

  function supertrend(period, multiplier) {
    var range = trueRange();
    var atr = smoother(period, 1 / period);
    var upper = null;
    var lower = null;
    var previousClose = null;
    var up = false;
    return function (candle) {
      var average = atr(range(candle));
      if (average === null) {
        upper = null;
        up = false;
        return [null, null];
      }
      var middle = (candle.high + candle.low) / 2;
      var basicUpper = middle + multiplier * average;
      var basicLower = middle - multiplier * average;
      if (upper === null) {
        upper = basicUpper;
        lower = basicLower;
      } else {
        if (basicLower > lower || previousClose < lower) lower = basicLower;
        if (basicUpper < upper || previousClose > upper) upper = basicUpper;
        up = up ? candle.close >= lower : candle.close > upper;
      }
      previousClose = candle.close;
      return up ? [lower, null] : [null, upper];
    };
  }

  function vwap(resetHour) {
    var day = null;
    var weightedSum = 0;
    var volumeSum = 0;
    var resetOffset = resetHour * 3600;
    return function (candle) {
      var nextDay = Math.floor((candle.time - resetOffset) / 86400);
      if (nextDay !== day) {
        day = nextDay;
        weightedSum = 0;
        volumeSum = 0;
      }
      var close = closeOf(candle);
      if (close === null || !hasRange(candle)) return [null];
      if (Number.isFinite(candle.volume) && candle.volume > 0) {
        weightedSum += ((candle.high + candle.low + close) / 3) * candle.volume;
        volumeSum += candle.volume;
      }
      return [volumeSum > 0 ? weightedSum / volumeSum : null];
    };
  }

  function rangeWindow(period) {
    var summarize = rollingWindow(period, function (candles) {
      var high = -Infinity;
      var low = Infinity;
      candles.forEach(function (candle) {
        high = Math.max(high, candle.high);
        low = Math.min(low, candle.low);
      });
      return [high, low];
    });
    return function (candle) { return summarize(hasRange(candle) ? candle : null); };
  }

  function midpoint(bounds) {
    return bounds ? (bounds[0] + bounds[1]) / 2 : null;
  }

  function stochastic(period, smoothPeriod, signalPeriod) {
    var bounds = rangeWindow(period);
    var smooth = rollingWindow(smoothPeriod, mean);
    var signal = rollingWindow(signalPeriod, mean);
    return function (candle) {
      var range = bounds(candle);
      var close = closeOf(candle);
      var raw = null;
      if (range && close !== null) {
        raw = range[0] === range[1] ? 0 : 100 * (close - range[1]) / (range[0] - range[1]);
      }
      var k = smooth(raw);
      return [k, signal(k)];
    };
  }

  function directionalMovement(period) {
    var previous = null;
    var range = trueRange();
    var atr = smoother(period, 1 / period);
    var positive = smoother(period, 1 / period);
    var negative = smoother(period, 1 / period);
    var strength = smoother(period, 1 / period);
    return function (candle) {
      var tr = range(candle);
      var up = previous && tr !== null ? candle.high - previous.high : null;
      var down = up !== null ? previous.low - candle.low : null;
      previous = tr === null ? null : candle;
      var average = atr(up === null ? null : tr);
      var p = positive(up === null ? null : up > down && up > 0 ? up : 0);
      var n = negative(down === null ? null : down > up && down > 0 ? down : 0);
      var plus = average === null ? null : average === 0 ? 0 : 100 * p / average;
      var minus = average === null ? null : average === 0 ? 0 : 100 * n / average;
      var dx = average === null ? null : p + n === 0 ? 0 : 100 * Math.abs(p - n) / (p + n);
      return [strength(dx), plus, minus];
    };
  }

  function ichimoku(conversionPeriod, basePeriod, spanPeriod) {
    var conversionRange = rangeWindow(conversionPeriod);
    var baseRange = rangeWindow(basePeriod);
    var spanRange = rangeWindow(spanPeriod);
    return function (candle) {
      var conversion = midpoint(conversionRange(candle));
      var base = midpoint(baseRange(candle));
      var leadingA = conversion === null || base === null ? null : (conversion + base) / 2;
      return [conversion, base, leadingA, midpoint(spanRange(candle)), closeOf(candle)];
    };
  }

  function volumeOf(candle) {
    return Number.isFinite(candle.volume) && candle.volume >= 0 ? candle.volume : null;
  }

  function obv() {
    var previousClose = null;
    var total = 0;
    return function (candle) {
      var close = closeOf(candle);
      var volume = volumeOf(candle);
      if (close !== null && previousClose !== null && volume !== null) {
        total += Math.sign(close - previousClose) * volume;
      }
      previousClose = close;
      return [volume === null || close === null ? null : total];
    };
  }

  // Produces points in series order, one candle at a time.
  function createCalculator(key, settings) {
    var config = normalize(key, settings);
    var next;
    var count = 1;
    switch (key) {
      case 'sma':
        next = closeSeries(rollingWindow(config.period, mean));
        break;
      case 'ema':
        next = closeSeries(smoother(config.period, 2 / (config.period + 1)));
        break;
      case 'supertrend':
        next = supertrend(config.period, config.multiplier);
        count = 2;
        break;
      case 'rsi':
        next = relativeStrength(config.period);
        break;
      case 'macd':
        next = macd(config.fast, config.slow, config.signal);
        count = 3;
        break;
      case 'bollinger': {
        var bands = bollinger(config.period, config.multiplier);
        next = function (candle) { return bands(closeOf(candle)) || [null, null, null]; };
        count = 3;
        break;
      }
      case 'vwap':
        next = vwap(config.resetHour);
        break;
      case 'atr': {
        var range = trueRange();
        var average = smoother(config.period, 1 / config.period);
        next = function (candle) { return [average(range(candle))]; };
        break;
      }
      case 'volume':
        next = function (candle) { return [volumeOf(candle)]; };
        break;
      case 'stochastic':
        next = stochastic(config.period, config.smooth, config.signal);
        count = 2;
        break;
      case 'adx':
        next = directionalMovement(config.period);
        count = 3;
        break;
      case 'donchian': {
        var bounds = rangeWindow(config.period);
        next = function (candle) {
          var range = bounds(candle);
          return range ? [midpoint(range), range[0], range[1]] : [null, null, null];
        };
        count = 3;
        break;
      }
      case 'ichimoku':
        // Keep the values at their source timestamps. The chart clips and shifts
        // them together so a lagging point appears only when its source opens.
        next = ichimoku(config.conversion, config.base, config.span);
        count = 5;
        break;
      case 'obv':
        next = obv();
        break;
      default:
        return { data: [], append: function () {} };
    }
    var series = Array.from({ length: count }, function () { return []; });
    function append(candle) {
      next(candle).forEach(function (value, index) {
        var point = Number.isFinite(value) ? { time: candle.time, value: value } : { time: candle.time };
        if (key === 'volume' && Number.isFinite(value)) {
          point.color = candle.close < candle.open ? 'rgba(255, 113, 128, .65)' : 'rgba(69, 224, 173, .65)';
        }
        series[index].push(point);
      });
    }
    return { data: series, append: append };
  }

  function calculate(key, candles, settings) {
    var calculator = createCalculator(key, settings);
    candles.forEach(calculator.append);
    return calculator.data;
  }

  var api = {
    parameters: parameters,
    normalize: normalize,
    calculate: calculate,
    createCalculator: createCalculator,
    placement: placement,
    preferences: preferences
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ReplayIndicators = api;
})(typeof window !== 'undefined' ? window : globalThis);
