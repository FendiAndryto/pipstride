// Passive risk watchdog card (ticket 006-03). Read-only: the watchdog never
// liquidates positions. Values come from domain/pnl.deriveDrawdownWatch.

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import RichText from '../../components/RichText';
import { deriveDrawdownWatch } from '../../domain/pnl';
import { formatCurrency } from '../../domain/format';

export default function RiskWatchdogSection({ bridgeStatus, riskStatus }) {
  const { t } = useLanguage();
  const metrics = bridgeStatus?.metrics || {};
  const currency = metrics.currency || 'USD';
  const marginLevel = riskStatus?.margin_level ?? metrics.margin_level ?? 0;
  const { daily, alert: isRiskAlert, limitUsed } = deriveDrawdownWatch(riskStatus);

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div className="cardhead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={18} style={{ color: isRiskAlert ? 'var(--amber)' : 'var(--g)' }} />
          <h3>{t('profile_drawdown_monitor')}</h3>
        </div>
        <span className="tag">{t('profile_risk_tag', { pct: daily.toFixed(2) })}</span>
      </div>

      <p className="sub" style={{ fontSize: '11.5px', marginBottom: '12px', lineHeight: 1.45 }}>
        <RichText text={t('profile_risk_desc')} />
      </p>

      <div style={{ background: '#0a1419', height: '8px', borderRadius: '99px', overflow: 'hidden', marginBottom: '8px', border: '1px solid var(--line)' }}>
        <div
          style={{
            width: `${Math.min(100, Math.max(0, limitUsed))}%`,
            height: '100%',
            background: isRiskAlert || limitUsed > 75 ? 'var(--red)' : limitUsed > 40 ? 'var(--amber)' : 'var(--g)',
            borderRadius: '99px',
            transition: 'width 0.4s ease'
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
        <span>{t('profile_baseline', { amount: formatCurrency(bridgeStatus?.initial_deposit, currency) })}</span>
        <span>{t('profile_margin_level', { level: marginLevel ? `${marginLevel.toFixed(1)}%` : '—' })}</span>
      </div>
    </div>
  );
}
