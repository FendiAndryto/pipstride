/**
 * Client-side replay clock & state machine (ticket T-REP-03).
 *
 * Pure logic: no DOM, no chart, no network. It owns *what bar we are on* and
 * derives every number the HUD shows (floating PnL, realized equity, win rate,
 * drawdown, active trades) from the payload produced by /api/replay/data.
 *
 * Everything is recomputable from an absolute bar index, so stepping backwards
 * and scrubbing are just as cheap and exact as playing forwards. The renderer
 * layers are idempotent: they receive the derived snapshot and paint it.
 *
 * States (SPEC-REPLAY-01 §5):
 *   STOPPED -> PLAYING -> PAUSED -> PLAYING ...
 *   PAUSED  -> STEPPING -> PAUSED
 *   PAUSED  -> SEEKING  -> PAUSED
 *   PLAYING -> COMPLETED -> STOPPED (reset)
 *
 * The clock is injected (`options.raf`, `options.now`) so the machine can be
 * unit-tested headlessly by calling `pump(deltaMs)` instead of waiting on frames.
 */
(function (global) {
  'use strict';

  var STATES = {
    STOPPED: 'STOPPED',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    STEPPING: 'STEPPING',
    SEEKING: 'SEEKING',
    COMPLETED: 'COMPLETED'
  };

  /** Bars per second at 1x. 1x = one M5 bar per second, as specified. */
  var BASE_BARS_PER_SECOND = 1;
  var SPEED_PRESETS = [0.5, 1, 2, 5, 10, 25, 50, 'max'];
  var MAX_STEPS_PER_FRAME = 400;
  /**
   * Max speed aims to sweep the whole session in about this long, whatever the
   * display refresh rate. Deriving the per-frame chunk from wall-clock time
   * (instead of a fixed 1/300th of the session per frame) keeps Max honest on
   * slow/headless renderers where rAF only fires ~8 times per second.
   */
  var MAX_SWEEP_SECONDS = 4;
  var CONTRACT_SIZE = 100; // XAUUSD: 100 oz per lot
  var SPREAD_COST_USD = 0.2; // must match replay_engine.SPREAD_COST_USD

  // ------------------------------------------------------------------ helpers

  function clamp(value, low, high) {
    if (value < low) return low;
    if (value > high) return high;
    return value;
  }

  function upperBound(list, target, key) {
    var low = 0;
    var high = list.length;
    while (low < high) {
      var mid = (low + high) >> 1;
      if (key(list[mid]) <= target) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /** First index whose key is >= target (companion to upperBound). */
  function lowerBound(list, target, key) {
    var low = 0;
    var high = list.length;
    while (low < high) {
      var mid = (low + high) >> 1;
      if (key(list[mid]) < target) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function formatUtc(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return '--';
    var d = new Date(seconds * 1000);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
      ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  }

  /** Trade PnL at an arbitrary price, including the round-turn spread cost. */
  function tradePnlAt(trade, price) {
    var move = trade.side === 'BUY' ? price - trade.entry_price : trade.entry_price - price;
    var gross = move * trade.lot * CONTRACT_SIZE;
    return gross - trade.lot * CONTRACT_SIZE * SPREAD_COST_USD;
  }

  // --------------------------------------------------------------- index build

  /**
   * Pre-compute the lookups the per-frame derivation needs:
   *  - trades sorted by entry and by exit, with prefix sums for realized equity
   *  - per-trade running high/low so floating PnL can show excursion extremes
   */
  function buildIndex(payload) {
    var candles = (payload && payload.candles) || [];
    var trades = ((payload && payload.trades) || []).slice();

    trades.sort(function (a, b) {
      return a.entry_idx - b.entry_idx || a.exit_idx - b.exit_idx;
    });

    for (var i = 0; i < trades.length; i += 1) {
      var trade = trades[i];
      trade.entryIdx = clamp(trade.entry_idx | 0, 0, Math.max(candles.length - 1, 0));
      trade.exitIdx = clamp(trade.exit_idx | 0, trade.entryIdx, Math.max(candles.length - 1, 0));
      trade.openBar = candles[trade.entryIdx] || null;

      // Running extremes from entry to exit, used for MFE/MAE readouts.
      var runHigh = new Array(trade.exitIdx - trade.entryIdx + 1);
      var runLow = new Array(trade.exitIdx - trade.entryIdx + 1);
      var hi = -Infinity;
      var lo = Infinity;
      for (var b = trade.entryIdx; b <= trade.exitIdx; b += 1) {
        var candle = candles[b];
        if (candle) {
          if (candle.high > hi) hi = candle.high;
          if (candle.low < lo) lo = candle.low;
        }
        runHigh[b - trade.entryIdx] = hi;
        runLow[b - trade.entryIdx] = lo;
      }
      trade.runHigh = runHigh;
      trade.runLow = runLow;
    }

    // Realized-equity ladder in exit order (trades may overlap while open).
    var byExit = trades.slice().sort(function (a, b) {
      return a.exitIdx - b.exitIdx || a.entryIdx - b.entryIdx;
    });
    var prefixPnl = [0];
    var prefixWins = [0];
    var prefixEquity = [Number(payload.meta.initial_capital) || 0];
    var prefixPeak = [prefixEquity[0]];
    var prefixDrawdown = [0];
    var equity = prefixEquity[0];
    var peak = equity;
    var maxDd = 0;
    for (var t = 0; t < byExit.length; t += 1) {
      equity += byExit[t].pnl;
      if (equity > peak) peak = equity;
      var dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (dd > maxDd) maxDd = dd;
      prefixPnl.push(equity - prefixEquity[0]);
      prefixWins.push(prefixWins[prefixWins.length - 1] + (byExit[t].pnl > 0 ? 1 : 0));
      prefixEquity.push(equity);
      prefixPeak.push(peak);
      prefixDrawdown.push(maxDd);
    }

    return {
      payload: payload,
      meta: payload.meta || {},
      candles: candles,
      trades: trades,
      byExit: byExit,
      prefixPnl: prefixPnl,
      prefixWins: prefixWins,
      prefixEquity: prefixEquity,
      prefixPeak: prefixPeak,
      prefixDrawdown: prefixDrawdown,
      initialCapital: Number((payload.meta && payload.meta.initial_capital) || 0),
      equityCurve: payload.equity_curve || [],
      zones: payload.zones || [],
      totalBars: candles.length
    };
  }

  // ------------------------------------------------------------- derived state

  function derive(index) {
    var idx = clamp(index | 0, 0, Math.max(this.totalBars - 1, 0));
    var candle = this.candles[idx] || null;
    var price = candle ? candle.close : 0;

    var closedCount = upperBound(this.byExit, idx, function (t) { return t.exitIdx; });
    var realized = this.prefixPnl[closedCount] || 0;
    var wins = this.prefixWins[closedCount] || 0;
    var equity = this.prefixEquity[closedCount] || this.initialCapital;

    // Active trades: entered at or before this bar, not yet closed. Trade count
    // is small (hundreds) and holds are short, so a bounded backward scan is
    // cheaper than maintaining interval trees.
    var active = [];
    var scanFrom = upperBound(this.trades, idx, function (t) { return t.entryIdx; }) - 1;
    for (var i = scanFrom; i >= 0; i -= 1) {
      var trade = this.trades[i];
      if (idx - trade.entryIdx > 500) break; // no strategy holds anywhere near this
      if (trade.exitIdx <= idx) continue;
      var offset = clamp(idx - trade.entryIdx, 0, trade.runHigh.length - 1);
      active.push({
        trade: trade,
        floating: tradePnlAt(trade, price),
        mfe: tradePnlAt(trade, trade.side === 'BUY' ? trade.runHigh[offset] : trade.runLow[offset]),
        mae: tradePnlAt(trade, trade.side === 'BUY' ? trade.runLow[offset] : trade.runHigh[offset])
      });
    }

    var floating = 0;
    for (var a = 0; a < active.length; a += 1) floating += active[a].floating;

    var lastClosed = closedCount > 0 ? this.byExit[closedCount - 1] : null;

    // Navigation targets for "jump to next / previous trade". `nextTrade` is the
    // first trade whose entry is strictly after the cursor; `prevTrade` is the
    // last trade whose entry is at or before it, so stepping back from a trade's
    // own entry bar lands on the *previous* trade rather than staying put.
    var nextIdx = upperBound(this.trades, idx, function (t) { return t.entryIdx; });
    var prevIdx = lowerBound(this.trades, idx, function (t) { return t.entryIdx; }) - 1;

    return {
      index: idx,
      totalBars: this.totalBars,
      progress: this.totalBars > 1 ? idx / (this.totalBars - 1) : 1,
      candle: candle,
      time: candle ? candle.time : null,
      timeLabel: candle ? formatUtc(candle.time) : '--',
      price: price,
      closedTrades: closedCount,
      openTrades: active.length,
      active: active,
      realizedPnl: realized,
      floatingPnl: floating,
      balance: equity,
      equity: equity + floating,
      wins: wins,
      losses: closedCount - wins,
      winRate: closedCount > 0 ? (wins / closedCount) * 100 : 0,
      maxDrawdownPct: this.prefixDrawdown[closedCount] || 0,
      lastClosed: lastClosed,
      nextTrade: nextIdx < this.trades.length ? this.trades[nextIdx] : null,
      prevTrade: prevIdx >= 0 ? this.trades[prevIdx] : null
    };
  }

  // ------------------------------------------------------------------ controller

  function createController(options) {
    var opts = options || {};
    var listeners = {};
    var raf = opts.raf || (typeof global.requestAnimationFrame === 'function'
      ? function (cb) { return global.requestAnimationFrame(cb); }
      : function (cb) { return global.setTimeout(function () { cb(); }, 16); });
    var cancelRaf = opts.cancelRaf || (typeof global.cancelAnimationFrame === 'function'
      ? function (id) { return global.cancelAnimationFrame(id); }
      : function (id) { return global.clearTimeout(id); });
    var now = opts.now || function () {
      return (global.performance && global.performance.now)
        ? global.performance.now()
        : Date.now();
    };

    var index = null;
    var state = STATES.STOPPED;
    var speed = 1;
    var lastTs = null;
    var accumulator = 0;
    var frameHandle = null;

    function emit(type, payload) {
      var list = listeners[type];
      if (!list) return;
      for (var i = 0; i < list.length; i += 1) {
        try {
          list[i](payload);
        } catch (err) {
          if (global.console) global.console.error('replay listener failed', err);
        }
      }
    }

    function on(type, handler) {
      if (typeof handler !== 'function') return function () {};
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
      return function () {
        var list = listeners[type];
        if (!list) return;
        var at = list.indexOf(handler);
        if (at >= 0) list.splice(at, 1);
      };
    }

    function setState(next) {
      if (state === next) return;
      state = next;
      emit('state', { state: state });
    }

    function snapshot() {
      if (!index) {
        return {
          state: state, speed: speed, loaded: false, index: 0, totalBars: 0,
          progress: 0, time: null, timeLabel: '--', candle: null, price: 0,
          closedTrades: 0, openTrades: 0, active: [], realizedPnl: 0,
          floatingPnl: 0, balance: 0, equity: 0, wins: 0, losses: 0,
          winRate: 0, maxDrawdownPct: 0, lastClosed: null, nextTrade: null
        };
      }
      var derived = derive.call(index, index.cursor);
      derived.state = state;
      derived.speed = speed;
      derived.loaded = true;
      derived.meta = index.meta;
      return derived;
    }

    function publish(reason) {
      var snap = snapshot();
      emit('frame', snap);
      emit('index', { index: snap.index, reason: reason });
      return snap;
    }

    /** Move to an absolute bar index, clamping and re-publishing. */
    function setIndex(target, reason) {
      if (!index) return null;
      var next = clamp(target | 0, 0, Math.max(index.totalBars - 1, 0));
      var changed = next !== index.cursor;
      index.cursor = next;
      if (!changed && reason !== 'force') return snapshot();
      var snap = publish(reason || 'seek');
      if (index.totalBars > 0 && next >= index.totalBars - 1) {
        // Reaching the last bar finishes playback (but an explicit seek to the
        // end stays PAUSED so the user can still inspect and step back).
        if (state === STATES.PLAYING) {
          stopClock();
          setState(STATES.COMPLETED);
          emit('complete', snap);
        }
      }
      return snap;
    }

    function stepsPerSecond() {
      if (speed === 'max') return Infinity;
      return BASE_BARS_PER_SECOND * speed;
    }

    /**
     * Bars to advance in one Max-speed tick. Shared by the rAF `loop()` and the
     * deterministic `pump()` so headless tests exercise the exact pacing the
     * browser uses (these two used to carry independent copies that drifted).
     */
    function maxStepsForFrame(deltaMs) {
      if (!index) return 0;
      var remaining = index.totalBars - 1 - index.cursor;
      if (remaining <= 0) return 0;
      var perSecond = index.totalBars / MAX_SWEEP_SECONDS;
      var steps = Math.ceil((perSecond * Math.max(deltaMs, 0)) / 1000);
      if (steps < 1) steps = 1;
      steps = clamp(steps, 1, MAX_STEPS_PER_FRAME);
      return Math.min(steps, remaining);
    }

    function stopClock() {
      if (frameHandle !== null) {
        cancelRaf(frameHandle);
        frameHandle = null;
      }
      lastTs = null;
      accumulator = 0;
    }

    function loop(ts) {
      frameHandle = null;
      if (state !== STATES.PLAYING) return;
      if (!index) return;
      var stamp = typeof ts === 'number' ? ts : now();
      if (lastTs === null) lastTs = stamp;
      var delta = stamp - lastTs;
      lastTs = stamp;

      if (speed === 'max') {
        // Bounded per frame so the tab stays responsive on 100k-bar sessions:
        // the whole session sweeps in ~MAX_SWEEP_SECONDS regardless of frame
        // rate, and never more than MAX_STEPS_PER_FRAME bars in one frame.
        var steps = maxStepsForFrame(delta);
        if (steps > 0) setIndex(index.cursor + steps, 'play');
      } else {
        accumulator += (delta / 1000) * stepsPerSecond();
        var whole = Math.floor(accumulator);
        if (whole > 0) {
          accumulator -= whole;
          setIndex(index.cursor + whole, 'play');
        }
      }

      if (state === STATES.PLAYING) frameHandle = raf(loop);
    }

    function startClock() {
      if (frameHandle !== null) return;
      lastTs = null;
      frameHandle = raf(loop);
    }

    // ---------------------------------------------------------------- public

    function load(payload, startIndex) {
      stopClock();
      index = buildIndex(payload);
      index.cursor = clamp(startIndex | 0, 0, Math.max(index.totalBars - 1, 0));
      setState(STATES.STOPPED);
      emit('load', { meta: index.meta, totalBars: index.totalBars });
      return publish('load');
    }

    function play() {
      if (!index || index.totalBars === 0) return snapshot();
      if (index.cursor >= index.totalBars - 1) index.cursor = 0; // replay from start
      if (state === STATES.PLAYING) return snapshot();
      setState(STATES.PLAYING);
      startClock();
      return publish('play');
    }

    function pause() {
      if (!index) return snapshot();
      stopClock();
      if (state === STATES.PLAYING || state === STATES.STEPPING || state === STATES.SEEKING) {
        setState(STATES.PAUSED);
      }
      return publish('pause');
    }

    function toggle() {
      if (state === STATES.PLAYING) return pause();
      return play();
    }

    function step(delta) {
      if (!index) return snapshot();
      var amount = delta == null ? 1 : delta | 0;
      if (amount === 0) return snapshot();
      stopClock();
      if (state === STATES.COMPLETED && amount < 0) setState(STATES.PAUSED);
      setState(STATES.STEPPING);
      var snap = setIndex(index.cursor + amount, amount > 0 ? 'step-forward' : 'step-back');
      if (state === STATES.STEPPING) setState(STATES.PAUSED);
      return snap;
    }

    function seekToIndex(target) {
      if (!index) return snapshot();
      stopClock();
      var wasPlaying = state === STATES.PLAYING;
      setState(STATES.SEEKING);
      var snap = setIndex(target, 'seek');
      // setIndex may have flipped us to COMPLETED (seek landed on the last bar).
      if (state === STATES.SEEKING) {
        if (wasPlaying) {
          setState(STATES.PLAYING);
          startClock();
        } else {
          setState(STATES.PAUSED);
        }
      }
      return snap;
    }

    function seekToRatio(ratio) {
      if (!index) return snapshot();
      var r = clamp(Number(ratio) || 0, 0, 1);
      return seekToIndex(Math.round(r * (index.totalBars - 1)));
    }

    /** Jump to the bar that contains `time` (epoch seconds). */
    function seekToTime(seconds) {
      if (!index || !index.totalBars) return snapshot();
      var target = upperBound(index.candles, seconds, function (c) { return c.time; }) - 1;
      return seekToIndex(clamp(target, 0, index.totalBars - 1));
    }

    /**
     * Jump to a trade's entry bar. Accepts a trade object, a trade id, or a
     * numeric position in the trade list — the audit drawer passes ids so a
     * re-render cannot seek to the wrong row.
     */
    function seekToTrade(target) {
      if (!index || !index.trades.length) return snapshot();
      var trade = null;
      if (target && typeof target === 'object') {
        trade = target;
      } else if (typeof target === 'string') {
        for (var i = 0; i < index.trades.length; i += 1) {
          if (index.trades[i].trade_id === target) { trade = index.trades[i]; break; }
        }
      } else if (typeof target === 'number' && target >= 0 && target < index.trades.length) {
        trade = index.trades[target];
      }
      if (!trade || typeof trade.entryIdx !== 'number') return snapshot();
      return seekToIndex(trade.entryIdx);
    }

    /** Advance to the next trade entry after the cursor (no-op at the end). */
    function nextTrade() {
      if (!index) return snapshot();
      var at = upperBound(index.trades, index.cursor, function (t) { return t.entryIdx; });
      if (at >= index.trades.length) return snapshot();
      return seekToTrade(index.trades[at]);
    }

    /** Rewind to the previous trade entry at or before the cursor. */
    function prevTrade() {
      if (!index) return snapshot();
      var at = lowerBound(index.trades, index.cursor, function (t) { return t.entryIdx; }) - 1;
      if (at < 0) return snapshot();
      return seekToTrade(index.trades[at]);
    }

    function reset() {
      stopClock();
      if (index) index.cursor = 0;
      setState(STATES.STOPPED);
      return publish('reset');
    }

    function setSpeed(next) {
      var value = next === 'max' || next === 'Max' || next === Infinity ? 'max' : Number(next);
      if (value !== 'max' && (!isFinite(value) || value <= 0)) return speed;
      speed = value;
      accumulator = 0;
      emit('speed', { speed: speed });
      return speed;
    }

    /** Deterministic clock advance for headless tests (bypasses rAF). */
    function pump(deltaMs) {
      if (state !== STATES.PLAYING || !index) return snapshot();
      var delta = typeof deltaMs === 'number' ? deltaMs : 16;
      if (speed === 'max') {
        var steps = maxStepsForFrame(delta);
        if (steps > 0) setIndex(index.cursor + steps, 'play');
      } else {
        accumulator += (delta / 1000) * stepsPerSecond();
        var whole = Math.floor(accumulator);
        if (whole > 0) {
          accumulator -= whole;
          setIndex(index.cursor + whole, 'play');
        }
      }
      return snapshot();
    }

    function getTrades() {
      return index ? index.trades : [];
    }

    function getZones() {
      return index ? index.zones : [];
    }

    function getCandles() {
      return index ? index.candles : [];
    }

    function getEquityCurve() {
      return index ? index.equityCurve : [];
    }

    return {
      load: load,
      play: play,
      pause: pause,
      toggle: toggle,
      step: step,
      seekToIndex: seekToIndex,
      seekToRatio: seekToRatio,
      seekToTime: seekToTime,
      seekToTrade: seekToTrade,
      nextTrade: nextTrade,
      prevTrade: prevTrade,
      reset: reset,
      setSpeed: setSpeed,
      pump: pump,
      snapshot: snapshot,
      on: on,
      getState: function () { return state; },
      getSpeed: function () { return speed; },
      getIndex: function () { return index ? index.cursor : 0; },
      getTotalBars: function () { return index ? index.totalBars : 0; },
      getMeta: function () { return index ? index.meta : null; },
      getCandles: getCandles,
      getTrades: getTrades,
      getZones: getZones,
      getEquityCurve: getEquityCurve,
      isLoaded: function () { return index !== null; }
    };
  }

  var api = {
    STATES: STATES,
    SPEED_PRESETS: SPEED_PRESETS,
    BASE_BARS_PER_SECOND: BASE_BARS_PER_SECOND,
    create: createController,
    formatUtc: formatUtc,
    tradePnlAt: tradePnlAt
  };

  global.SmcReplayEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
