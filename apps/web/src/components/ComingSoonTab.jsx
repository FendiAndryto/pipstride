import React from 'react';
import { Sparkles, PlaySquare, ArrowLeft, Clock, ShieldCheck, Cpu } from 'lucide-react';

export default function ComingSoonTab({ type = 'ai', onBackToHome }) {
  const isAI = type === 'ai';

  const title = isAI ? 'AI Trading Assistant' : 'Historical Replay & Strategy Backtest';
  const eyebrow = isAI ? 'PERSONAL TRADING INTELLIGENCE' : 'SIMULATION & RISKLESS PRACTICE';
  const icon = isAI ? Sparkles : PlaySquare;
  const IconComponent = icon;

  const features = isAI
    ? [
        {
          title: 'Automated Journal Diagnostics',
          desc: 'Identifies behavioral patterns, revenge trading risks, and entry timing issues directly from your trade history.'
        },
        {
          title: 'Confluence Strategy Coach',
          desc: 'Synthesizes market structure with your historical win rate to propose tailored risk-to-reward improvements.'
        },
        {
          title: 'Natural Language Querying',
          desc: 'Ask questions like "How did my Gold EA perform during London sessions?" and get instant data insights.'
        }
      ]
    : [
        {
          title: 'Tick-by-Tick Market Replay',
          desc: 'Replay past price movements candle-by-candle with configurable speed (1x to 8x) to practice manual execution.'
        },
        {
          title: 'Paper Trading Sandbox',
          desc: 'Simulate BUY and SELL executions on historical data with zero risk to your live MT5 broker equity.'
        },
        {
          title: 'Strategy Parameter Stress Testing',
          desc: 'Test your confluence rules and trailing stops against previous market regimes before going live.'
        }
      ];

  return (
    <div className="coming-soon-container animate-fade-in" style={{ maxWidth: '850px', margin: '0 auto', padding: '10px 0' }}>
      <div className="heading">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <div className="sub">
            {isAI
              ? 'Analisis jurnal pribadi, evaluasi disiplin trading, dan panduan pasar bertenaga AI.'
              : 'Latihan entry manual dan pengujian parameter strategi tanpa risiko modal.'}
          </div>
        </div>
        <span className="tag amber" style={{ fontSize: '10.5px', padding: '5px 10px' }}>
          COMING SOON
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
              FEATURE IN ACTIVE DEVELOPMENT
            </div>
            <h2 style={{ fontSize: '19px', margin: '2px 0' }}>
              {isAI ? 'Trade Smarter with AI Coaching' : 'Master Strategy Timing Without Real Losses'}
            </h2>
          </div>
        </div>
        <p style={{ marginTop: '8px' }}>
          Fitur ini sedang dalam tahap integrasi mendalam dengan backend Pipstride dan model telemetri MT5.
          Sistem akan tersedia pada rilis mendatang untuk memaksimalkan performa trading Anda.
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
              <span>Kembali ke Home</span>
            </button>
          )}
        </div>
      </div>

      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '12px' }}>
        Preview Kemampuan {isAI ? 'AI Assistant' : 'Replay & Backtest'}
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
