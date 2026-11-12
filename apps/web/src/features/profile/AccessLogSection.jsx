import React from 'react';
import { ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { formatDateTime } from '../../domain/format';
import { useAccessLog } from './useAccessLog';

const getActionLabel = (action, t) => {
  if (action === 'support.granted') return t('profile_access_log_action_granted');
  if (action === 'support.detail_viewed') return t('profile_access_log_action_detail_viewed');
  if (action === 'support.revoked') return t('profile_access_log_action_revoked');
  return action || '—';
};

const getActionTagClass = (action) => {
  if (action === 'support.granted') return 'tag amber';
  if (action === 'support.detail_viewed') return 'tag blue';
  if (action === 'support.revoked') return 'tag';
  return 'tag';
};

const parseDetail = (detail) => {
  if (!detail) return { primary: '—', secondary: null };
  const parts = detail.split(';').map((p) => p.trim());
  const reasonPart = parts.find((p) => p.startsWith('reason='));
  const sessionPart = parts.find((p) => p.startsWith('session='));

  if (reasonPart) {
    return {
      primary: reasonPart.replace(/^reason=/, '').trim(),
      secondary: sessionPart ? sessionPart.trim() : null
    };
  }
  return {
    primary: detail,
    secondary: null
  };
};

export default function AccessLogSection() {
  const { t, locale } = useLanguage();
  const { items, isLoading, error, refetch } = useAccessLog({ limit: 50 });

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div className="cardhead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={17} style={{ color: 'var(--g)' }} />
          <h3>{t('profile_access_log_title')}</h3>
        </div>
        <button
          type="button"
          onClick={refetch}
          disabled={isLoading}
          className="btn ghost"
          style={{ fontSize: '11px', padding: '5px 10px', height: '28px' }}
          aria-label={t('profile_access_log_refresh')}
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          <span>{t('profile_access_log_refresh')}</span>
        </button>
      </div>

      <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
        {t('profile_access_log_intro')}
      </p>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            padding: '10px 12px',
            borderRadius: '9px',
            fontSize: '11.5px',
            marginBottom: '14px',
            background: 'rgba(255, 113, 128, 0.12)',
            border: '1px solid rgba(255, 113, 128, 0.4)',
            color: 'var(--red)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error || t('profile_access_log_error')}</span>
          </div>
          <button
            type="button"
            onClick={refetch}
            className="btn alt"
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            {t('profile_access_log_retry')}
          </button>
        </div>
      )}

      {isLoading && items.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '32px 16px',
            color: 'var(--muted)',
            fontSize: '12px'
          }}
        >
          <RefreshCw size={15} className="animate-spin" />
          <span>{t('profile_access_log_loading')}</span>
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div
          style={{
            padding: '28px 16px',
            textAlign: 'center',
            background: '#091318',
            border: '1px dashed var(--line)',
            borderRadius: '8px',
            color: 'var(--muted)',
            fontSize: '12px'
          }}
        >
          <ShieldCheck size={24} style={{ color: 'var(--muted)', margin: '0 auto 8px', opacity: 0.6 }} />
          <div>{t('profile_access_log_empty')}</div>
        </div>
      )}

      {items.length > 0 && (
        <div className="table-responsive" style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }} aria-label={t('profile_access_log_title')}>
            <thead style={{ position: 'sticky', top: 0, background: '#0e181e', zIndex: 2 }}>
              <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                <th scope="col" style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {t('profile_access_log_th_action')}
                </th>
                <th scope="col" style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {t('profile_access_log_th_actor')}
                </th>
                <th scope="col" style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {t('profile_access_log_th_time')}
                </th>
                <th scope="col" style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {t('profile_access_log_th_detail')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const parsed = parseDetail(item.detail);
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #1c2b33' }}>
                    <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                      <span className={getActionTagClass(item.action)}>
                        {getActionLabel(item.action, t)}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                      {item.actor_username || '—'}
                    </td>
                    <td style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                      {formatDateTime(item.created_at, locale)}
                    </td>
                    <td style={{ padding: '10px 8px', minWidth: '180px' }}>
                      {parsed.secondary ? (
                        <div>
                          <div style={{ color: 'var(--text)', fontSize: '11.5px', fontWeight: 600 }}>
                            {parsed.primary}
                          </div>
                          <div className="tiny" style={{ color: 'var(--muted)', fontSize: '10px', marginTop: '2px', fontFamily: 'monospace' }}>
                            {parsed.secondary}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: 'var(--muted)', fontSize: '11.5px', fontFamily: parsed.primary.startsWith('session=') ? 'monospace' : 'inherit' }}>
                          {parsed.primary}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
