/**
 * Pure Price Action Replay Terminal (Tickets T-PAR-08, T-PAR-09, T-PAR-10).
 *
 * Replaces old benchmark/equity/trade architecture with a pure price action
 * workstation:
 *  - Month range & timeframe selectors backed by the local data catalog
 *  - Responsive candlestick viewport and indicators with smart follow & snap
 *  - Optional candle details with UTC/local time, OHLC and range
 *  - Transport controls & full-featured scrubber with datetime tooltip
 *  - Seamless native Fullscreen (F / Esc)
 */
(function (global) {
  'use strict';

  var MAX_PERIOD_MONTHS = 12;
  var INDICATOR_TIME_FIELDS = new Set(['anchorTime', 'startTime', 'endTime']);
  var TOOL_INSTRUCTIONS = {
    brush: 'Seret pada chart untuk menggambar.',
    pitchfork: 'Pilih tiga titik pivot pada chart.',
    elliott_wave: 'Pilih titik awal, lalu titik gelombang 1 sampai 5.',
    risk_reward: 'Pilih harga entry, stop, lalu target.'
  };

  var MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  var el = {};
  var controller = null;
  var chartApi = null;
  var indicatorPreferences = [];
  var indicatorCatalog = new Map();
  var editingIndicator = null;
  var indicatorTimePick = null;
  var canvasApi = null;
  var drawingsApi = null;
  var simulatorApi = null;
  var currentTool = 'cursor';
  var coverage = null;
  var currentPayload = null;
  var currentPayloadPeriod = '';
  var hoveredCandle = null;
  var periodStorage = null;
  var simulationIndex = -1;
  var processedUntil = null;
  var legacyUntil = null;
  var projectedSimulation = false;
  var loading = false;
  var active = false;
  var storageNamespace;
  var fullscreenRequest = false;
  var playbackActive = false;
  var drawingSnapshot = '[]';
  var drawingUndo = [];
  var drawingRedo = [];

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

  function loadedPeriodMonths() {
    var meta = currentPayload.meta;
    if (meta.period_mode === 'month') {
      var month = meta.year + '-' + pad(meta.month);
      return [month, month];
    }
    return [meta.requested_start_date.slice(0, 7), meta.requested_end_date.slice(0, 7)];
  }

  function updateChartTimeframe() {
    if (!currentPayload) return;
    var months = loadedPeriodMonths();
    var options = coverage.timeframes.map(function (timeframe) {
      var option = new Option(timeframe, timeframe);
      option.disabled = months.some(function (month) { return !availableMonths(timeframe).includes(month); });
      return option;
    });
    el.chartTimeframe.replaceChildren.apply(el.chartTimeframe, options);
    el.chartTimeframe.value = currentPayload.meta.timeframe;
    el.chartTimeframe.disabled = loading;
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

  function loadData(event) {
    if (loading || !updatePeriodNotice()) return;
    finishIndicatorTimePick(null, false);
    var fromSettings = event?.currentTarget === el.btnLoad;
    loading = true;
    el.chartTimeframe.disabled = true;
    el.chartNotice.hidden = true;

    if (el.btnLoad) {
      el.btnLoad.disabled = true;
      el.btnLoad.textContent = 'Memuat…';
    }
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
      if (fromSettings && el.chartOptions.open) {
        el.chartOptions.open = false;
        el.chartOptions.querySelector('summary').focus();
      }
    }).catch(function (err) {
      var msg = (err && err.message) ? err.message : String(err);
      setText(el.chartNotice, msg);
      el.chartNotice.hidden = false;
      setStatus('Gagal memuat: ' + msg, 'error');
    }).finally(function () {
      loading = false;
      if (el.btnLoad) {
        el.btnLoad.textContent = 'Muat Replay';
      }
      updatePeriodNotice();
      updateChartTimeframe();
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
      var message = 'Gagal memuat cakupan data: ' + (err && err.message ? err.message : err);
      setStatus(message, 'error');
      setText(el.chartNotice, message);
      el.chartNotice.hidden = false;
    });
  }

  // ------------------------------------------------------------- chart & HUD

  function barEnd(candle, timeframe) {
    timeframe = timeframe || currentPayload.meta.timeframe;
    var unit = timeframe[0];
    var scale = unit === 'D' ? 86400 : unit === 'H' ? 3600 : 60;
    return candle.time + Number(timeframe.slice(1)) * scale;
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

  function rememberDrawings() {
    var next = JSON.stringify(drawingsApi.getDrawings());
    if (next === drawingSnapshot) return;
    drawingUndo.push(drawingSnapshot);
    if (drawingUndo.length > 100) drawingUndo.shift();
    drawingRedo.length = 0;
    drawingSnapshot = next;
    syncStorage();
    updateDrawingObjects();
  }

  function restoreDrawings(from, to) {
    if (!drawingsApi || !from.length) return;
    to.push(drawingSnapshot);
    drawingSnapshot = from.pop();
    drawingsApi.setDrawings(JSON.parse(drawingSnapshot));
    syncStorage();
    updateDrawingObjects();
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

  function restoreSimulation(candles, switchPoint) {
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
    simulationIndex = switchPoint ? switchPoint.index : processedUntil == null ? 0 : resumeIndex(candles, processedUntil);
    var cursor = candles[simulationIndex];
    var end = barEnd(cursor);
    if ((switchPoint ? switchPoint.cutoff : processedUntil) > end) {
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
      global.localStorage.setItem(storageNamespace + 'indicators:v2', JSON.stringify(indicatorPreferences));
    } catch {
      // Settings still work for this session if browser storage is unavailable.
    }
  }

  function loadIndicatorPreferences(version) {
    try {
      return JSON.parse(global.localStorage.getItem(storageNamespace + 'indicators:' + version));
    } catch {
      return null;
    }
  }

  function renderIndicatorSettings(useDefaults) {
    var api = global.ReplayIndicators;
    var type = el.indicatorSelected.value;
    var option = indicatorCatalog.get(type);
    var preferences = useDefaults ? null : editingIndicator;
    var parameters = preferences ? preferences.parameters : api.normalize(type);
    el.indicatorSize.value = preferences ? preferences.size : 'default';
    el.indicatorPlacement.value = preferences ? preferences.placement : api.placement(type);
    var profile = type === 'fixed-volume-profile' || type === 'session-volume-profile';
    el.indicatorPlacement.closest('label').hidden = profile;
    el.indicatorSize.closest('label').hidden = profile;
    el.indicatorApply.disabled = !option;
    el.indicatorReset.disabled = !option;
    el.indicatorCancel.hidden = !editingIndicator;
    setText(el.indicatorApply, editingIndicator ? 'Simpan' : 'Tambah');
    setText(el.indicatorDescription, option ? option.dataset.description : 'Indikator tidak ditemukan.');
    el.indicatorError.hidden = true;
    el.indicatorParameters.replaceChildren();
    (api.parameters[type] || []).forEach(function (parameter) {
      if (INDICATOR_TIME_FIELDS.has(parameter.key)) {
        renderIndicatorTimeField(parameter, parameters[parameter.key]);
        return;
      }
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

  function renderIndicatorTimeField(parameter, value) {
    var field = document.createElement('div');
    field.className = 'replay-indicator-time-field';
    var label = document.createElement('span');
    label.textContent = parameter.label;
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = parameter.key;
    input.value = value;
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = value > 0 ? formatUtc(value) : 'Pilih candle';
    button.addEventListener('click', function () {
      if (!chartApi || !controller.isLoaded()) {
        setText(el.indicatorError, 'Muat data Replay sebelum memilih candle.');
        el.indicatorError.hidden = false;
        return;
      }
      controller.pause();
      selectTool('cursor');
      if (drawingsApi) drawingsApi.deselect();
      if (simulatorApi) simulatorApi.deselect();
      indicatorTimePick = { input: input, button: button };
      setText(el.indicatorPickLabel, 'Pilih candle di chart · ' + parameter.label);
      el.indicatorPick.hidden = false;
      el.chartContainer.classList.add('is-picking-candle');
      el.indicatorsMenu.open = false;
      el.indicatorPickCurrent.focus();
    });
    field.append(label, button, input);
    el.indicatorParameters.appendChild(field);
  }

  function finishIndicatorTimePick(candle, reopenMenu) {
    if (!indicatorTimePick) return;
    var pick = indicatorTimePick;
    indicatorTimePick = null;
    el.indicatorPick.hidden = true;
    el.chartContainer.classList.remove('is-picking-candle');
    if (candle) {
      pick.input.value = candle.time;
      pick.button.textContent = formatUtc(candle.time);
      el.indicatorError.hidden = true;
    }
    if (reopenMenu) {
      global.requestAnimationFrame(function () {
        if (!active || !pick.button.isConnected) return;
        openChartMenu(el.indicatorsMenu);
        pick.button.focus();
      });
    }
  }

  function filterIndicatorCatalog() {
    var query = el.indicatorSearch.value.trim().toLowerCase();
    var selected = el.indicatorSelected.value;
    var matches = Array.from(indicatorCatalog.values()).filter(function (option) {
      return (option.textContent + ' ' + option.dataset.description).toLowerCase().includes(query);
    });
    el.indicatorSelected.replaceChildren.apply(el.indicatorSelected, matches);
    if (matches.some(function (option) { return option.value === selected; })) el.indicatorSelected.value = selected;
  }

  function newIndicatorId() {
    var index = 1;
    while (indicatorPreferences.some(function (instance) { return instance.id === 'instance-' + index; })) index += 1;
    return 'instance-' + index;
  }

  function renderAppliedIndicators() {
    el.indicatorAppliedList.replaceChildren();
    indicatorPreferences.forEach(function (preferences) {
      var option = indicatorCatalog.get(preferences.type);
      var values = Object.entries(preferences.parameters).filter(function (entry) {
        return !INDICATOR_TIME_FIELDS.has(entry[0]);
      }).map(function (entry) { return entry[1]; });
      var title = option.textContent + (values.length ? ' (' + values.join(', ') + ')' : '');

      var row = document.createElement('li');
      var label = document.createElement('label');
      var toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = preferences.enabled;
      toggle.setAttribute('aria-label', 'Tampilkan ' + title);
      toggle.addEventListener('change', function () {
        preferences.enabled = toggle.checked;
        applyIndicatorVisibility(preferences);
        saveIndicatorPreferences();
      });
      label.append(toggle, title);

      var actions = document.createElement('span');
      actions.className = 'replay-indicator-row-actions';
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', 'Edit ' + title);
      edit.addEventListener('click', function () {
        editingIndicator = preferences;
        el.indicatorSearch.value = '';
        filterIndicatorCatalog();
        el.indicatorSelected.value = preferences.type;
        renderIndicatorSettings();
        var input = el.indicatorParameters.querySelector('input') || el.indicatorSize;
        input.focus();
      });

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Hapus';
      remove.setAttribute('aria-label', 'Hapus ' + title);
      remove.addEventListener('click', function () {
        indicatorPreferences = indicatorPreferences.filter(function (instance) { return instance !== preferences; });
        if (chartApi) chartApi.removeIndicator(preferences.id);
        if (editingIndicator === preferences) {
          editingIndicator = null;
          renderIndicatorSettings();
        }
        saveIndicatorPreferences();
        renderAppliedIndicators();
        el.indicatorSelected.focus();
      });
      actions.append(edit, remove);
      row.append(label, actions);
      el.indicatorAppliedList.appendChild(row);
    });
    el.indicatorEmpty.hidden = el.indicatorAppliedList.childElementCount > 0;
  }

  function applyIndicatorVisibility(preferences) {
    if (chartApi) chartApi.setIndicator(preferences.id, preferences.enabled && el.showIndicators.checked);
  }

  function bindIndicatorSettings() {
    var api = global.ReplayIndicators;
    if (!api || !el.indicatorSettings) return;
    Array.from(el.indicatorSelected.options).forEach(function (option) {
      indicatorCatalog.set(option.value, option);
    });
    var saved = loadIndicatorPreferences('v2');
    indicatorPreferences = api.preferences(saved, Array.isArray(saved) ? null : loadIndicatorPreferences('v1'))
      .filter(function (instance) { return indicatorCatalog.has(instance.type); });
    if (!Array.isArray(saved) && indicatorPreferences.length) saveIndicatorPreferences();

    el.indicatorCancel = document.createElement('button');
    el.indicatorCancel.type = 'button';
    el.indicatorCancel.textContent = 'Batal';
    el.indicatorReset.after(el.indicatorCancel);
    renderIndicatorSettings();
    renderAppliedIndicators();
    el.indicatorPickCurrent.addEventListener('click', function () {
      finishIndicatorTimePick(controller.snapshot().candle, true);
    });
    $('replay-indicator-pick-cancel').addEventListener('click', function () { finishIndicatorTimePick(null, true); });
    el.indicatorCancel.addEventListener('click', function () {
      editingIndicator = null;
      renderIndicatorSettings();
      el.indicatorSelected.focus();
    });
    el.indicatorSelected.addEventListener('change', function () {
      editingIndicator = null;
      renderIndicatorSettings();
    });
    el.indicatorSearch.addEventListener('input', function () {
      editingIndicator = null;
      filterIndicatorCatalog();
      renderIndicatorSettings();
    });
    el.indicatorSettings.addEventListener('input', function () {
      el.indicatorError.hidden = true;
    });

    el.indicatorSettings.addEventListener('submit', function (event) {
      event.preventDefault();
      var key = el.indicatorSelected.value;
      if (!indicatorCatalog.has(key)) return;
      var parameters = {};
      el.indicatorParameters.querySelectorAll('input').forEach(function (input) {
        parameters[input.name] = Number(input.value);
      });
      var message = '';
      var missingTime = Object.keys(parameters).some(function (name) {
        return INDICATOR_TIME_FIELDS.has(name) && !(parameters[name] > 0);
      });
      if (missingTime) {
        message = 'Pilih candle untuk setiap titik waktu indikator.';
      } else if (key === 'fixed-volume-profile' && parameters.startTime > parameters.endTime) {
        message = 'Candle akhir harus sama dengan atau setelah candle mulai.';
      } else if (key === 'macd' && parameters.fast >= parameters.slow) {
        message = 'Periode cepat harus lebih kecil dari periode lambat.';
      } else if (key === 'rsi' && parameters.lower >= parameters.upper) {
        message = 'Batas bawah harus lebih kecil dari batas atas.';
      }
      if (message) {
        setText(el.indicatorError, message);
        el.indicatorError.hidden = false;
        return;
      }
      var preferences = editingIndicator;
      if (!preferences) {
        preferences = { id: newIndicatorId(), type: key, enabled: true };
        indicatorPreferences.push(preferences);
      }
      preferences.parameters = api.normalize(key, parameters);
      preferences.size = el.indicatorSize.value;
      preferences.placement = el.indicatorPlacement.value;
      if (chartApi) {
        chartApi.configureIndicator(preferences.id, preferences);
        applyIndicatorVisibility(preferences);
      }
      saveIndicatorPreferences();
      editingIndicator = null;
      renderAppliedIndicators();
      renderIndicatorSettings();
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
    chartApi.setChartType($('replay-chart-type').value);
    chartApi.onCandleHover(function (candle) {
      hoveredCandle = candle;
      renderCrosshairValues(controller.snapshot().candle);
    });
    chartApi.onCandleClick(function (candle) {
      if (active && candle) finishIndicatorTimePick(candle, true);
    });

    indicatorPreferences.forEach(function (preferences) {
      chartApi.configureIndicator(preferences.id, preferences);
      applyIndicatorVisibility(preferences);
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
        onCommit: function (item) {
          selectTool('cursor');
          rememberDrawings();
          if (item && item.type === 'text') {
            drawingsApi.selectDrawing(item.id);
            openChartMenu(el.chartOptions);
            el.drawingObjects.open = true;
            el.drawingText.focus();
            el.drawingText.select();
          }
        },
        onChange: rememberDrawings,
        onSelectionChange: function (id) {
          if (id != null && simulatorApi) simulatorApi.deselect();
          updateDeleteSelectedButton();
          updateDrawingObjects();
        }
      });
      drawingsApi.setSnapEnabled(el.drawingSnap.checked);
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

    if (drawingsApi && simulatorApi) {
      canvasApi.onPointer(function (pointer) {
        // The overlay consumes this click while a different object is selected.
        // Reuse the chart's hit testing if the active object just yielded selection.
        if (pointer.type !== 'pointerdown' || pointer.tool !== 'cursor' || getSelectedObjectApi()) return;
        var click = { point: { x: pointer.x, y: pointer.y } };
        drawingsApi.handleChartClick(click);
        simulatorApi.handleChartClick(click);
      });
    }

    chartApi.onFollowChange(function (following) {
      if (!following && playbackActive) controller.pause();
    });

    return chartApi;
  }

  function mountPayload(payload) {
    var api = ensureChart();
    if (!api) return;

    var meta = payload.meta;
    var period = meta.period_mode === 'month'
      ? [meta.symbol, meta.period_mode, meta.year, meta.month].join('/')
      : [meta.symbol, meta.period_mode, meta.requested_start_date, meta.requested_end_date].join('/');
    var switchPoint = null;
    var previousCandle = controller.snapshot().candle;
    if (currentPayloadPeriod === period && previousCandle && currentPayload.meta.timeframe !== meta.timeframe) {
      var cutoff = barEnd(previousCandle);
      var index = payload.candles.findIndex(function (candle) { return barEnd(candle, meta.timeframe) > cutoff; });
      if (index === 0) throw new Error('Jalankan replay sampai satu candle ' + meta.timeframe + ' selesai sebelum mengganti timeframe.');
      switchPoint = { index: index < 0 ? payload.candles.length - 1 : index - 1, cutoff: cutoff };
    }

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
    hoveredCandle = null;
    periodStorage = global.SmcReplayStorage ? global.SmcReplayStorage.forPeriod(payload.meta, storageNamespace) : null;
    if (drawingsApi && currentPayloadPeriod !== period) {
      if (periodStorage) drawingsApi.setDrawings(periodStorage.loadDrawings());
      drawingSnapshot = JSON.stringify(drawingsApi.getDrawings());
      drawingUndo.length = 0;
      drawingRedo.length = 0;
      updateDrawingObjects();
    }
    currentPayloadPeriod = period;
    var startIndex = restoreSimulation(payload.candles, switchPoint);
    api.setData(payload.candles);
    controller.load(payload, startIndex);

    renderScrubberLimits(payload.candles);
    render(controller.snapshot());
    api.snapToActive();
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
    setPlaybackActive(isPlaying);

    // --- chart update --------------------------------------------------
    if (chartApi) {
      chartApi.seekTo(snapshot.index, { follow: chartApi.isFollowing() });
    }
    renderCrosshairValues(snapshot.candle);

    // --- transport bar -------------------------------------------------
    if (el.play) {
      el.play.textContent = isPlaying ? 'Pause' : 'Play';
      el.play.setAttribute('aria-label', isPlaying ? 'Jeda replay' : 'Putar replay');
      el.play.classList.toggle('is-playing', isPlaying);
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

    el.speeds.value = String(snapshot.speed);
    if (el.chartOptions.open && el.candleDetails.open) renderCandleDetails(snapshot.candle);
  }

  function renderCandleDetails(candle) {
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

  function renderCrosshairValues(activeCandle) {
    var candle = activeCandle && hoveredCandle && hoveredCandle.time <= activeCandle.time ? hoveredCandle : activeCandle;
    var output = $('replay-crosshair-values');
    output.hidden = !candle;
    if (candle) {
      setText(output, ['open', 'high', 'low', 'close'].map(function (key) {
        return key[0].toUpperCase() + ' ' + formatPrice(candle[key]);
      }).join('   ·   '));
    }
  }

  // ------------------------------------------------------------- user actions

  function onPlayToggle() {
    if (!active || !controller || !controller.isLoaded()) return;
    var snap = controller.snapshot();
    render(controller.toggle());
    if (snap.state === 'PLAYING') syncSimulation();
  }

  function onStep(delta) {
    if (!controller || !controller.isLoaded()) return;
    render(controller.step(delta));
  }

  function onSpeedChange() {
    if (!controller) return;
    controller.setSpeed(Number(el.speeds.value));
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
    el.chartWrap.classList.toggle('is-fullscreen', expanded);
    document.documentElement.classList.toggle('replay-expanded', expanded);
    if (global.frameElement) {
      global.frameElement.classList.toggle('replay-expanded', expanded && fallback);
    }
    var label = expanded ? 'Keluar dari layar penuh' : 'Layar penuh';
    el.btnFullscreen.setAttribute('aria-pressed', String(expanded));
    el.btnFullscreen.setAttribute('aria-label', label);
    el.btnFullscreen.title = label + ' (F)';
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
    else enterFullscreen();
  }

  function onFullscreenChange() {
    if (fullscreenElement() === el.chartWrap) {
      if (!active) {
        exitFullscreen();
        return;
      }
      applyFullscreen(true, false);
    } else if (!fullscreenRequest) {
      applyFullscreen(false, false);
    }
  }

  function setPlaybackActive(playing) {
    if (playbackActive === playing) return;
    playbackActive = playing;
    if (chartApi) chartApi.setPlaying(playing);
  }

  function toggleCandleDetails() {
    if (el.chartOptions.open && el.candleDetails.open) {
      el.chartOptions.open = false;
      return;
    }
    openChartMenu(el.chartOptions);
    el.candleDetails.open = true;
    el.candleDetails.querySelector('summary').focus();
  }

  function selectTool(toolName) {
    currentTool = toolName || 'cursor';
    if (currentTool !== 'cursor') finishIndicatorTimePick(null, false);
    el.toolButtons.forEach(function (button, tool) {
      button.setAttribute('aria-pressed', String(tool === currentTool));
    });
    var label = currentTool === 'cursor' ? 'Alat gambar dan simulasi' : 'Alat aktif: ' + el.toolButtons.get(currentTool).textContent;
    el.toolsToggle.toggleAttribute('data-tool-active', currentTool !== 'cursor');
    el.toolsToggle.title = label;
    el.toolsToggle.setAttribute('aria-label', label);
    var instruction = TOOL_INSTRUCTIONS[currentTool] || '';
    setText(el.toolInstruction, instruction);
    el.toolInstruction.hidden = !instruction;
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
    show(el.deleteSelected, currentTool === 'cursor' && Boolean(getSelectedObjectApi()));
  }

  function deleteSelectedObject() {
    var selectedApi = getSelectedObjectApi();
    if (!selectedApi || !selectedApi.deleteSelected()) return false;
    if (selectedApi === simulatorApi) persistSimulationChange();
    else rememberDrawings();
    return true;
  }

  function onClearDrawings() {
    if (!drawingsApi) return;
    drawingsApi.clearDrawings();
    if (canvasApi) canvasApi.requestRedraw();
    rememberDrawings();
  }

  function updateDrawingObjects() {
    if (!drawingsApi) return;
    var selected = drawingsApi.getSelectedId();
    var options = drawingsApi.getDrawings().map(function (drawing, index) {
      var tool = el.toolButtons.get(drawing.type);
      var name = drawing.type === 'text' && drawing.text ? drawing.text : (tool?.textContent || drawing.type);
      return new Option((index + 1) + '. ' + name + (drawing.hidden ? ' (tersembunyi)' : ''), drawing.id);
    });
    el.drawingList.replaceChildren.apply(el.drawingList, options);
    el.drawingList.value = selected || '';
    var drawing = drawingsApi.getDrawings().find(function (item) { return item.id === selected; });
    el.drawingProperties.disabled = !drawing;
    el.drawingUndo.disabled = !drawingUndo.length;
    el.drawingRedo.disabled = !drawingRedo.length;
    if (!drawing) return;
    el.drawingColor.value = /^#[\da-f]{6}$/i.test(drawing.color) ? drawing.color : '#45e0ad';
    el.drawingWidth.value = drawing.lineWidth || 2;
    el.drawingStyle.value = drawing.lineStyle || 'solid';
    el.drawingTextField.hidden = drawing.type !== 'text';
    el.drawingText.value = drawing.text || '';
    el.drawingHidden.checked = Boolean(drawing.hidden);
    el.drawingLocked.checked = Boolean(drawing.locked);
  }

  function exportChart() {
    if (!chartApi || chartApi.getWatermark() < 0) return;
    var status = $('replay-chart-export-status');
    status.hidden = false;
    status.textContent = 'Menyiapkan gambar…';
    if (canvasApi) canvasApi.requestRedraw();
    global.requestAnimationFrame(function () {
      try {
        var main = chartApi.getChart().takeScreenshot();
        var panes = chartApi.getIndicatorScreenshots();
        var output = document.createElement('canvas');
        output.width = main.width;
        output.height = main.height + panes.reduce(function (sum, pane) { return sum + pane.height; }, 0);
        var context = output.getContext('2d');
        context.drawImage(main, 0, 0);
        if (el.canvas.width && el.canvas.height) context.drawImage(el.canvas, 0, 0, main.width, main.height);
        var y = main.height;
        panes.forEach(function (pane) {
          context.drawImage(pane, 0, y, output.width, pane.height);
          y += pane.height;
        });
        output.toBlob(function (blob) {
          if (!blob) {
            status.textContent = 'Gambar chart gagal dibuat.';
            return;
          }
          var url = URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.href = url;
          link.download = 'pipstride-xauusd-' + currentPayload.meta.timeframe + '.png';
          link.click();
          global.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          status.textContent = 'Gambar chart siap diunduh.';
        }, 'image/png');
      } catch {
        status.textContent = 'Gambar chart gagal dibuat.';
      }
    });
  }

  function bindAnalysisControls() {
    el.chartTimeframe.addEventListener('change', function () {
      var months = loadedPeriodMonths();
      selectedStartMonth = months[0];
      selectedEndMonth = months[1];
      selectedTimeframe = el.chartTimeframe.value;
      updateTimeframePills();
      populateMonthSelectors();
      loadData();
    });
    $('replay-chart-type').addEventListener('change', function (event) {
      if (!chartApi) return;
      chartApi.setChartType(event.target.value);
      if (canvasApi) canvasApi.requestRedraw();
    });
    $('replay-chart-grid').addEventListener('change', function (event) {
      if (chartApi) chartApi.setGridVisible(event.target.checked);
    });
    $('replay-chart-scale').addEventListener('change', function (event) {
      if (chartApi) chartApi.setScaleMode(event.target.value);
      if (canvasApi) canvasApi.requestRedraw();
    });
    $('replay-chart-reset').addEventListener('click', function () { if (chartApi) chartApi.resetView(); });
    $('replay-chart-export').addEventListener('click', exportChart);
    el.toolsMenu.addEventListener('click', function (event) {
      var tool = event.target.closest('[data-tool]');
      if (tool) {
        selectTool(tool.dataset.tool);
        el.toolsMenu.open = false;
        el.toolsToggle.focus();
      } else if (event.target.closest('[data-action="clear"]')) {
        onClearDrawings();
      }
    });
    el.showIndicators.addEventListener('change', function () {
      indicatorPreferences.forEach(applyIndicatorVisibility);
    });
    el.drawingSnap.addEventListener('change', function () { if (drawingsApi) drawingsApi.setSnapEnabled(el.drawingSnap.checked); });
    el.drawingList.addEventListener('change', function () { if (drawingsApi) drawingsApi.selectDrawing(el.drawingList.value); });
    el.drawingUndo.addEventListener('click', function () { restoreDrawings(drawingUndo, drawingRedo); });
    el.drawingRedo.addEventListener('click', function () { restoreDrawings(drawingRedo, drawingUndo); });
    $('replay-drawing-duplicate').addEventListener('click', function () { drawingsApi.duplicateDrawing(drawingsApi.getSelectedId()); });
    $('replay-drawing-remove').addEventListener('click', deleteSelectedObject);
    [
      [el.drawingColor, 'color'], [el.drawingWidth, 'lineWidth'], [el.drawingStyle, 'lineStyle'],
      [el.drawingText, 'text'], [el.drawingHidden, 'hidden'], [el.drawingLocked, 'locked']
    ].forEach(function (binding) {
      var input = binding[0];
      var field = binding[1];
      input.addEventListener('change', function () {
        if (!input.reportValidity()) return;
        var value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.valueAsNumber : input.value;
        drawingsApi.updateDrawing(drawingsApi.getSelectedId(), { [field]: value });
      });
    });
    document.addEventListener('click', function (event) {
      el.chartMenus.forEach(function (menu) {
        if (menu.contains(event.target)) return;
        if (menu === el.chartOptions && document.activeElement === el.drawingText && el.chartContainer.contains(event.target)) return;
        menu.open = false;
      });
    });
    el.chartMenus.forEach(function (menu) {
      menu.addEventListener('toggle', function () {
        if (menu.open) finishIndicatorTimePick(null, false);
      });
      menu.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !menu.open) return;
        event.preventDefault();
        var details = event.target.closest('details[open]') || menu;
        details.open = false;
        details.querySelector('summary').focus();
      });
    });
    [el.chartOptions, el.candleDetails].forEach(function (details) {
      details.addEventListener('toggle', function () {
        if (el.chartOptions.open && el.candleDetails.open) renderCandleDetails(controller.snapshot().candle);
      });
    });
  }

  function openChartMenu(target) {
    el.chartMenus.forEach(function (menu) { menu.open = menu === target; });
  }

  function onKeyDown(event) {
    if (!active || event.defaultPrevented) return;
    if (indicatorTimePick && event.key === 'Escape') {
      event.preventDefault();
      finishIndicatorTimePick(null, true);
      return;
    }
    if (el.indicatorsMenu && el.indicatorsMenu.contains(event.target)) return;
    if (isTypingTarget(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) restoreDrawings(drawingRedo, drawingUndo);
      else restoreDrawings(drawingUndo, drawingRedo);
      return;
    }
    if (event.key === 'Escape' && el.chartWrap.classList.contains('is-fullscreen')) {
      exitFullscreen();
      return;
    }

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
        if (event.target.closest?.('button, summary')) return;
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
        toggleCandleDetails();
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
        deleteSelectedObject();
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

    // Selectors
    el.monthStart = $('replay-month-start');
    el.monthEnd = $('replay-month-end');
    el.periodNotice = $('replay-period-notice');
    el.timeframes = $('replay-timeframes');
    el.btnLoad = $('replay-btn-load');
    el.btnFullscreen = $('replay-btn-fullscreen');

    // Banners
    el.warningsBanner = $('replay-warnings-banner');
    el.warningsText = $('replay-warnings-text');

    // Transport
    el.stepBack = $('replay-step-back');
    el.play = $('replay-play');
    el.stepForward = $('replay-step-forward');
    el.position = $('replay-position');
    el.speeds = $('replay-speeds');

    // Scrubber
    el.scrubberWrap = $('replay-scrubber-wrap');
    el.scrubberFill = $('replay-scrubber-fill');
    el.scrubber = $('replay-scrubber');
    el.scrubberTooltip = $('replay-scrubber-tooltip');
    el.status = $('replay-status');

    // Chart controls and data
    el.chartWrap = $('replay-chart-wrap');
    el.chartTimeframe = $('replay-chart-timeframe');
    el.chartNotice = $('replay-chart-notice');
    el.toolsMenu = $('replay-tools-menu');
    el.toolsToggle = $('replay-tools-toggle');
    el.toolInstruction = $('replay-tool-instruction');
    el.chartOptions = $('replay-chart-options');
    el.candleDetails = $('replay-candle-details');
    el.indicatorsMenu = $('replay-indicators-menu');
    el.showIndicators = $('replay-show-indicators');
    el.chartMenus = [el.toolsMenu, el.indicatorsMenu, el.chartOptions];
    el.toolButtons = new Map(Array.from(el.toolsMenu.querySelectorAll('[data-tool]'), function (button) {
      return [button.dataset.tool, button];
    }));
    el.drawingSnap = $('replay-drawing-snap');
    el.drawingObjects = $('replay-drawing-objects');
    el.drawingList = $('replay-drawing-list');
    el.drawingProperties = $('replay-drawing-properties');
    el.drawingUndo = $('replay-drawing-undo');
    el.drawingRedo = $('replay-drawing-redo');
    el.drawingColor = $('replay-drawing-color');
    el.drawingWidth = $('replay-drawing-width');
    el.drawingStyle = $('replay-drawing-style');
    el.drawingTextField = $('replay-drawing-text-field');
    el.drawingText = $('replay-drawing-text');
    el.drawingHidden = $('replay-drawing-hidden');
    el.drawingLocked = $('replay-drawing-locked');
    el.deleteSelected = $('replay-delete-selected');
    el.canvas = $('replay-drawing-canvas');
    el.chartContainer = $('replay-chart');
    el.indicatorPanes = $('replay-indicator-panes');
    el.indicatorLegend = $('replay-indicator-legend');
    el.indicatorSettings = $('replay-indicator-settings');
    el.indicatorSearch = $('replay-indicator-search');
    el.indicatorSelected = $('replay-indicator-selected');
    el.indicatorDescription = $('replay-indicator-description');
    el.indicatorParameters = $('replay-indicator-parameters');
    el.indicatorPick = $('replay-indicator-pick');
    el.indicatorPickLabel = $('replay-indicator-pick-label');
    el.indicatorPickCurrent = $('replay-indicator-pick-current');
    el.indicatorSize = $('replay-indicator-size');
    el.indicatorPlacement = $('replay-indicator-placement');
    el.indicatorApply = $('replay-indicator-apply');
    el.indicatorError = $('replay-indicator-error');
    el.indicatorReset = $('replay-indicator-reset');
    el.indicatorAppliedList = $('replay-indicator-applied-list');
    el.indicatorEmpty = $('replay-indicator-empty');
    el.chartEmpty = $('replay-chart-empty');
    el.hudTimeUtc = $('replay-hud-time-utc');
    el.hudTimeLocal = $('replay-hud-time-local');
    el.hudOpen = $('replay-hud-open');
    el.hudHigh = $('replay-hud-high');
    el.hudLow = $('replay-hud-low');
    el.hudClose = $('replay-hud-close');
    el.hudRange = $('replay-hud-range');
  }

  function bindEvents() {
    bindAnalysisControls();
    bindIndicatorSettings();

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

    if (el.deleteSelected) el.deleteSelected.addEventListener('click', deleteSelectedObject);
    if (el.play) el.play.addEventListener('click', onPlayToggle);
    if (el.stepBack) el.stepBack.addEventListener('click', function () { onStep(-1); });
    if (el.stepForward) el.stepForward.addEventListener('click', function () { onStep(1); });

    el.speeds.addEventListener('change', onSpeedChange);

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
      finishIndicatorTimePick(null, false);
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
