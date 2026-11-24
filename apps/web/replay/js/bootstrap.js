(function (global) {
  'use strict';

  if (global.parent === global) return;

  var initialized = false;
  var parentActive = true;
  var pageActive = true;

  function updateActivity() {
    if (initialized) {
      global.SmcReplay.setActive(parentActive && pageActive && !document.hidden);
    }
  }

  global.addEventListener('message', function (event) {
    if (event.origin !== global.location.origin || event.source !== global.parent || !event.data) return;

    var message = event.data;
    if (message.type === 'pipstride:replay:init' && !initialized) {
      var id = message.accountId;
      if ((typeof id !== 'string' || !id.trim()) && !Number.isSafeInteger(id)) return;
      global.SmcReplay.init(String(id));
      initialized = true;
      updateActivity();
    } else if (message.type === 'pipstride:replay:visibility' && typeof message.active === 'boolean') {
      parentActive = message.active;
      updateActivity();
    }
  });

  document.addEventListener('visibilitychange', updateActivity);
  global.addEventListener('pagehide', function () {
    pageActive = false;
    updateActivity();
  });
  global.addEventListener('pageshow', function () {
    pageActive = true;
    updateActivity();
  });

  global.parent.postMessage({ type: 'pipstride:replay:ready' }, global.location.origin);
})(window);
