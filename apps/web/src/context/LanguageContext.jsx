import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations } from '../constants/translations';

const LANG_KEY = 'pipstride_lang';
const DEFAULT_LANG = 'en';

const LanguageContext = createContext({
  lang: DEFAULT_LANG,
  locale: 'en-US',
  setLang: () => {},
  toggleLang: () => {},
  t: (key) => key
});

const localeFor = (lang) => (lang === 'id' ? 'id-ID' : 'en-US');

const DOC_TITLES = {
  en: 'Pipstride — MT5 Telemetry & Journal Platform',
  id: 'Pipstride — Platform Telemetri & Jurnal MT5'
};

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_LANG;
    return localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
  });

  const setLang = useCallback((newLang) => {
    const safeLang = newLang === 'id' ? 'id' : 'en';
    setLangState(safeLang);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LANG_KEY, safeLang);
      document.documentElement.lang = safeLang;
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'en' ? 'id' : 'en');
  }, [lang, setLang]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = lang;
      document.title = DOC_TITLES[lang] || DOC_TITLES.en;
    }
  }, [lang]);

  // t(key, params?) — every key lives in translations.js for both languages, so
  // a missing translation falls back to English, never to an inline literal.
  const t = useCallback(
    (key, params) => {
      const dict = translations[lang] || translations[DEFAULT_LANG];
      let str = dict[key];
      if (str === undefined) str = translations[DEFAULT_LANG][key];
      if (str === undefined) return key;
      if (params && typeof str === 'string') {
        str = str.replace(/\{(\w+)\}/g, (match, name) =>
          params[name] === undefined || params[name] === null ? match : String(params[name])
        );
      }
      return str;
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, locale: localeFor(lang), setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useLanguage() {
  return useContext(LanguageContext);
}
