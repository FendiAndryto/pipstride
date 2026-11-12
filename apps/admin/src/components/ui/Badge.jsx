import React from 'react';

export function Badge({ variant = 'neutral', children, className = '' }) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {children}
    </span>
  );
}
