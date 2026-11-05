// Shared visual atoms for the profile feature sections (ticket 006-03).
// Component-only exports so fast refresh stays happy; style tokens live in styles.js.

import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { tileStyle } from './styles';

export function SectionHeading({ children }) {
  return (
    <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
      {children}
    </div>
  );
}

export function Feedback({ feedback }) {
  if (!feedback) return null;
  const ok = feedback.type === 'success';
  return (
    <div
      style={{
        padding: '9px 12px',
        borderRadius: '9px',
        fontSize: '11.5px',
        marginBottom: '14px',
        background: ok ? 'rgba(69, 224, 173, 0.12)' : 'rgba(255, 113, 128, 0.12)',
        border: `1px solid ${ok ? 'rgba(69, 224, 173, 0.4)' : 'rgba(255, 113, 128, 0.4)'}`,
        color: ok ? 'var(--g)' : 'var(--red)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}
    >
      {ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
      <span>{feedback.text}</span>
    </div>
  );
}

export function StatTile({ label, children }) {
  return (
    <div style={tileStyle}>
      <div
        className="tiny"
        style={{
          color: 'var(--muted)',
          fontSize: '9.5px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '2px'
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
