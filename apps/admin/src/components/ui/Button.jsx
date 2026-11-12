import React from 'react';
import { Loader2 } from 'lucide-react';

export function Button({
  type = 'button',
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon,
  children,
  onClick,
  className = '',
  ...props
}) {
  const isSm = size === 'sm';
  const sizeClass = isSm ? 'btn-sm' : '';
  const variantClass = `btn-${variant}`;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`btn ${variantClass} ${sizeClass} ${className}`.trim()}
      {...props}
    >
      {loading ? (
        <Loader2 size={isSm ? 14 : 16} className="animate-spin" />
      ) : Icon ? (
        <Icon size={isSm ? 14 : 16} />
      ) : null}
      {children}
    </button>
  );
}
