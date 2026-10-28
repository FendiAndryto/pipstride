import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations } from '../constants/translations';

const LANG_KEY = 'pipstride_lang';
const DEFAULT_LANG = 'en';

const LanguageContext = createContext({
  lang: DEFAULT_LANG,
  setLang: () => {},
  toggleLang: () => {},
  t: (key, fallback = '') => fallback || key
});

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
    }
  }, [lang]);

  const t = useCallback(
    (key, fallback = '') => {
      const dict = translations[lang] || translations[DEFAULT_LANG];
      return dict[key] ?? fallback ?? key;
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useLanguage() {
  return useContext(LanguageContext);
}
