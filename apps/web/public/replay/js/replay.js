/**
 * Pure Price Action Replay Terminal (Tickets T-PAR-08, T-PAR-09, T-PAR-10).
 *
 * Replaces old benchmark/equity/trade architecture with a pure price action
 * workstation:
 *  - Dynamic period mode & timeframe selector backed by the local data catalog
 *  - Responsive candlestick viewport and indicators with smart follow & snap
 *  - Floating HUD with UTC/Local time, OHLC & range
 *  - Transport controls & full-featured scrubber with datetime tooltip
 *  - Seamless native Fullscreen (F / Esc)
 */
(function (global) {
  'use strict';

  var MAX_SAFE_BARS = 120000;

  var MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  var el = {};
  var controller = null;
  var chartApi = null;
  var indicatorPreferences = {};
  var canvasApi = null;
  var drawingsApi = null;
  var simulatorApi = null;
  var currentTool = 'cursor';
  var coverage = null;
  var currentPayload = null;
  var periodStorage = null;
  var simulationIndex = -1;
  var processedUntil = null;
  var legacyUntil = null;
  var projectedSimulation = false;
  var loading = false;
  var active = false;
  var storageNamespace;

  var selectedMode = 'month';
  var selectedYear = 2026;
  var selectedMonth = 10;
  var selectedStartDate = '2026-10-01';
  var selectedEndDate = '2026-10-30';
  var selectedTimeframe = 'M5';

  // ------------------------------------------------------------------ helpers

  function $(id) {
    return document.getElementById(id);
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function show(node, visible) {
    if (!node) return;
    node.classList.toggle('hidden', !visible);
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatPrice(val) {
    return typeof val === 'number' && isFinite(val) ? val.toFixed(3) : '—';
  }

  function formatUtc(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return '—';
    var d = new Date(seconds * 1000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
      ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  }

  function formatLocal(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return '—';
    var d = new Date(seconds * 1000);
    var tz = 'Lokal';
    try {
      var parts = new Intl.DateTimeFormat('id-ID', { timeZoneName: 'short' }).formatToParts(d);
      for (var i = 0; i < parts.length; i += 1) {
        if (parts[i].type === 'timeZoneName') { tz = parts[i].value; break; }
      }
    } catch {}
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + tz;
  }

  function isTypingTarget(target) {
    if (!target) return false;
    var tag = (target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable === true;
  }

  // ------------------------------------------------------------- selector logic

  function isTfAvailable(tf) {
    if (!coverage || !coverage.timeframe_coverage) return false;
    var cov = coverage.timeframe_coverage[tf];
    if (!cov) return false;

    if (selectedMode === 'month') {
      var key = selectedYear + '-' + pad(selectedMonth);
      return Array.isArray(cov.available_months) && cov.available_months.indexOf(key) >= 0;
    }

    if (selectedMode === 'year') {
      return Array.isArray(cov.years) && cov.years.indexOf(Number(selectedYear)) >= 0;
    }

    if (selectedMode === 'multi_month' || selectedMode === 'custom') {
      var start = el.dateStart ? el.dateStart.value : selectedStartDate;
      var end = el.dateEnd ? el.dateEnd.value : selectedEndDate;
      if (!start || !end) return true;
      return start <= cov.end_date && end >= cov.start_date;
    }

    if (selectedMode === 'all') {
      return (cov.total_bars || 0) <= MAX_SAFE_BARS;
    }

    return true; // mode 'all'
  }

  function updateTimeframePills() {
    if (!el.timeframes) return;
    var pills = el.timeframes.querySelectorAll('button[data-tf]');
    var currentValid = false;
    var firstValid = null;

    for (var i = 0; i < pills.length; i += 1) {
      var btn = pills[i];
      var tf = btn.getAttribute('data-tf');
      var ok = isTfAvailable(tf);
      var cov = coverage && coverage.timeframe_coverage && coverage.timeframe_coverage[tf];

      btn.disabled = !ok;
      btn.classList.toggle('is-disabled', !ok);
      if (!ok && selectedMode === 'all' && cov && (cov.total_bars || 0) > MAX_SAFE_BARS) {
        btn.title = tf + ' dinonaktifkan: ' + cov.total_bars.toLocaleString('id-ID') +
          ' lilin melebihi batas aman (maks 120.000). Gunakan mode Per Bulan.';
      } else if (!ok) {
        btn.title = 'Data ' + tf + ' tidak tersedia untuk periode terpilih.';
      } else {
        btn.title = tf;
      }

      var isSelected = (tf === selectedTimeframe && ok);
      btn.classList.toggle('is-active', isSelected);
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

      if (isSelected) currentValid = true;
      if (ok && !firstValid) firstValid = tf;
    }

    // Auto-switch to first available timeframe if current selection was invalidated
    if (!currentValid && firstValid) {
      selectedTimeframe = firstValid;
      for (var j = 0; j < pills.length; j += 1) {
        var b = pills[j];
        var isNow = b.getAttribute('data-tf') === selectedTimeframe;
        b.classList.toggle('is-active', isNow);
        b.setAttribute('aria-pressed', isNow ? 'true' : 'false');
      }
    }
  }

  function setMode(mode) {
    selectedMode = mode;
    if (el.modeToggle) {
      var buttons = el.modeToggle.querySelectorAll('button[data-mode]');
      for (var i = 0; i < buttons.length; i += 1) {
        var b = buttons[i];
        var active = b.getAttribute('data-mode') === mode;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }

    // Adjust visibility of period inputs
    if (mode === 'month') {
      show(el.yearWrap, true);
      show(el.monthWrap, true);
      show(el.dateStartWrap, false);
      show(el.dateEndWrap, false);
    } else if (mode === 'year') {
      show(el.yearWrap, true);
      show(el.monthWrap, false);
      show(el.dateStartWrap, false);
      show(el.dateEndWrap, false);
    } else if (mode === 'multi_month' || mode === 'custom') {
      show(el.yearWrap, false);
      show(el.monthWrap, false);
      show(el.dateStartWrap, true);
      show(el.dateEndWrap, true);
    } else { // 'all'
      show(el.yearWrap, false);
      show(el.monthWrap, false);
      show(el.dateStartWrap, false);
      show(el.dateEndWrap, false);
    }

    updateTimeframePills();
  }

  function populateSelectors() {
    if (!coverage) return;

    // Years
    if (el.year) {
      el.year.innerHTML = '';
      var years = coverage.available_years || [];
      for (var y = 0; y < years.length; y += 1) {
        var optY = document.createElement('option');
        optY.value = String(years[y]);
        optY.textContent = String(years[y]);
        el.year.appendChild(optY);
      }
      el.year.value = String(selectedYear);
    }

    // Months
    if (el.month) {
      el.month.innerHTML = '';
      for (var m = 1; m <= 12; m += 1) {
        var optM = document.createElement('option');
        optM.value = String(m);
        optM.textContent = MONTH_NAMES[m - 1];
        el.month.appendChild(optM);
      }
      el.month.value = String(selectedMonth);
    }

    // Date inputs
    if (el.dateStart && selectedStartDate) el.dateStart.value = selectedStartDate;
    if (el.dateEnd && selectedEndDate) el.dateEnd.value = selectedEndDate;

    // Timeframes
    if (el.timeframes) {
      el.timeframes.innerHTML = '';
      var tfs = coverage.timeframes || [];
      for (var t = 0; t < tfs.length; t += 1) {
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'replay-pill replay-tf-pill';
        pill.setAttribute('data-tf', tfs[t]);
        pill.textContent = tfs[t];
        el.timeframes.appendChild(pill);
      }
    }

    setMode(selectedMode);
  }

  // ------------------------------------------------------------- data loading

  function buildDataParams() {
    var params = new URLSearchParams({
      period_mode: selectedMode,
      timeframe: selectedTimeframe
    });

    if (selectedMode === 'month') {
      params.set('year', selectedYear);
      params.set('month', selectedMonth);
    } else if (selectedMode === 'year') {
      params.set('year', selectedYear);
    } else if (selectedMode === 'multi_month' || selectedMode === 'custom') {
      params.set('start_date', el.dateStart ? el.dateStart.value : selectedStartDate);
      params.set('end_date', el.dateEnd ? el.dateEnd.value : selectedEndDate);
    }
    return params;
  }

  function setStatus(message, kind) {
    if (!el.status) return;
    el.status.textContent = message || '';
    el.status.className = 'replay-status' + (kind ? ' is-' + kind : '');
  }

  function loadData() {
    if (loading) return;
    loading = true;

    if (el.btnLoad) {
      el.btnLoad.disabled = true;
      el.btnLoad.textContent = 'Memuat…';
    }
    show(el.errorBanner, false);
    setStatus('Memuat data replay…', 'loading');

    var params = buildDataParams();

    return Promise.resolve().then(function () {
      var timeframe = params.get('timeframe');
      var details = coverage && coverage.timeframe_coverage && coverage.timeframe_coverage[timeframe];
      if (params.get('period_mode') === 'all' && details && details.total_bars > MAX_SAFE_BARS) {
        throw new Error('Pilih periode dengan maksimal 120.000 lilin.');
      }
      return global.PipstrideReplayData.getData(params);
    }).then(function (payload) {
      if (payload.candles.length > MAX_SAFE_BARS) {
        throw new Error('Pilih periode dengan maksimal 120.000 lilin.');
      }
      mountPayload(payload);

      var count = (payload.meta && payload.meta.total_bars) || (payload.candles && payload.candles.length) || 0;
      var label = (payload.meta && payload.meta.period_label) || '';
      setStatus('Siap. ' + count.toLocaleString('id-ID') + ' lilin ' +
        payload.meta.timeframe + ' termuat (' + label + ').', 'ready');
    }).catch(function (err) {
      var msg = (err && err.message) ? err.message : String(err);
      if (el.errorText) el.errorText.textContent = msg;
      show(el.errorBanner, true);
      setStatus('Gagal memuat: ' + msg, 'error');
    }).finally(function () {
      loading = false;
      if (el.btnLoad) {
        el.btnLoad.disabled = false;
        el.btnLoad.textContent = 'Muat Replay';
      }
    });
  }

  function loadCoverage() {
    return Promise.resolve().then(function () {
      if (!global.PipstrideReplayData) throw new Error('Sumber data replay tidak tersedia.');
      return global.PipstrideReplayData.getCoverage();
    }).then(function (cov) {
      coverage = cov;
      var def = cov.default_selection || {};
      if (def.period_mode) selectedMode = def.period_mode;
      if (def.year) selectedYear = def.year;
      if (def.month) selectedMonth = def.month;
      if (def.timeframe) selectedTimeframe = def.timeframe;

      var m5Cov = cov.timeframe_coverage && cov.timeframe_coverage.M5;
      if (m5Cov) {
        selectedStartDate = m5Cov.usable_start_date || m5Cov.start_date || '2026-10-01';
        selectedEndDate = m5Cov.end_date || '2026-10-30';
      }

      populateSelectors();
      return loadData();
    }).catch(function (err) {
      setStatus('Gagal memuat cakupan data: ' + (err && err.message ? err.message : err), 'error');
    });
  }

  // ------------------------------------------------------------- chart & HUD

  function barEnd(candle) {
    var timeframe = currentPayload.meta.timeframe;
    return candle.time + Number(timeframe.slice(1)) * (timeframe[0] === 'H' ? 3600 : 60);
  }

  function syncSimulation() {
    if (!periodStorage || !simulatorApi || processedUntil == null || projectedSimulation) return;
    var ledger = simulatorApi.getLedger();
    if (!ledger) return;
    var state = ledger.getSummary();
    state.positions = simulatorApi.getPositions();
    state.history = simulatorApi.getHistory();
    state.processedUntil = processedUntil;
    state.legacyUntil = legacyUntil;
    periodStorage.saveSimulation(state);
  }

  function persistSimulationChange() {
    projectedSimulation = false;
    syncSimulation();
  }

  function syncStorage() {
    if (periodStorage && drawingsApi) periodStorage.saveDrawings(drawingsApi.getDrawings());
    syncSimulation();
  }

  function resumeIndex(candles, time) {
    var lo = 0;
    var hi = candles.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (barEnd(candles[mid]) < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function restoreSimulation(candles) {
    processedUntil = null;
    legacyUntil = null;
    projectedSimulation = false;
    simulationIndex = -1;
    if (!simulatorApi || !candles.length) return 0;
    var saved = periodStorage && periodStorage.loadSimulation();
    var positions = (saved && saved.positions) || (periodStorage && periodStorage.loadPositions()) || [];
    if (!Array.isArray(positions)) positions = [];
    positions.forEach(function (pos) {
      if (pos.placedTime == null) {
        pos.placedTime = pos.entryTime;
      }
    });
    simulatorApi.setPositions(positions);
    simulatorApi.restoreLedger(saved);
    simulatorApi.loadHistory(saved && saved.history);
    if (saved && saved.processedUntil != null) {
      processedUntil = saved.processedUntil;
      legacyUntil = saved.legacyUntil;
    } else {
      // Old storage has no cursor. Resume after its latest known action.
      var latest = null;
      positions.forEach(function (pos) {
        latest = Math.max(latest, pos.exitTime || pos.placedTime || 0);
      });
      ((saved && saved.trades) || []).forEach(function (trade) {
        latest = Math.max(latest, trade.exitTime || 0);
      });
      if (latest) {
        legacyUntil = barEnd({ time: latest });
        processedUntil = legacyUntil;
      }
    }
    simulationIndex = processedUntil == null ? 0 : resumeIndex(candles, processedUntil);
    var cursor = candles[simulationIndex];
    var end = barEnd(cursor);
    if (processedUntil > end) {
      // This timeframe ends earlier. Keep the saved session intact while
      // projecting the ledger onto the last available candle.
      rewindSimulation(cursor);
      projectedSimulation = true;
    } else if (processedUntil != null && cursor.time >= processedUntil) {
      // A gap can leave the resumed candle entirely unprocessed.
      var changed = simulatorApi.evaluateTimelineCandle(cursor, simulationIndex);
      processedUntil = end;
      if (changed) syncSimulation();
    }
    processedUntil = end;
    return simulationIndex;
  }

  function rewindSimulation(candle) {
    var end = barEnd(candle);
    var changed = simulatorApi.rewindTo(end);
    if (legacyUntil != null && end < legacyUntil) {
      simulatorApi.trimLegacyState(candle.time);
      legacyUntil = end;
      changed = true;
    }
    return changed;
  }

  function advanceSimulation(snapshot) {
    if (!simulatorApi || !snapshot.candle || snapshot.index === simulationIndex) return;
    var end = barEnd(snapshot.candle);
    var changed = false;
    if (snapshot.index < simulationIndex) {
      changed = rewindSimulation(snapshot.candle);
    } else {
      var candles = controller.getCandles();
      for (var i = simulationIndex + 1; i <= snapshot.index && simulatorApi.getActivePosition(); i += 1) {
        if (candles[i].time >= processedUntil && simulatorApi.evaluateTimelineCandle(candles[i], i)) {
          changed = true;
        }
      }
    }
    simulationIndex = snapshot.index;
    processedUntil = end;
    if (changed) persistSimulationChange();
  }

  function saveIndicatorPreferences() {
    try {
      global.localStorage.setItem(storageNamespace + 'indicators:v1', JSON.stringify(indicatorPreferences));
    } catch {
      // Settings still work for this session if browser storage is unavailable.
    }
  }

  function renderIndicatorSettings() {
    var key = el.indicatorSelected.value;
    var preferences = indicatorPreferences[key];
    el.indicatorSize.value = preferences.size;
    el.indicatorError.hidden = true;
    el.indicatorParameters.replaceChildren();
    global.ReplayIndicators.parameters[key].forEach(function (parameter) {
      var label = document.createElement('label');
      var input = document.createElement('input');
      label.textContent = parameter.label;
      input.type = 'number';
      input.name = parameter.key;
      input.min = parameter.min;
      input.max = parameter.max;
      input.step = parameter.step;
      input.required = true;
      input.value = preferences.parameters[parameter.key];
      label.appendChild(input);
      el.indicatorParameters.appendChild(label);
    });
  }

  function bindIndicatorSettings() {
    var api = global.ReplayIndicators;
    if (!api || !el.indicatorSettings) return;
    var saved;
    try {
      saved = JSON.parse(global.localStorage.getItem(storageNamespace + 'indicators:v1'));
    } catch {
      // Use defaults when storage is missing or unreadable.
    }
    el.indicatorsMenu.querySelectorAll('input[data-indicator]').forEach(function (input) {
      var key = input.dataset.indicator;
      var stored = (saved && saved[key]) || {};
      var option = document.createElement('option');
      option.value = key;
      option.textContent = input.parentElement.textContent.trim();
      el.indicatorSelected.appendChild(option);
      input.checked = stored.enabled === true;
      indicatorPreferences[key] = {
        enabled: input.checked,
        parameters: api.normalize(key, stored.parameters),
        size: stored.size === 'small' || stored.size === 'large' ? stored.size : 'default'
      };
    });
    renderIndicatorSettings();
    el.indicatorSelected.addEventListener('change', renderIndicatorSettings);
    el.indicatorSettings.addEventListener('input', function () {
      el.indicatorError.hidden = true;
    });

    function apply(key, parameters, size) {
      var preferences = indicatorPreferences[key];
      preferences.parameters = parameters;
      preferences.size = size;
      if (chartApi) chartApi.configureIndicator(key, preferences);
      saveIndicatorPreferences();
      el.indicatorError.hidden = true;
    }

    el.indicatorSettings.addEventListener('submit', function (event) {
      event.preventDefault();
      var key = el.indicatorSelected.value;
      var parameters = {};
      el.indicatorParameters.querySelectorAll('input').forEach(function (input) {
        parameters[input.name] = input.valueAsNumber;
      });
      var message = '';
      if (key === 'macd' && parameters.fast >= parameters.slow) {
        message = 'Periode cepat harus lebih kecil dari periode lambat.';
      } else if (key === 'rsi' && parameters.lower >= parameters.upper) {
        message = 'Batas bawah harus lebih kecil dari batas atas.';
      }
      if (message) {
        setText(el.indicatorError, message);
        el.indicatorError.hidden = false;
        return;
      }
      apply(key, api.normalize(key, parameters), el.indicatorSize.value);
    });
    el.indicatorReset.addEventListener('click', function () {
      var key = el.indicatorSelected.value;
      apply(key, api.normalize(key), 'default');
      renderIndicatorSettings();
    });
  }

  function ensureChart() {
    if (chartApi || !el.chartContainer) return chartApi;
    if (!global.SmcReplayChart) return null;

    chartApi = global.SmcReplayChart.init({
      container: el.chartContainer,
      indicatorPanes: el.indicatorPanes,
      indicatorLegend: el.indicatorLegend
    });
    if (!chartApi) {
      setStatus('Library chart gagal dimuat.', 'error');
      return null;
    }

    Object.keys(indicatorPreferences).forEach(function (key) {
      var preferences = indicatorPreferences[key];
      chartApi.configureIndicator(key, preferences);
      if (preferences.enabled) chartApi.setIndicator(key, true);
    });

    if (global.SmcReplayCanvas && el.canvas && !canvasApi) {
      canvasApi = global.SmcReplayCanvas.init({
        canvas: el.canvas,
        chartApi: chartApi,
        container: el.chartContainer,
        activeTool: currentTool
      });
    }

    if (global.SmcReplayDrawings && canvasApi && !drawingsApi) {
      drawingsApi = global.SmcReplayDrawings.init({
        canvasApi: canvasApi,
        chartApi: chartApi,
        getCandles: function () {
          return (currentPayload && currentPayload.candles) || [];
        },
        onCommit: function () {
          selectTool('cursor');
          syncStorage();
        },
        onChange: function () {
          syncStorage();
        }
      });
    }

    if (global.SmcReplaySimulator && canvasApi && !simulatorApi) {
      simulatorApi = global.SmcReplaySimulator.init({
        canvasApi: canvasApi,
        chartApi: chartApi,
        getCandles: function () {
          return (currentPayload && currentPayload.candles) || [];
        },
        getCurrentBar: function () {
          if (!controller) return null;
          var snap = controller.snapshot();
          if (!snap || !snap.candle) return null;
          var bar = snap.candle;
          if (bar.index != null) return bar;
          return {
            index: snap.index,
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume
          };
        },
        barEnd: barEnd,
        onEditStart: function () {
          if (controller.snapshot().state === 'PLAYING') controller.pause();
        },
        onCommit: function () {
          selectTool('cursor');
          persistSimulationChange();
        },
        onChange: persistSimulationChange
      });
    }

    // When chart follow state changes, update floating button visibility
    chartApi.onFollowChange(function (following) {
      updateFollowButton(following);
    });

    return chartApi;
  }

  function updateFollowButton(following) {
    if (!el.btnFollow || !controller) return;
    var isPlaying = controller.snapshot().state === 'PLAYING';
    show(el.btnFollow, isPlaying && !following);
  }

  function mountPayload(payload) {
    var api = ensureChart();
    if (!api) return;

    show(el.chartEmpty, false);

    // Warnings banner
    var warnings = (payload.meta && payload.meta.warnings) || [];
    if (warnings.length > 0) {
      if (el.warningsText) el.warningsText.textContent = warnings.join(' · ');
      show(el.warningsBanner, true);
    } else {
      show(el.warningsBanner, false);
    }

    syncSimulation();
    currentPayload = payload;
    periodStorage = global.SmcReplayStorage ? global.SmcReplayStorage.forPeriod(payload.meta, storageNamespace) : null;
    if (drawingsApi && periodStorage) drawingsApi.setDrawings(periodStorage.loadDrawings());
    var startIndex = restoreSimulation(payload.candles);
    api.setData(payload.candles);
    controller.load(payload, startIndex);

    renderScrubberLimits(payload.candles);
    render(controller.snapshot());
    api.snapToActive();
    if (el.loadedTimeframe) {
      setText(el.loadedTimeframe, 'Timeframe ' + payload.meta.timeframe);
      el.loadedTimeframe.hidden = false;
    }
    api.resize();
  }

  function renderScrubberLimits(candles) {
    if (!el.scrubber) return;
    var max = Math.max((candles ? candles.length : 0) - 1, 0);
    el.scrubber.min = '0';
    el.scrubber.max = String(max);
    el.scrubber.step = '1';
    el.scrubber.value = '0';
    el.scrubber.disabled = !candles || candles.length === 0;
  }

  function render(snapshot) {
    if (!snapshot) return;

    // --- chart update --------------------------------------------------
    if (chartApi) {
      chartApi.seekTo(snapshot.index, { follow: chartApi.isFollowing() });
    }

    // --- transport bar -------------------------------------------------
    var isPlaying = snapshot.state === 'PLAYING';
    if (el.play) {
      el.play.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
      el.play.setAttribute('aria-label', isPlaying ? 'Pause replay' : 'Play replay');
      el.play.classList.toggle('is-playing', isPlaying);
    }

    setText(el.state, snapshot.state);
    if (el.state) {
      el.state.className = 'replay-state is-' + String(snapshot.state).toLowerCase();
    }

    var posText = (snapshot.index + 1).toLocaleString('id-ID') + ' / ' +
      snapshot.totalBars.toLocaleString('id-ID');
    setText(el.position, posText);

    if (el.scrubber && document.activeElement !== el.scrubber) {
      el.scrubber.value = String(snapshot.index);
    }
    if (el.scrubberFill) {
      el.scrubberFill.style.width = (snapshot.progress * 100).toFixed(3) + '%';
    }

    renderSpeedPills(snapshot.speed);
    updateFollowButton(chartApi ? chartApi.isFollowing() : true);

    // --- floating HUD --------------------------------------------------
    setText(el.hudStatus, snapshot.state);
    if (el.hudStatus) {
      el.hudStatus.className = 'replay-hud-status is-' + String(snapshot.state).toLowerCase();
    }

    setText(el.hudProgress, (snapshot.progress * 100).toFixed(1) + '%');

    var candle = snapshot.candle;
    if (candle) {
      setText(el.hudTimeUtc, formatUtc(candle.time));
      setText(el.hudTimeLocal, formatLocal(candle.time));
      setText(el.hudOpen, formatPrice(candle.open));
      setText(el.hudHigh, formatPrice(candle.high));
      setText(el.hudLow, formatPrice(candle.low));
      setText(el.hudClose, formatPrice(candle.close));
      var range = Math.max(candle.high - candle.low, 0);
      setText(el.hudRange, '$' + formatPrice(range));
    } else {
      setText(el.hudTimeUtc, '—');
      setText(el.hudTimeLocal, '—');
      setText(el.hudOpen, '—');
      setText(el.hudHigh, '—');
      setText(el.hudLow, '—');
      setText(el.hudClose, '—');
      setText(el.hudRange, '—');
    }
  }

  function renderSpeedPills(speed) {
    if (!el.speeds) return;
    var pills = el.speeds.querySelectorAll('[data-speed]');
    for (var i = 0; i < pills.length; i += 1) {
      var raw = pills[i].getAttribute('data-speed');
      var val = raw === 'max' ? 'max' : Number(raw);
      var active = val === speed;
      pills[i].classList.toggle('is-active', active);
      pills[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  // ------------------------------------------------------------- user actions

  function onPlayToggle() {
    if (!active || !controller || !controller.isLoaded()) return;
    var snap = controller.snapshot();
    if (snap.state !== 'PLAYING') {
      // Snaps back to active candle on starting playback
      if (chartApi) {
        chartApi.snapToActive();
        chartApi.setFollow(true);
      }
    }
    render(controller.toggle());
    if (snap.state === 'PLAYING') syncSimulation();
  }

  function onStep(delta) {
    if (!controller || !controller.isLoaded()) return;
    render(controller.step(delta));
  }

  function onSpeedClick(event) {
    if (!controller) return;
    var raw = event.currentTarget.getAttribute('data-speed');
    controller.setSpeed(raw === 'max' ? 'max' : Number(raw));
    render(controller.snapshot());
  }

  function onScrubInput() {
    if (!controller || !controller.isLoaded()) return;
    var val = Number(el.scrubber.value);
    render(controller.seekToIndex(val));
  }

  function onScrubberMouseMove(e) {
    if (!currentPayload || !currentPayload.candles || !currentPayload.candles.length) return;
    var rect = el.scrubber.getBoundingClientRect();
    var wrapRect = el.scrubberWrap.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    var idx = Math.round(ratio * (currentPayload.candles.length - 1));
    var candle = currentPayload.candles[idx];
    if (!candle) return;

    if (el.scrubberTooltip) {
      el.scrubberTooltip.textContent = formatUtc(candle.time) + ' · ' + formatLocal(candle.time);
      var x = e.clientX - wrapRect.left;
      el.scrubberTooltip.style.left = x + 'px';
      show(el.scrubberTooltip, true);
    }
  }

  function onScrubberMouseLeave() {
    show(el.scrubberTooltip, false);
  }

  function onSnapFollow() {
    if (chartApi) {
      chartApi.snapToActive();
      chartApi.setFollow(true);
      show(el.btnFollow, false);
    }
  }

  function toggleFullscreen() {
    var target = el.chartWrap || el.chartContainer;
    if (!target) return;

    if (!document.fullscreenElement && !target.classList.contains('is-fullscreen')) {
      if (target.requestFullscreen) {
        target.requestFullscreen().catch(function () {
          // Fallback if browser denies native fullscreen without user activation
          target.classList.add('is-fullscreen');
          if (el.btnFullscreen) el.btnFullscreen.textContent = '⛶ Normal';
          if (chartApi) chartApi.resize();
        });
      } else if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen();
      } else {
        target.classList.add('is-fullscreen');
        if (el.btnFullscreen) el.btnFullscreen.textContent = '⛶ Normal';
        if (chartApi) chartApi.resize();
      }
    } else {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(function () {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
      target.classList.remove('is-fullscreen');
      if (el.btnFullscreen) el.btnFullscreen.textContent = '⛶ Fullscreen';
      if (chartApi) chartApi.resize();
    }
  }

  function onFullscreenChange() {
    var isFs = !!document.fullscreenElement;
    if (el.chartWrap) {
      el.chartWrap.classList.toggle('is-fullscreen', isFs);
    }
    if (el.btnFullscreen) {
      el.btnFullscreen.textContent = isFs ? '⛶ Normal' : '⛶ Fullscreen';
    }
    if (chartApi) {
      chartApi.resize();
    }
  }

  function onHudToggle() {
    if (!el.hud) return;
    var minimized = el.hud.classList.toggle('is-minimized');
    if (el.hudToggle) {
      el.hudToggle.textContent = minimized ? '+' : '—';
      el.hudToggle.setAttribute('title', minimized ? 'Bentangkan HUD (H)' : 'Ciutkan HUD (H)');
      el.hudToggle.setAttribute('aria-label', minimized ? 'Bentangkan HUD' : 'Ciutkan HUD');
    }
  }

  function toggleHud() {
    if (!el.hud) return;
    el.hud.classList.toggle('is-hidden');
  }

  function selectTool(toolName) {
    currentTool = toolName || 'cursor';
    if (el.dock) {
      var buttons = el.dock.querySelectorAll('[data-tool]');
      for (var i = 0; i < buttons.length; i += 1) {
        var isCurrent = buttons[i].getAttribute('data-tool') === currentTool;
        buttons[i].classList.toggle('is-active', isCurrent);
        buttons[i].setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
      }
    }
    if (canvasApi) {
      canvasApi.setTool(currentTool);
    }
  }

  function onClearDrawings() {
    if (drawingsApi) {
      drawingsApi.clearDrawings();
    }
    if (simulatorApi && simulatorApi.clearPositions()) {
      projectedSimulation = false;
    }
    if (canvasApi) {
      canvasApi.requestRedraw();
    }
    syncStorage();
  }

  function onKeyDown(event) {
    if (!active || event.defaultPrevented) return;
    if (el.indicatorsMenu && el.indicatorsMenu.contains(event.target)) return;
    if (isTypingTarget(event.target)) return;

    // Alt + H -> Horizontal Line tool
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault();
        selectTool('hline');
        return;
      }
    }

    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        onPlayToggle();
        return;
      }
      if (event.key === 'ArrowRight' || event.code === 'ArrowRight') {
        event.preventDefault();
        onStep(1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.code === 'ArrowLeft') {
        event.preventDefault();
        onStep(-1);
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault();
        toggleHud();
        return;
      }
      if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        if (simulatorApi) {
          var snap = controller ? controller.snapshot() : null;
          var candle = snap ? snap.candle : null;
          if (simulatorApi.closePosition(candle)) persistSimulationChange();
        }
        return;
      }
      if (event.key === 'v' || event.key === 'V') {
        event.preventDefault();
        if (simulatorApi && simulatorApi.getSelectedId()) {
          simulatorApi.deselect();
        }
        if (drawingsApi && drawingsApi.getSelectedId()) {
          drawingsApi.deselect();
        }
        selectTool('cursor');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (simulatorApi && simulatorApi.getSelectedId()) {
          simulatorApi.deselect();
        }
        if (drawingsApi && drawingsApi.getSelectedId()) {
          drawingsApi.deselect();
        }
        selectTool('cursor');
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        selectTool('rect');
        return;
      }
      if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        selectTool('trendline');
        return;
      }
      if (event.key === 'g' || event.key === 'G') {
        event.preventDefault();
        selectTool('fib');
        return;
      }
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        selectTool('ruler');
        return;
      }
      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        selectTool('long_pos');
        return;
      }
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        selectTool('short_pos');
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (simulatorApi && simulatorApi.getSelectedId()) {
          if (simulatorApi.deleteSelected()) persistSimulationChange();
        } else if (drawingsApi && drawingsApi.getSelectedId()) {
          drawingsApi.deleteSelected();
          syncStorage();
        } else {
          onClearDrawings();
        }
        return;
      }
    }
  }

  function onResize() {
    if (chartApi) chartApi.resize();
    if (canvasApi) canvasApi.resize();
  }

  // ------------------------------------------------------------- init

  function cacheElements() {
    el.root = $('pane-replay');
    el.heading = $('heading-replay');

    // Selectors
    el.modeToggle = $('replay-mode-toggle');
    el.yearWrap = $('replay-year-wrap');
    el.year = $('replay-year');
    el.monthWrap = $('replay-month-wrap');
    el.month = $('replay-month');
    el.dateStartWrap = $('replay-date-start-wrap');
    el.dateStart = $('replay-date-start');
    el.dateEndWrap = $('replay-date-end-wrap');
    el.dateEnd = $('replay-date-end');
    el.timeframes = $('replay-timeframes');
    el.btnLoad = $('replay-btn-load');
    el.btnFullscreen = $('replay-btn-fullscreen');

    // Banners
    el.warningsBanner = $('replay-warnings-banner');
    el.warningsText = $('replay-warnings-text');
    el.errorBanner = $('replay-error-banner');
    el.errorText = $('replay-error-text');

    // Transport
    el.stepBack = $('replay-step-back');
    el.play = $('replay-play');
    el.stepForward = $('replay-step-forward');
    el.state = $('replay-state');
    el.position = $('replay-position');
    el.speeds = $('replay-speeds');

    // Scrubber
    el.scrubberWrap = $('replay-scrubber-wrap');
    el.scrubberFill = $('replay-scrubber-fill');
    el.scrubber = $('replay-scrubber');
    el.scrubberTooltip = $('replay-scrubber-tooltip');
    el.status = $('replay-status');

    // Chart & HUD
    el.chartWrap = $('replay-chart-wrap');
    el.dock = $('replay-dock');
    el.canvas = $('replay-drawing-canvas');
    el.chartContainer = $('replay-chart');
    el.loadedTimeframe = $('replay-loaded-timeframe');
    el.indicatorsMenu = $('replay-indicators-menu');
    el.indicatorPanes = $('replay-indicator-panes');
    el.indicatorLegend = $('replay-indicator-legend');
    el.indicatorSettings = $('replay-indicator-settings');
    el.indicatorSelected = $('replay-indicator-selected');
    el.indicatorParameters = $('replay-indicator-parameters');
    el.indicatorSize = $('replay-indicator-size');
    el.indicatorError = $('replay-indicator-error');
    el.indicatorReset = $('replay-indicator-reset');
    el.chartEmpty = $('replay-chart-empty');
    el.btnFollow = $('replay-btn-follow');
    el.hud = $('replay-hud');
    el.hudToggle = $('replay-hud-toggle');
    el.hudStatus = $('replay-hud-status');
    el.hudProgress = $('replay-hud-progress');
    el.hudTimeUtc = $('replay-hud-time-utc');
    el.hudTimeLocal = $('replay-hud-time-local');
    el.hudOpen = $('replay-hud-open');
    el.hudHigh = $('replay-hud-high');
    el.hudLow = $('replay-hud-low');
    el.hudClose = $('replay-hud-close');
    el.hudRange = $('replay-hud-range');
  }

  function bindEvents() {
    if (el.indicatorsMenu) {
      bindIndicatorSettings();
      el.indicatorsMenu.addEventListener('change', function (event) {
        var input = event.target;
        var key = input.dataset.indicator;
        if (!key || !indicatorPreferences[key]) return;
        indicatorPreferences[key].enabled = input.checked;
        if (chartApi) chartApi.setIndicator(key, input.checked);
        saveIndicatorPreferences();
      });
      el.indicatorsMenu.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !el.indicatorsMenu.open) return;
        event.preventDefault();
        el.indicatorsMenu.open = false;
        el.indicatorsMenu.querySelector('summary').focus();
      });
      document.addEventListener('click', function (event) {
        if (el.indicatorsMenu.open && !el.indicatorsMenu.contains(event.target)) {
          el.indicatorsMenu.open = false;
        }
      });
    }

    if (el.modeToggle) {
      el.modeToggle.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-mode]');
        if (!btn) return;
        setMode(btn.getAttribute('data-mode'));
      });
    }

    if (el.year) {
      el.year.addEventListener('change', function () {
        selectedYear = Number(el.year.value);
        updateTimeframePills();
      });
    }

    if (el.month) {
      el.month.addEventListener('change', function () {
        selectedMonth = Number(el.month.value);
        updateTimeframePills();
      });
    }

    if (el.dateStart) {
      el.dateStart.addEventListener('change', function () {
        selectedStartDate = el.dateStart.value;
        updateTimeframePills();
      });
    }

    if (el.dateEnd) {
      el.dateEnd.addEventListener('change', function () {
        selectedEndDate = el.dateEnd.value;
        updateTimeframePills();
      });
    }

    if (el.timeframes) {
      el.timeframes.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-tf]');
        if (!btn || btn.disabled) return;
        selectedTimeframe = btn.getAttribute('data-tf');
        updateTimeframePills();
      });
    }

    if (el.btnLoad) el.btnLoad.addEventListener('click', loadData);
    if (el.btnFullscreen) el.btnFullscreen.addEventListener('click', toggleFullscreen);
    if (el.btnFollow) el.btnFollow.addEventListener('click', onSnapFollow);
    if (el.hudToggle) el.hudToggle.addEventListener('click', onHudToggle);

    if (el.dock) {
      el.dock.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tool]');
        if (btn) {
          var tool = btn.getAttribute('data-tool');
          selectTool(tool);
          return;
        }
        var actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
          var action = actionBtn.getAttribute('data-action');
          if (action === 'clear') {
            onClearDrawings();
          }
        }
      });
    }

    if (el.play) el.play.addEventListener('click', onPlayToggle);
    if (el.stepBack) el.stepBack.addEventListener('click', function () { onStep(-1); });
    if (el.stepForward) el.stepForward.addEventListener('click', function () { onStep(1); });

    if (el.speeds) {
      var pills = el.speeds.querySelectorAll('[data-speed]');
      for (var i = 0; i < pills.length; i += 1) {
        pills[i].addEventListener('click', onSpeedClick);
      }
    }

    if (el.scrubber) {
      el.scrubber.addEventListener('input', onScrubInput);
      el.scrubber.addEventListener('change', onScrubInput);
      el.scrubber.addEventListener('mousemove', onScrubberMouseMove);
      el.scrubber.addEventListener('mouseleave', onScrubberMouseLeave);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    global.addEventListener('resize', onResize);
  }

  function createController() {
    if (!global.SmcReplayEngine) return null;
    var ctrl = global.SmcReplayEngine.create();
    ctrl.on('frame', function (snapshot) {
      advanceSimulation(snapshot);
      render(snapshot);
      if (canvasApi) canvasApi.requestRedraw();
    });
    ctrl.on('state', function () { render(ctrl.snapshot()); });
    ctrl.on('complete', syncSimulation);
    return ctrl;
  }

  function setActive(visible) {
    active = visible;
    if (!controller) return;
    if (active) {
      global.requestAnimationFrame(onResize);
    } else {
      controller.pause();
      syncStorage();
    }
  }

  function init(accountId) {
    storageNamespace = 'pipstride:replay:' + encodeURIComponent(accountId) + ':';
    cacheElements();
    if (!el.root) return null;
    controller = createController();
    if (!controller) {
      setStatus('Modul replay engine tidak tersedia.', 'error');
      return null;
    }
    bindEvents();

    ensureChart();
    onResize();
    loadCoverage();
  }

  global.SmcReplay = { init: init, setActive: setActive };
})(window);
