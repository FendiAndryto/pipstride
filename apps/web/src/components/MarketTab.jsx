import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, X, ArrowLeft, Maximize2, Minimize2 } from 'lucide-react';
import { api } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import {
  MARKET_CATALOG,
  MARKET_CATEGORIES,
  filterMarketCatalog,
  isSameInstrument,
  normalizeTradingViewSymbol,
  resolveTradingViewSymbol
} from '../domain/market';
import TradingViewChart from './TradingViewChart';

const CATEGORY_TABS = [
  { key: MARKET_CATEGORIES.ALL, labelKey: 'market_category_all' },
  { key: MARKET_CATEGORIES.FOREX, labelKey: 'market_category_forex' },
  { key: MARKET_CATEGORIES.METALS, labelKey: 'market_category_metals' },
  { key: MARKET_CATEGORIES.CRYPTO, labelKey: 'market_category_crypto' },
  { key: MARKET_CATEGORIES.INDICES, labelKey: 'market_category_indices' }
];

export default function MarketTab({ bridgeStatus, hasConnection: _hasConnection = false }) {
  // ponytail: 16 curated catalog pairs, synchronous filtering, no backend calls.
  const { t, lang } = useLanguage();
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(MARKET_CATEGORIES.ALL);
  const changePairButtonRef = useRef(null);
  const searchInputRef = useRef(null);
  const restoreSearchFocus = useRef(false);

  useLayoutEffect(() => {
    if (selectedSymbol !== null) {
      changePairButtonRef.current?.focus();
    } else if (restoreSearchFocus.current) {
      restoreSearchFocus.current = false;
      searchInputRef.current?.focus();
    }
  }, [selectedSymbol]);

  useEffect(() => {
    if (!isFullscreen || selectedSymbol === null) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, selectedSymbol]);

  const quotes = Array.isArray(bridgeStatus?.market_quotes) ? bridgeStatus.market_quotes : [];
  const hasAccountQuotes = quotes.length > 0;

  const handleSelectPair = (tvSymbol, baseSymbol) => {
    setSelectedSymbol(tvSymbol);
    setIsFullscreen(true);
    if (bridgeStatus?.is_connected && baseSymbol) {
      // Best-effort notify backend so MT5 sensor watchlist syncs (Ticket 13-04)
      api.setActiveMarketSymbol(baseSymbol).catch(() => {});
    }
  };

  if (selectedSymbol !== null) {
    const catalogMatch = MARKET_CATALOG.find(
      (p) => p.tvSymbol === selectedSymbol || p.symbol === selectedSymbol
    );
    const displaySymbol = catalogMatch
      ? catalogMatch.symbol
      : (selectedSymbol.includes(':') ? selectedSymbol.split(':')[1] : selectedSymbol);
    const displayName = catalogMatch ? t(catalogMatch.nameKey) : null;
    const providerBadge = selectedSymbol.includes(':') ? selectedSymbol.split(':')[0] : null;

    return (
      <div className="market-tab-container animate-fade-in">
        <div className={`market-chart-shell ${isFullscreen ? 'market-chart-fullscreen' : ''}`}>
          <div className="market-chart-head">
            <button
              type="button"
              className="market-btn-back"
              ref={changePairButtonRef}
              onClick={() => {
                restoreSearchFocus.current = true;
                setSelectedSymbol(null);
                setIsFullscreen(false);
              }}
              aria-label={t('market_btn_change_pair')}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span>{t('market_btn_change_pair')}</span>
            </button>

            <div className="market-chart-info">
              <span className="market-chart-symbol-text">{displaySymbol}</span>
              {displayName && <span className="market-chart-desc">{displayName}</span>}
              {providerBadge && (
                <span className="market-badge market-badge-cat">{providerBadge}</span>
              )}
            </div>

            <div className="market-chart-actions">
              <button
                type="button"
                className="market-btn-icon"
                onClick={() => setIsFullscreen((prev) => !prev)}
                aria-label={isFullscreen ? t('market_btn_exit_fullscreen') : t('market_btn_fullscreen')}
                title={isFullscreen ? t('market_btn_exit_fullscreen') : t('market_btn_fullscreen')}
              >
                {isFullscreen ? (
                  <Minimize2 size={16} aria-hidden="true" />
                ) : (
                  <Maximize2 size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <TradingViewChart symbol={selectedSymbol} locale={lang} />

          <div className="market-chart-footer">
            {t('market_chart_powered_by')}
          </div>
        </div>
      </div>
    );
  }

  const categories = hasAccountQuotes
    ? [...CATEGORY_TABS, { key: 'account', labelKey: 'market_category_account' }]
    : CATEGORY_TABS;

  const currentCategory = activeCategory === 'account' && !hasAccountQuotes
    ? MARKET_CATEGORIES.ALL
    : activeCategory;

  const cleanQuery = searchQuery.trim();
  const showAccountSection = hasAccountQuotes && (currentCategory === MARKET_CATEGORIES.ALL || currentCategory === 'account');
  const showCuratedGrid = currentCategory !== 'account';

  const filteredAccountQuotes = showAccountSection
    ? (cleanQuery
        ? quotes.filter((q) => q.symbol && q.symbol.toUpperCase().includes(cleanQuery.toUpperCase()))
        : quotes)
    : [];

  const enrichedCatalog = MARKET_CATALOG.map((p) => ({
    ...p,
    name: t(p.nameKey)
  }));

  const filteredCatalog = showCuratedGrid
    ? filterMarketCatalog(enrichedCatalog, cleanQuery, currentCategory)
    : [];

  const isEmpty = filteredAccountQuotes.length === 0 && filteredCatalog.length === 0;

  return (
    <div className="market-tab-container animate-fade-in">
      <div className="heading">
        <div>
          <div className="eyebrow">{t('market_eyebrow')}</div>
          <h1>{t('market_title')}</h1>
          <div className="sub">{t('market_sub')}</div>
        </div>
      </div>

      <div className="market-toolbar">
        <div className="market-search">
          <Search size={18} className="market-search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            className="market-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('market_search_placeholder')}
            aria-label={t('market_search_placeholder')}
          />
          {searchQuery && (
            <button
              type="button"
              className="market-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label={t('market_clear_search')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="market-pills">
          {categories.map((cat) => {
            const isActive = currentCategory === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                aria-pressed={isActive}
                className={`market-pill ${isActive ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {t(cat.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {filteredAccountQuotes.length > 0 && (
        <section className="market-section" aria-labelledby="market-watchlist-title">
          <div className="market-section-head">
            <h3 id="market-watchlist-title" className="market-section-title">
              {t('market_watchlist')}
            </h3>
            <span className="market-badge market-badge-account">
              {t('market_category_account')}
            </span>
          </div>
          <div className="market-grid">
            {filteredAccountQuotes.map((quote) => {
              const bid = Number(quote.bid);
              const hasBid = Number.isFinite(bid) && bid > 0;
              const formattedBid = hasBid ? bid.toFixed(quote.digits ?? 2) : '—';
              const change = Number(quote.daily_change_pct) || 0;
              const isPos = change >= 0;
              const formattedChange = `${isPos ? '+' : ''}${change.toFixed(2)}%`;
              const spreadText = quote.spread != null
                ? t('home_spread_pts', { spread: quote.spread })
                : null;

              return (
                <button
                  key={quote.symbol}
                  type="button"
                  className="market-card market-card-account"
                  onClick={() => handleSelectPair(resolveTradingViewSymbol(quote.symbol), quote.symbol)}
                  aria-label={`${quote.symbol} - ${t('market_category_account')}`}
                >
                  <div className="market-card-head">
                    <span className="market-symbol">{quote.symbol}</span>
                    <span className={`market-card-change ${isPos ? 'positive' : 'negative'}`}>
                      {formattedChange}
                    </span>
                  </div>
                  <div className="market-card-quote">
                    <span className="market-price">{formattedBid}</span>
                    {spreadText && <span className="market-spread">{spreadText}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {filteredCatalog.length > 0 && (
        <section className="market-section" aria-label={t('market_title')}>
          {filteredAccountQuotes.length > 0 && (
            <div className="market-section-head">
              <h3 className="market-section-title">
                {t('market_instruments', { count: filteredCatalog.length })}
              </h3>
            </div>
          )}
          <div className="market-grid">
            {filteredCatalog.map((pair) => {
              const match = quotes.find((q) => isSameInstrument(pair.symbol, q.symbol));
              const bid = match ? Number(match.bid) : null;
              const hasBid = bid !== null && Number.isFinite(bid) && bid > 0;
              const formattedBid = hasBid ? bid.toFixed(match.digits ?? 2) : (match ? '—' : null);
              const change = match ? (Number(match.daily_change_pct) || 0) : null;
              const isPos = change !== null ? change >= 0 : true;
              const formattedChange = change !== null ? `${isPos ? '+' : ''}${change.toFixed(2)}%` : null;

              return (
                <button
                  key={pair.symbol}
                  type="button"
                  className="market-card"
                  onClick={() => handleSelectPair(pair.tvSymbol, pair.symbol)}
                  aria-label={`${pair.symbol} - ${pair.name}`}
                >
                  <div className="market-card-head">
                    <span className="market-icon" aria-hidden="true">{pair.icon}</span>
                    <span className="market-badge market-badge-cat">
                      {t(`market_category_${pair.category}`)}
                    </span>
                  </div>
                  <div className="market-card-main">
                    <span className="market-symbol">{pair.symbol}</span>
                    <span className="market-card-name">{pair.name}</span>
                  </div>
                  {match && (
                    <div className="market-card-quote">
                      <span className="market-price">{formattedBid}</span>
                      <span className={`market-card-change ${isPos ? 'positive' : 'negative'}`}>
                        {formattedChange}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {isEmpty && (
        <div className="market-empty">
          <p className="market-empty-text">{t('market_no_pairs_found')}</p>
          {cleanQuery && (
            <button
              type="button"
              className="market-btn-cta"
              onClick={() =>
                handleSelectPair(
                  normalizeTradingViewSymbol(cleanQuery),
                  cleanQuery.toUpperCase().replace(/[^A-Z0-9]/g, '')
                )
              }
            >
              {t('market_custom_symbol_cta', { symbol: cleanQuery })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
