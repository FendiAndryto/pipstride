/**
 * Pure Price Action Replay Terminal (Tickets T-PAR-08, T-PAR-09, T-PAR-10).
 *
 * Replaces old benchmark/equity/trade architecture with a pure price action
 * workstation:
 *  - Month range & timeframe selectors backed by the local data catalog
 *  - Responsive candlestick viewport and indicators with smart follow & snap
 *  - Floating HUD with UTC/Local time, OHLC & range
 *  - Transport controls & full-featured scrubber with datetime tooltip
 *  - Seamless native Fullscreen (F / Esc)
 */
(function (global) {
  'use strict';

  var MAX_PERIOD_MONTHS = 12;

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
  var mobileLayout = global.matchMedia('(pointer: coarse) and (hover: none), (max-width: 640px)');
  var fullscreenRequest = false;
  var toolsLocked = false;

  var selectedStartMonth = '';
  var selectedEndMonth = '';
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

  function availableMonths(tf) {
    return coverage?.timeframe_coverage?.[tf]?.available_months || [];
  }

  function monthIndex(key) {
    return Number(key.slice(0, 4)) * 12 + Number(key.slice(5));
  }

  function updatePeriodNotice() {
    var message = '';
    if (!selectedStartMonth || !selectedEndMonth) {
      message = 'Data bulan tidak tersedia untuk timeframe ini.';
    } else if (selectedStartMonth > selectedEndMonth) {
      message = 'Bulan selesai harus sama dengan atau setelah bulan mulai.';
    } else if (monthIndex(selectedEndMonth) - monthIndex(selectedStartMonth) + 1 > MAX_PERIOD_MONTHS) {
      message = 'Rentang replay maksimal 12 bulan, termasuk bulan mulai dan selesai.';
    }
    setText(el.periodNotice, message);
    show(el.periodNotice, !!message);
    if (el.btnLoad) el.btnLoad.disabled = loading || !!message;
    return !message;
  }

  function updateTimeframePills() {
    if (!el.timeframes) return;
    var pills = el.timeframes.querySelectorAll('button[data-tf]');
    for (var i = 0; i < pills.length; i += 1) {
      var btn = pills[i];
      var tf = btn.getAttribute('data-tf');
      var ok = availableMonths(tf).length > 0;

      btn.disabled = !ok;
      btn.classList.toggle('is-disabled', !ok);
      btn.title = ok ? tf : 'Data ' + tf + ' tidak tersedia.';

      var isSelected = (tf === selectedTimeframe && ok);
      btn.classList.toggle('is-active', isSelected);
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }
  }

  function fillMonthSelect(select, months, value) {
    if (!select) return;
    select.innerHTML = '';
    months.forEach(function (key) {
      var option = document.createElement('option');
      option.value = key;
      option.textContent = MONTH_NAMES[Number(key.slice(5)) - 1] + ' ' + key.slice(0, 4);
      select.appendChild(option);
    });
    select.value = value;
    select.disabled = !months.length;
  }

  function populateMonthSelectors() {
    var months = availableMonths(selectedTimeframe).slice().sort();
    if (!months.includes(selectedStartMonth) || !months.includes(selectedEndMonth)) {
      var matching = months.filter(function (key) {
        return key >= selectedStartMonth && key <= selectedEndMonth;
      });
      var fallback = months.at(-1) || '';
      selectedStartMonth = matching[0] || fallback;
      selectedEndMonth = matching.at(-1) || fallback;
    }
    fillMonthSelect(el.monthStart, months, selectedStartMonth);
    fillMonthSelect(el.monthEnd, months, selectedEndMonth);
    updatePeriodNotice();
  }

  function populateSelectors() {
    var tfs = coverage.timeframes || [];
    if (!availableMonths(selectedTimeframe).length) {
      selectedTimeframe = tfs.find(function (tf) { return availableMonths(tf).length; }) || selectedTimeframe;
    }
    if (el.timeframes) {
      el.timeframes.innerHTML = '';
      for (var t = 0; t < tfs.length; t += 1) {
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'replay-pill replay-tf-pill';
        pill.setAttribute('data-tf', tfs[t]);
        pill.textContent = tfs[t];
        el.timeframes.appendChild(pill);
      }
    }

    updateTimeframePills();
    populateMonthSelectors();
  }

  // ------------------------------------------------------------- data loading

  function buildDataParams() {
    var year = Number(selectedEndMonth.slice(0, 4));
    var month = Number(selectedEndMonth.slice(5));
    if (selectedStartMonth === selectedEndMonth) {
      return new URLSearchParams({
        period_mode: 'month', timeframe: selectedTimeframe, year: year, month: month
      });
    }
    var lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return new URLSearchParams({
      period_mode: 'multi_month',
      timeframe: selectedTimeframe,
      start_date: selectedStartMonth + '-01',
      end_date: selectedEndMonth + '-' + lastDay
    });
  }

  function setStatus(message, kind) {
    if (!el.status) return;
    el.status.textContent = message || '';
    el.status.className = 'replay-status' + (kind ? ' is-' + kind : '');
  }

  function loadData() {
    if (loading || !updatePeriodNotice()) return;
    loading = true;

    if (el.btnLoad) {
      el.btnLoad.disabled = true;
      el.btnLoad.textContent = 'Memuat…';
    }
    show(el.errorBanner, false);
    setStatus('Memuat data replay…', 'loading');

    var params = buildDataParams();

    return Promise.resolve().then(function () {
      return global.PipstrideReplayData.getData(params);
    }).then(function (payload) {
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
        el.btnLoad.textContent = 'Muat Replay';
      }
      updatePeriodNotice();
    });
  }

  function loadCoverage() {
    return Promise.resolve().then(function () {
      if (!global.PipstrideReplayData) throw new Error('Sumber data replay tidak tersedia.');
      return global.PipstrideReplayData.getCoverage();
    }).then(function (cov) {
      coverage = cov;
      var def = cov.default_selection || {};
      if (def.timeframe) selectedTimeframe = def.timeframe;
      if (def.year && def.month) {
        selectedStartMonth = def.year + '-' + pad(def.month);
        selectedEndMonth = selectedStartMonth;
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

  function renderIndicatorSettings(useDefaults) {
    var key = el.indicatorSelected.value;
    var preferences = indicatorPreferences[key];
    var parameters = useDefaults ? global.ReplayIndicators.normalize(key) : preferences.parameters;
    el.indicatorSize.value = useDefaults ? 'default' : preferences.size;
    setText(el.indicatorDescription, el.indicatorSelected.selectedOptions[0].dataset.description);
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
      input.value = parameters[parameter.key];
      label.appendChild(input);
      el.indicatorParameters.appendChild(label);
    });
  }

  function setIndicatorEnabled(key, enabled) {
    indicatorPreferences[key].enabled = enabled;
    if (chartApi) chartApi.setIndicator(key, enabled);
    saveIndicatorPreferences();
  }

  function renderAppliedIndicators() {
    el.indicatorAppliedList.replaceChildren();
    Array.from(el.indicatorSelected.options).forEach(function (option) {
      var key = option.value;
      var preferences = indicatorPreferences[key];
      if (!preferences.applied) return;

      var row = document.createElement('li');
      var label = document.createElement('label');
      var toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = preferences.enabled;
      toggle.setAttribute('aria-label', 'Tampilkan ' + option.textContent);
      toggle.addEventListener('change', function () {
        setIndicatorEnabled(key, toggle.checked);
      });
      label.append(toggle, option.textContent);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Hapus';
      remove.setAttribute('aria-label', 'Hapus ' + option.textContent);
      remove.addEventListener('click', function () {
        preferences.applied = false;
        preferences.parameters = global.ReplayIndicators.normalize(key);
        preferences.size = 'default';
        setIndicatorEnabled(key, false);
        if (el.indicatorSelected.value === key) renderIndicatorSettings();
        renderAppliedIndicators();
        el.indicatorSelected.focus();
      });
      row.append(label, remove);
      el.indicatorAppliedList.appendChild(row);
    });
    el.indicatorEmpty.hidden = el.indicatorAppliedList.childElementCount > 0;
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
    Array.from(el.indicatorSelected.options).forEach(function (option) {
      var key = option.value;
      var stored = (saved && saved[key]) || {};
      indicatorPreferences[key] = {
        applied: stored.applied === true || stored.enabled === true,
        enabled: stored.enabled === true,
        parameters: api.normalize(key, stored.parameters),
        size: stored.size === 'small' || stored.size === 'large' ? stored.size : 'default'
      };
    });
    renderIndicatorSettings();
    renderAppliedIndicators();
    el.indicatorSelected.addEventListener('change', function () {
      renderIndicatorSettings();
    });
    el.indicatorSettings.addEventListener('input', function () {
      el.indicatorError.hidden = true;
    });

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
      var preferences = indicatorPreferences[key];
      preferences.applied = true;
      preferences.parameters = api.normalize(key, parameters);
      preferences.size = el.indicatorSize.value;
      if (chartApi) chartApi.configureIndicator(key, preferences);
      setIndicatorEnabled(key, true);
      renderAppliedIndicators();
      el.indicatorError.hidden = true;
    });
    el.indicatorReset.addEventListener('click', function () {
      renderIndicatorSettings(true);
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
        },
        onSelectionChange: function (id) {
          if (id != null && simulatorApi) simulatorApi.deselect();
          updateDeleteSelectedButton();
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
        onChange: persistSimulationChange,
        onSelectionChange: function (id) {
          if (id != null && drawingsApi) drawingsApi.deselect();
          updateDeleteSelectedButton();
        }
      });
    }

    chartApi.onFollowChange(function (following) {
      if (!following && toolsLocked) controller.pause();
    });

    return chartApi;
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

    var isPlaying = snapshot.state === 'PLAYING';
    setToolsLocked(isPlaying);

    // --- chart update --------------------------------------------------
    if (chartApi) {
      chartApi.seekTo(snapshot.index, { follow: chartApi.isFollowing() });
    }

    // --- transport bar -------------------------------------------------
    if (el.play) {
      el.play.textContent = isPlaying ? 'Pause' : 'Play';
      el.play.setAttribute('aria-label', isPlaying ? 'Jeda replay' : 'Putar replay');
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
      var active = Number(pills[i].getAttribute('data-speed')) === speed;
      pills[i].classList.toggle('is-active', active);
      pills[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  // ------------------------------------------------------------- user actions

  function onPlayToggle() {
    if (!active || !controller || !controller.isLoaded()) return;
    var snap = controller.snapshot();
    if (snap.state !== 'PLAYING' && mobileLayout.matches && !el.chartWrap.classList.contains('is-fullscreen')) {
      enterFullscreen();
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
    controller.setSpeed(Number(event.currentTarget.getAttribute('data-speed')));
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

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement;
  }

  function applyFullscreen(expanded, fallback) {
    var wasExpanded = el.chartWrap.classList.contains('is-fullscreen');
    el.chartWrap.classList.toggle('is-fullscreen', expanded);
    document.documentElement.classList.toggle('replay-expanded', expanded);
    if (global.frameElement) {
      global.frameElement.classList.toggle('replay-expanded', expanded && fallback);
    }
    if (expanded === wasExpanded) return;

    var hadFocus = el.transport.contains(document.activeElement) || document.activeElement === el.btnFullscreen;
    if (expanded) el.chartStack.prepend(el.transport);
    else el.timeline.before(el.transport);
    if (hadFocus) el.play.focus({ preventScroll: true });
    if (!expanded && mobileLayout.matches && toolsLocked) controller.pause();
    onResize();
  }

  async function enterFullscreen() {
    if (fullscreenRequest || !el.chartWrap) return;
    fullscreenRequest = true;
    var target = el.chartWrap;
    var request = target.requestFullscreen || target.webkitRequestFullscreen;
    try {
      if (request) await request.call(target);
      if (!active) {
        await exitFullscreen();
        return;
      }
      applyFullscreen(true, fullscreenElement() !== target);
    } catch {
      if (active) applyFullscreen(true, true);
    } finally {
      fullscreenRequest = false;
    }
  }

  async function exitFullscreen() {
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit && fullscreenElement() === el.chartWrap) {
      try {
        await exit.call(document);
      } catch {
        return;
      }
    }
    if (fullscreenElement() !== el.chartWrap) applyFullscreen(false, false);
  }

  function toggleFullscreen() {
    if (el.chartWrap.classList.contains('is-fullscreen')) exitFullscreen();
    else if (!mobileLayout.matches) enterFullscreen();
  }

  function onFullscreenChange() {
    if (fullscreenElement() === el.chartWrap) {
      if (!active) {
        exitFullscreen();
        return;
      }
      applyFullscreen(true, false);
      var orientation = global.screen.orientation;
      if (mobileLayout.matches && orientation && orientation.lock) {
        orientation.lock('landscape').catch(function () {});
      }
    } else if (!fullscreenRequest) {
      applyFullscreen(false, false);
    }
  }

  function setToolsLocked(locked) {
    if (toolsLocked === locked) return;
    toolsLocked = locked;
    if (el.dock) el.dock.inert = locked;
    if (el.indicatorsMenu) {
      el.indicatorsMenu.inert = locked;
      if (locked) el.indicatorsMenu.open = false;
    }
    if (canvasApi) canvasApi.setInteractive(!locked);
    if (chartApi) chartApi.setPlaying(locked);
    updateDeleteSelectedButton();
  }

  function onHudToggle() {
    if (!el.hud) return;
    var minimized = el.hud.classList.toggle('is-minimized');
    if (el.hudToggle) {
      el.hudToggle.setAttribute('aria-expanded', String(!minimized));
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
    updateDeleteSelectedButton();
  }

  function getSelectedObjectApi() {
    if (simulatorApi && simulatorApi.getSelectedId() != null) return simulatorApi;
    if (drawingsApi && drawingsApi.getSelectedId() != null) return drawingsApi;
    return null;
  }

  function updateDeleteSelectedButton() {
    show(el.deleteSelected, !toolsLocked && currentTool === 'cursor' && Boolean(getSelectedObjectApi()));
  }

  function deleteSelectedObject() {
    if (toolsLocked) return false;
    var selectedApi = getSelectedObjectApi();
    if (!selectedApi || !selectedApi.deleteSelected()) return false;
    if (selectedApi === simulatorApi) persistSimulationChange();
    else syncStorage();
    return true;
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
    if (event.key === 'Escape' && el.chartWrap.classList.contains('is-fullscreen')) {
      exitFullscreen();
      return;
    }

    // Alt + H -> Horizontal Line tool
    if (!toolsLocked && event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault();
        selectTool('hline');
        return;
      }
    }

    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.code === 'Space' || event.key === ' ') {
        if (event.target === el.deleteSelected) return;
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
      if (toolsLocked) return;
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
        if (!deleteSelectedObject()) onClearDrawings();
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
    el.monthStart = $('replay-month-start');
    el.monthEnd = $('replay-month-end');
    el.periodNotice = $('replay-period-notice');
    el.timeframes = $('replay-timeframes');
    el.btnLoad = $('replay-btn-load');
    el.btnFullscreen = $('replay-btn-fullscreen');
    el.exitFullscreen = $('replay-exit-fullscreen');

    // Banners
    el.warningsBanner = $('replay-warnings-banner');
    el.warningsText = $('replay-warnings-text');
    el.errorBanner = $('replay-error-banner');
    el.errorText = $('replay-error-text');

    // Transport
    el.transport = $('replay-transport');
    el.timeline = $('replay-timeline');
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
    el.chartStack = $('replay-chart-stack');
    el.dock = $('replay-dock');
    el.deleteSelected = $('replay-delete-selected');
    el.canvas = $('replay-drawing-canvas');
    el.chartContainer = $('replay-chart');
    el.loadedTimeframe = $('replay-loaded-timeframe');
    el.indicatorsMenu = $('replay-indicators-menu');
    el.indicatorPanes = $('replay-indicator-panes');
    el.indicatorLegend = $('replay-indicator-legend');
    el.indicatorSettings = $('replay-indicator-settings');
    el.indicatorSelected = $('replay-indicator-selected');
    el.indicatorDescription = $('replay-indicator-description');
    el.indicatorParameters = $('replay-indicator-parameters');
    el.indicatorSize = $('replay-indicator-size');
    el.indicatorError = $('replay-indicator-error');
    el.indicatorReset = $('replay-indicator-reset');
    el.indicatorAppliedList = $('replay-indicator-applied-list');
    el.indicatorEmpty = $('replay-indicator-empty');
    el.chartEmpty = $('replay-chart-empty');
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

    if (el.monthStart) {
      el.monthStart.addEventListener('change', function () {
        selectedStartMonth = el.monthStart.value;
        updatePeriodNotice();
      });
    }

    if (el.monthEnd) {
      el.monthEnd.addEventListener('change', function () {
        selectedEndMonth = el.monthEnd.value;
        updatePeriodNotice();
      });
    }

    if (el.timeframes) {
      el.timeframes.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-tf]');
        if (!btn || btn.disabled) return;
        selectedTimeframe = btn.getAttribute('data-tf');
        updateTimeframePills();
        populateMonthSelectors();
      });
    }

    if (el.btnLoad) el.btnLoad.addEventListener('click', loadData);
    if (el.btnFullscreen) el.btnFullscreen.addEventListener('click', toggleFullscreen);
    if (el.exitFullscreen) el.exitFullscreen.addEventListener('click', exitFullscreen);
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

    if (el.deleteSelected) el.deleteSelected.addEventListener('click', deleteSelectedObject);
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
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
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
      if (el.chartWrap.classList.contains('is-fullscreen')) exitFullscreen();
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
