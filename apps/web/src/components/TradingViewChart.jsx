import React, { useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

const LOAD_TIMEOUT = 15_000;
let tvScriptPromise = null;

function loadTradingViewScript() {
  if (typeof window.TradingView?.widget === 'function') {
    return Promise.resolve(window.TradingView.widget);
  }
  if (tvScriptPromise) return tvScriptPromise;

  const script = document.createElement('script');
  script.src = 'https://s3.tradingview.com/tv.js';
  script.async = true;

  let timeout;
  tvScriptPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('TradingView script timed out')), LOAD_TIMEOUT);
    script.onload = () => {
      const Widget = window.TradingView?.widget;
      if (typeof Widget === 'function') resolve(Widget);
      else reject(new Error('TradingView widget is unavailable'));
    };
    script.onerror = () => reject(new Error('TradingView script failed to load'));
    document.head.appendChild(script);
  }).finally(() => {
    clearTimeout(timeout);
    script.remove();
    tvScriptPromise = null;
  });

  return tvScriptPromise;
}

export default function TradingViewChart({ symbol, locale = 'en' }) {
  const { t } = useLanguage();
  const rawId = useId();
  const hostRef = useRef(null);
  const nextInstance = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !symbol) return;

    setStatus('loading');
    const container = document.createElement('div');
    container.id = `tradingview_${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}_${++nextInstance.current}`;
    host.appendChild(container);

    let cancelled = false;
    let timeout;

    function stopWaiting() {
      clearTimeout(timeout);
      container.removeEventListener('load', onFrameLoad, true);
    }

    function onFrameLoad(event) {
      if (event.target.tagName !== 'IFRAME') return;
      const src = event.target.getAttribute('src');
      if (!src || src === 'about:blank') return;
      stopWaiting();
      setStatus('ready');
    }

    function dispose() {
      cancelled = true;
      stopWaiting();
      container.remove();
    }

    function fail() {
      if (cancelled) return;
      dispose();
      setStatus('error');
    }

    loadTradingViewScript()
      .then(Widget => {
        if (cancelled) return;
        container.addEventListener('load', onFrameLoad, true);
        timeout = setTimeout(fail, LOAD_TIMEOUT);
        new Widget({
          container_id: container.id,
          autosize: true,
          symbol,
          interval: '15',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: locale || 'en',
          toolbar_bg: '#0a1419',
          enable_publishing: false,
          allow_symbol_change: true,
          hide_side_toolbar: false,
          save_image: true,
          studies: []
        });
      })
      .catch(fail);

    return dispose;
  }, [symbol, locale, rawId, attempt]);

  return (
    <div className="market-chart-frame">
      <div ref={hostRef} className="market-chart-widget" aria-hidden={status !== 'ready'} />
      {status !== 'ready' && (
        <div className="market-chart-status">
          <div role="status">
            {status === 'loading' ? t('market_chart_loading') : t('market_chart_error')}
          </div>
          {status === 'error' && (
            <button type="button" className="btn alt" onClick={() => setAttempt(value => value + 1)}>
              {t('market_chart_retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
