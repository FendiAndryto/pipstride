import React from 'react';
import { LoginForm } from '../features/auth/LoginForm';

export function LoginPage({ onLoginSuccess }) {
  return (
    <div className="login-wrapper">
      <LoginForm onLoginSuccess={onLoginSuccess} />
    </div>
  );
}
