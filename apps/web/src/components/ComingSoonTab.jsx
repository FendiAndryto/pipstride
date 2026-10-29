import React from 'react';
import { Sparkles, PlaySquare, ArrowLeft, Clock, ShieldCheck, Cpu } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export default function ComingSoonTab({ type = 'ai', onBackToHome }) {
  const { t } = useLanguage();
  const isAI = type === 'ai';

  const title = isAI ? t('cs_ai_title') : t('cs_replay_title');
  const eyebrow = isAI ? t('cs_ai_eyebrow') : t('cs_replay_eyebrow');
  const icon = isAI ? Sparkles : PlaySquare;
  const IconComponent = icon;

  const features = isAI
    ? [
        {
          title: t('cs_ai_feat_1_title'),
          desc: t('cs_ai_feat_1_desc')
        },
        {
          title: t('cs_ai_feat_2_title'),
          desc: t('cs_ai_feat_2_desc')
        },
        {
          title: t('cs_ai_feat_3_title'),
          desc: t('cs_ai_feat_3_desc')
        }
      ]
    : [
        {
          title: t('cs_replay_feat_1_title'),
          desc: t('cs_replay_feat_1_desc')
        },
        {
          title: t('cs_replay_feat_2_title'),
          desc: t('cs_replay_feat_2_desc')
        },
        {
          title: t('cs_replay_feat_3_title'),
          desc: t('cs_replay_feat_3_desc')
        }
      ];

  return (
    <div className="coming-soon-container animate-fade-in" style={{ maxWidth: '850px', margin: '0 auto', padding: '10px 0' }}>
      <div className="heading">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <div className="sub">
            {isAI ? t('cs_ai_sub') : t('cs_replay_sub')}
          </div>
        </div>
        <span className="tag amber" style={{ fontSize: '10.5px', padding: '5px 10px' }}>
          {t('cs_tag')}
        </span>
      </div>

      <div
        className="banner"
        style={{
          marginBottom: '20px',
          background: isAI
            ? 'linear-gradient(115deg, #1b3842, #102831 75%, #182738)'
            : 'linear-gradient(115deg, #382d18, #262114 75%, #1d2629)',
          borderColor: isAI ? '#2d5c6b' : '#685025'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div
            className="icon-box"
            style={{
              background: isAI ? '#163842' : '#3d301b',
              color: isAI ? 'var(--blue)' : 'var(--amber)',
              width: '38px',
              height: '38px',
              borderRadius: '12px'
            }}
          >
            <IconComponent size={20} />
          </div>
          <div>
            <div className="eyebrow" style={{ color: isAI ? 'var(--blue)' : 'var(--amber)' }}>
              {t('cs_dev_eyebrow')}
            </div>
            <h2 style={{ fontSize: '19px', margin: '2px 0' }}>
              {isAI ? t('cs_ai_banner_title') : t('cs_replay_banner_title')}
            </h2>
          </div>
        </div>
        <p style={{ marginTop: '8px' }}>
          {t('cs_banner_body')}
        </p>

        <div className="btns" style={{ marginTop: '16px' }}>
          {onBackToHome && (
            <button
              type="button"
              className="btn alt"
              onClick={onBackToHome}
              id={`coming-soon-back-${type}-btn`}
            >
              <ArrowLeft size={14} />
              <span>{t('cs_back_home')}</span>
            </button>
          )}
        </div>
      </div>

      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '12px' }}>
        {t('cs_preview_title', { name: isAI ? t('cs_preview_ai_name') : t('cs_preview_replay_name') })}
      </div>

      <div className="grid three">
        {features.map((feat, idx) => (
          <div key={idx} className="card">
            <div className="icon-box" style={{ marginBottom: '10px' }}>
              {idx === 0 ? <Cpu size={16} /> : idx === 1 ? <ShieldCheck size={16} /> : <Clock size={16} />}
            </div>
            <h3 style={{ fontSize: '13px', marginBottom: '6px' }}>{feat.title}</h3>
            <p className="sub" style={{ fontSize: '11px', lineHeight: 1.45 }}>{feat.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
