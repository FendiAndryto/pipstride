/**
 * Cross-Timeframe LocalStorage Persistence Module (Fase 5: T-SIM-08).
 *
 * Implements strict versioned localStorage caching for drawings, positions,
 * and ledger data across timeframe switches within the same monthly dataset:
 *   - xauusd_replay_drawings_v1_{symbol}_{year}_{month:02d}
 *   - xauusd_replay_positions_v1_{symbol}_{year}_{month:02d}
 *   - xauusd_replay_ledger_v1_{symbol}_{year}_{month:02d}
 *
 * Fully defensive: graceful degradation when localStorage is restricted or quota exceeded.
 */
(function (global) {
  'use strict';

  var PREFIX_DRAWINGS = 'xauusd_replay_drawings_v1_';
  var PREFIX_POSITIONS = 'xauusd_replay_positions_v1_';
  var PREFIX_LEDGER = 'xauusd_replay_ledger_v1_';

  function formatKey(prefix, symbol, year, month) {
    var sym = String(symbol || 'XAUUSD').toUpperCase();
    var y = parseInt(year, 10) || 2026;
    var m = parseInt(month, 10) || 10;
    var mm = m < 10 ? '0' + m : '' + m;
    return prefix + sym + '_' + y + '_' + mm;
  }

  function safeGet(key) {
    try {
      if (typeof global.localStorage === 'undefined' || !global.localStorage) return null;
      var raw = global.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      if (typeof global.localStorage === 'undefined' || !global.localStorage) return false;
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function safeRemove(key) {
    try {
      if (typeof global.localStorage === 'undefined' || !global.localStorage) return false;
      global.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function saveDrawings(symbol, year, month, list) {
    var key = formatKey(PREFIX_DRAWINGS, symbol, year, month);
    return safeSet(key, Array.isArray(list) ? list : []);
  }

  function loadDrawings(symbol, year, month) {
    var key = formatKey(PREFIX_DRAWINGS, symbol, year, month);
    var res = safeGet(key);
    return Array.isArray(res) ? res : [];
  }

  function savePositions(symbol, year, month, list) {
    var key = formatKey(PREFIX_POSITIONS, symbol, year, month);
    return safeSet(key, Array.isArray(list) ? list : []);
  }

  function loadPositions(symbol, year, month) {
    var key = formatKey(PREFIX_POSITIONS, symbol, year, month);
    var res = safeGet(key);
    return Array.isArray(res) ? res : [];
  }

  function saveLedger(symbol, year, month, data) {
    var key = formatKey(PREFIX_LEDGER, symbol, year, month);
    return safeSet(key, data || {});
  }

  function loadLedger(symbol, year, month) {
    var key = formatKey(PREFIX_LEDGER, symbol, year, month);
    return safeGet(key) || null;
  }

  function clearAll(symbol, year, month) {
    safeRemove(formatKey(PREFIX_DRAWINGS, symbol, year, month));
    safeRemove(formatKey(PREFIX_POSITIONS, symbol, year, month));
    safeRemove(formatKey(PREFIX_LEDGER, symbol, year, month));
  }

  function forPeriod(meta, namespace) {
    var mode = meta.period_mode || 'month';
    var symbol = String(meta.symbol || 'XAUUSD').toUpperCase();
    var year = meta.year || Number((meta.start_date || '').slice(0, 4));
    var month = meta.month || Number((meta.start_date || '').slice(5, 7));
    function key(prefix) {
      prefix = (namespace || '') + prefix;
      if (mode === 'month') return formatKey(prefix, symbol, year, month);
      var scope = [symbol, mode];
      if (mode === 'year') scope.push(year);
      if (mode === 'custom' || mode === 'multi_month') {
        scope.push(meta.requested_start_date || meta.start_date, meta.requested_end_date || meta.end_date);
      }
      return prefix + scope.join('_');
    }

    return {
      loadDrawings: function () { return safeGet(key(PREFIX_DRAWINGS)) || []; },
      saveDrawings: function (drawings) { return safeSet(key(PREFIX_DRAWINGS), drawings); },
      loadPositions: function () { return safeGet(key(PREFIX_POSITIONS)) || []; },
      loadSimulation: function () { return safeGet(key(PREFIX_LEDGER)); },
      saveSimulation: function (simulation) { return safeSet(key(PREFIX_LEDGER), simulation); }
    };
  }

  var SmcReplayStorage = {
    formatKey: formatKey,
    forPeriod: forPeriod,
    saveDrawings: saveDrawings,
    loadDrawings: loadDrawings,
    savePositions: savePositions,
    loadPositions: loadPositions,
    saveLedger: saveLedger,
    loadLedger: loadLedger,
    clearAll: clearAll
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SmcReplayStorage;
  }
  global.SmcReplayStorage = SmcReplayStorage;
})(typeof window !== 'undefined' ? window : globalThis);
