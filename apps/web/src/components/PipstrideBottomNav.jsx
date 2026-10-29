import React from 'react';
import { NAV_TABS } from '../constants/nav';
import { useLanguage } from '../context/LanguageContext';

export default function PipstrideBottomNav({ activeTab, onSelectTab }) {
  const { t } = useLanguage();
  return (
    <nav className="bottom" id="mobile-bottom-nav" aria-label={t('nav_mobile_aria')}>
      <div className="nav">
        {NAV_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={isActive ? 'active' : ''}
              onClick={() => onSelectTab(tab.id)}
              id={`mobile-nav-${tab.id}`}
            >
              <b>{tab.symbol}</b>
              <span>{t(`nav_${tab.id}`)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
