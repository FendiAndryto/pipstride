/**
 * HTML5 Canvas Overlay & Coordinate Synchronizer for Replay Terminal (ticket T-SIM-04).
 *
 * Provides a high-performance, transparent <canvas> overlay positioned directly
 * over the Lightweight Charts viewport.
 *
 * Responsibilities:
 *  1. Pointer-events state machine:
 *     - 'cursor' mode: pointer-events: none; default pan/zoom in chart is 100% untouched.
 *     - Drawing/position modes: pointer-events: auto; cursor: crosshair; captures mouse events.
 *  2. DPI-aware rendering (devicePixelRatio scaling).
 *  3. Redraw loop synchronized to chart range changes and resize via requestAnimationFrame (60 FPS).
 *  4. Official coordinate conversion helpers bridging pixel (X, Y) <-> (Time, Price).
 */
(function (global) {
  'use strict';

  var DEFAULT_TOOL = 'cursor';
  var _setTimeout = typeof setTimeout !== 'undefined' ? setTimeout : function (fn) { return fn(); };
  var _clearTimeout = typeof clearTimeout !== 'undefined' ? clearTimeout : function () {};
  var raf = typeof global.requestAnimationFrame === 'function'
    ? function (fn) { return global.requestAnimationFrame(fn); }
    : function (fn) { return _setTimeout(fn, 16); };
  var caf = typeof global.cancelAnimationFrame === 'function'
    ? function (id) { return global.cancelAnimationFrame(id); }
    : function (id) { return _clearTimeout(id); };

  function init(options) {
    options = options || {};
    var canvas = options.canvas;
    var chartApi = options.chartApi;
    var container = options.container || (canvas ? canvas.parentElement : null);

    if (!canvas) {
      throw new Error('SmcReplayCanvas.init requires options.canvas');
    }

    var ctx = canvas.getContext('2d');
    var activeTool = options.activeTool || DEFAULT_TOOL;
    var selectionActive = false;
    var toolChangeListeners = [];
    var pointerListeners = [];
    var renderers = [];
    var rafId = null;
    var watchId = null;
    var lastPriceSignature = null;
    var redrawCount = 0;
    var isDestroyed = false;
    var interactive = true;

    // ------------------------------------------------------------- tool state

    function getActiveTool() {
      return activeTool;
    }

    function setTool(toolName) {
      if (!toolName) toolName = DEFAULT_TOOL;
      if (activeTool === toolName) return;

      activeTool = toolName;
      // Selection is owned by the drawing and simulator modules: their
      // toolChange listener deselects whenever a non-cursor tool is picked.
      // Clearing it unconditionally here broke the post-commit flow, because
      // onCommit() switches back to 'cursor' immediately after a shape or
      // position is placed — that disarmed the overlay (pointer-events: none)
      // and made the freshly drawn position impossible to grab or re-size.
      if (toolName !== 'cursor') {
        selectionActive = false;
      }
      updateCanvasPointerEvents();

      for (var i = 0; i < toolChangeListeners.length; i += 1) {
        try {
          toolChangeListeners[i](activeTool);
        } catch (err) {
          if (global.console && global.console.error) {
            global.console.error('toolChange listener failed', err);
          }
        }
      }

      requestRedraw();
    }

    function setSelectionActive(active) {
      selectionActive = Boolean(active);
      updateCanvasPointerEvents();
      requestRedraw();
    }

    function isSelectionActive() {
      return selectionActive;
    }

    function setCursor(cursorStyle) {
      if (canvas) {
        if (cursorStyle) {
          canvas.style.cursor = cursorStyle;
        } else {
          canvas.style.cursor = activeTool === 'cursor' ? (selectionActive ? 'default' : 'default') : 'crosshair';
        }
      }
    }

    function onToolChange(fn) {
      if (typeof fn === 'function') {
        toolChangeListeners.push(fn);
      }
    }

    function updateCanvasPointerEvents() {
      if (!canvas) return;
      if (!interactive) {
        canvas.style.pointerEvents = 'none';
        canvas.style.touchAction = '';
        return;
      }
      if (activeTool === 'cursor') {
        canvas.classList.remove('is-drawing');
        if (selectionActive) {
          canvas.classList.add('is-selecting');
          canvas.style.pointerEvents = 'auto';
          canvas.style.touchAction = 'none';
          canvas.style.cursor = 'default';
        } else {
          canvas.classList.remove('is-selecting');
          canvas.style.pointerEvents = 'none';
          canvas.style.touchAction = '';
          canvas.style.cursor = 'default';
        }
      } else {
        canvas.classList.remove('is-selecting');
        canvas.classList.add('is-drawing');
        canvas.style.pointerEvents = 'auto';
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'crosshair';
      }
    }

    // ------------------------------------------------------------- DPI & Sizing

    function resize() {
      if (isDestroyed || !canvas || !container) return;

      var rect = container.getBoundingClientRect();
      var width = Math.floor(rect.width);
      var height = Math.floor(rect.height);

      if (width <= 0 || height <= 0) return;

      var dpr = global.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';

      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
        ctx.scale(dpr, dpr);
      }

      requestRedraw();
    }

    // ------------------------------------------------------------- Redraw loop

    function requestRedraw() {
      if (isDestroyed || rafId != null) return;
      rafId = raf(performRedraw);
    }

    function performRedraw() {
      rafId = null;
      if (isDestroyed || !ctx || !canvas || !container) return;

      var rect = container.getBoundingClientRect();
      var width = rect.width;
      var height = rect.height;

      redrawCount += 1;
      ctx.clearRect(0, 0, width, height);

      // Invoke registered drawing renderers (for Fase 3 and Fase 4)
      for (var i = 0; i < renderers.length; i += 1) {
        try {
          renderers[i](ctx, {
            width: width,
            height: height,
            chartApi: chartApi,
            tool: activeTool
          });
        } catch (err) {
          if (global.console && global.console.error) {
            global.console.error('canvas renderer failed', err);
          }
        }
      }
    }

    function registerRenderer(fn) {
      if (typeof fn === 'function' && renderers.indexOf(fn) === -1) {
        renderers.push(fn);
        queueWatch();
        requestRedraw();
      }
    }

    function unregisterRenderer(fn) {
      var idx = renderers.indexOf(fn);
      if (idx !== -1) renderers.splice(idx, 1);
      if (!renderers.length) stopWatch();
    }

    // -------------------------------------------- price-scale drift guard
    // subscribeVisibleLogicalRangeChange does not fire when the vertical price
    // scale changes (autoscale on a new extreme, or a price-axis drag), which
    // would leave drawings vertically stale. Sampling one pane-edge price is a
    // cheap signature: it changes whenever the scale mapping changes, and the
    // loop only runs while at least one renderer is registered.
    function priceSignature() {
      if (!chartApi || typeof chartApi.coordinateToPrice !== 'function') return null;
      var price = chartApi.coordinateToPrice(1);
      if (price == null || isNaN(price)) return null;
      return Math.round(price * 1000);
    }

    function queueWatch() {
      if (isDestroyed || watchId != null || !renderers.length) return;
      lastPriceSignature = priceSignature();
      watchId = raf(watchTick);
    }

    function watchTick() {
      watchId = null;
      if (isDestroyed) return;
      var sig = priceSignature();
      if (sig !== lastPriceSignature) {
        lastPriceSignature = sig;
        requestRedraw();
      }
      if (renderers.length) watchId = raf(watchTick);
    }

    function stopWatch() {
      if (watchId != null) {
        caf(watchId);
        watchId = null;
      }
    }

    // -------------------------------------------------- coordinate converters

    function timeToCoordinate(time) {
      if (!chartApi) return null;
      return chartApi.timeToCoordinate ? chartApi.timeToCoordinate(time) : null;
    }

    function coordinateToTime(x) {
      if (!chartApi) return null;
      return chartApi.coordinateToTime ? chartApi.coordinateToTime(x) : null;
    }

    function priceToCoordinate(price) {
      if (!chartApi) return null;
      return chartApi.priceToCoordinate ? chartApi.priceToCoordinate(price) : null;
    }

    function coordinateToPrice(y) {
      if (!chartApi) return null;
      return chartApi.coordinateToPrice ? chartApi.coordinateToPrice(y) : null;
    }

    // ------------------------------------------------ pointer capture (drawing)
    // The overlay canvas is a child of #replay-chart, which owns the chart pan
    // gesture listener. Without stopPropagation a drawing-mode pointerdown also
    // arms that gesture (dragOrigin / isPriceScaleDrag), so a vertical stroke
    // can snap the viewport on pointerup. Capture the pointer and stop the
    // bubble while a drawing tool is active; cursor mode stays fully passthrough.

    function onPointer(fn) {
      if (typeof fn === 'function') pointerListeners.push(fn);
    }

    function emitPointer(type, event) {
      var rect = canvas.getBoundingClientRect();
      var x = (event.clientX || 0) - rect.left;
      var y = (event.clientY || 0) - rect.top;
      var payload = {
        type: type,
        tool: activeTool,
        x: x,
        y: y,
        time: coordinateToTime(x),
        price: coordinateToPrice(y),
        shiftKey: Boolean(event.shiftKey),
        altKey: Boolean(event.altKey),
        originalEvent: event
      };
      for (var i = 0; i < pointerListeners.length; i += 1) {
        try {
          pointerListeners[i](payload);
        } catch (err) {
          if (global.console && global.console.error) {
            global.console.error('pointer listener failed', err);
          }
        }
      }
    }

    function bindPointerEvents() {
      if (!canvas || !canvas.addEventListener) return;
      var types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
      for (var i = 0; i < types.length; i += 1) {
        (function (type) {
          canvas.addEventListener(type, function (event) {
            if (!interactive || (activeTool === 'cursor' && !selectionActive)) return;
            if (type === 'pointerdown' && event.button != null && event.button !== 0) return;
            if (event.stopPropagation) event.stopPropagation();
            if (event.cancelable && event.preventDefault) {
              event.preventDefault();
            }
            if (type === 'pointerdown' && canvas.setPointerCapture && event.pointerId != null) {
              try {
                canvas.setPointerCapture(event.pointerId);
              } catch {
                // pointer capture is best-effort; drawing still works without it
              }
            }
            emitPointer(type, event);
          });
        })(types[i]);
      }

      var preventTouch = function (event) {
        if (interactive && (activeTool !== 'cursor' || selectionActive)) {
          if (event.cancelable && event.preventDefault) {
            event.preventDefault();
          }
        }
      };
      canvas.addEventListener('touchstart', preventTouch, { passive: false });
      canvas.addEventListener('touchmove', preventTouch, { passive: false });
    }

    // ------------------------------------------------------------- Lifecycle

    updateCanvasPointerEvents();
    bindPointerEvents();
    resize();

    if (chartApi && chartApi.subscribeRange) {
      chartApi.subscribeRange(function () {
        requestRedraw();
      });
    }

    var resizeObserver = null;
    if (global.ResizeObserver && container) {
      resizeObserver = new global.ResizeObserver(function () {
        resize();
      });
      resizeObserver.observe(container);
    } else if (global.addEventListener) {
      global.addEventListener('resize', resize);
    }

    function destroy() {
      isDestroyed = true;
      stopWatch();
      if (rafId != null) {
        caf(rafId);
        rafId = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      } else if (global.removeEventListener) {
        global.removeEventListener('resize', resize);
      }
      toolChangeListeners = [];
      pointerListeners = [];
      renderers = [];
    }

    return {
      getCanvas: function () { return canvas; },
      getContext: function () { return ctx; },
      getActiveTool: getActiveTool,
      setTool: setTool,
      setInteractive: function (enabled) {
        interactive = enabled;
        updateCanvasPointerEvents();
      },
      onToolChange: onToolChange,
      onPointer: onPointer,
      getRedrawCount: function () { return redrawCount; },
      registerRenderer: registerRenderer,
      unregisterRenderer: unregisterRenderer,
      requestRedraw: requestRedraw,
      resize: resize,
      timeToCoordinate: timeToCoordinate,
      coordinateToTime: coordinateToTime,
      priceToCoordinate: priceToCoordinate,
      coordinateToPrice: coordinateToPrice,
      setSelectionActive: setSelectionActive,
      isSelectionActive: isSelectionActive,
      setCursor: setCursor,
      destroy: destroy
    };
  }

  global.SmcReplayCanvas = {
    init: init,
    DEFAULT_TOOL: DEFAULT_TOOL
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.SmcReplayCanvas;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
