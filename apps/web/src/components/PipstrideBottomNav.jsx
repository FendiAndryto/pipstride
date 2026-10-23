import React from 'react';
import { NAV_TABS } from '../constants/nav';

export default function PipstrideBottomNav({ activeTab, onSelectTab }) {
  return (
    <nav className="bottom" id="mobile-bottom-nav" aria-label="Mobile Navigation">
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
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
