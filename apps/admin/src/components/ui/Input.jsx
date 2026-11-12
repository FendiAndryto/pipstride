import React, { useId } from 'react';

export function Input({
  label,
  id: explicitId,
  error,
  helperText,
  mono = false,
  className = '',
  ...props
}) {
  const generatedId = useId();
  const inputId = explicitId || generatedId;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  return (
    <div className={`form-group ${className}`.trim()}>
      {label ? (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={`form-input ${mono ? 'font-mono' : ''}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={
          error ? errorId : helperText ? helperId : undefined
        }
        {...props}
      />
      {error ? (
        <div id={errorId} className="form-error" role="alert">
          {error}
        </div>
      ) : helperText ? (
        <div id={helperId} className="form-helper" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {helperText}
        </div>
      ) : null}
    </div>
  );
}
