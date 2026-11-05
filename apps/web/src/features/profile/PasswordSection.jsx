// Change-password form (ticket 006-03). Complexity rules come from
// domain/validation (mirrors the backend's validate_password_complexity).

import React, { useState } from 'react';
import { KeyRound, Lock, Eye, EyeOff } from 'lucide-react';
import { api } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { passwordError } from '../../domain/validation';
import { Feedback } from './sectionPrimitives';
import { inputStyle } from './styles';

const labelStyle = { display: 'block' };
const lockIconStyle = { position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' };
const eyeButtonStyle = { position: 'absolute', right: '8px', top: '8px', background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' };

export default function PasswordSection({ user }) {
  const { t } = useLanguage();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [passFeedback, setPassFeedback] = useState(null);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPassFeedback(null);

    if (!oldPassword || !newPassword) {
      setPassFeedback({ type: 'error', text: t('err_old_new_required') });
      return;
    }

    const problem = passwordError(newPassword);
    if (problem === 'length') {
      setPassFeedback({ type: 'error', text: t('err_new_password_min') });
      return;
    }
    if (problem) {
      setPassFeedback({ type: 'error', text: t('err_new_password_alnum') });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPassFeedback({ type: 'error', text: t('err_new_password_mismatch') });
      return;
    }

    setIsChangingPass(true);
    try {
      const res = await api.changePassword(oldPassword, newPassword);
      setPassFeedback({ type: 'success', text: res.message || t('profile_password_success') });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPassFeedback({ type: 'error', text: err.message || t('err_change_password') });
    } finally {
      setIsChangingPass(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div className="cardhead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <KeyRound size={17} style={{ color: 'var(--g)' }} />
          <h3>{t('profile_password_title')}</h3>
        </div>
        <span className="tag blue">{user?.role ? user.role.toUpperCase() : t('profile_role_trader')}</span>
      </div>

      <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
        {t('profile_password_desc')}
      </p>

      <Feedback feedback={passFeedback} />

      <form onSubmit={handleChangePassword} id="profile-change-password-form">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' }}>
          <div>
            <label htmlFor="profile-old-password" className="label" style={labelStyle}>
              {t('profile_current_password')}
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={14} style={lockIconStyle} />
              <input
                id="profile-old-password"
                name="current_password"
                type={showOldPass ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder={t('profile_current_ph')}
                style={{ ...inputStyle, padding: '8px 32px 8px 30px' }}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowOldPass(!showOldPass)} style={eyeButtonStyle}>
                {showOldPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="profile-new-password" className="label" style={labelStyle}>
              {t('profile_new_password')}
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={14} style={lockIconStyle} />
              <input
                id="profile-new-password"
                name="new_password"
                type={showNewPass ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('profile_new_ph')}
                style={{ ...inputStyle, padding: '8px 32px 8px 30px' }}
                autoComplete="new-password"
                required
              />
              <button type="button" onClick={() => setShowNewPass(!showNewPass)} style={eyeButtonStyle}>
                {showNewPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="profile-confirm-password" className="label" style={labelStyle}>
              {t('profile_repeat_password')}
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={14} style={lockIconStyle} />
              <input
                id="profile-confirm-password"
                name="confirm_password"
                type={showNewPass ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('profile_confirm_ph')}
                style={{ ...inputStyle, padding: '8px 10px 8px 30px' }}
                autoComplete="new-password"
                required
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="btn alt"
          disabled={isChangingPass}
          style={{ fontSize: '11.5px', padding: '8px 16px' }}
          id="profile-change-password-btn"
        >
          <KeyRound size={13} />
          <span>{isChangingPass ? t('profile_updating') : t('profile_save_password')}</span>
        </button>
      </form>
    </div>
  );
}
