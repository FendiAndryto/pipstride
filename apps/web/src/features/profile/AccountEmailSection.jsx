// Account email & recovery (ticket 006-03). Email validation comes from
// domain/validation so the regex lives in exactly one place.

import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { isValidEmail } from '../../domain/validation';
import { Feedback } from './sectionPrimitives';

export default function AccountEmailSection({ user, onRefreshUser }) {
  const { t } = useLanguage();
  const [emailInfo, setEmailInfo] = useState({
    email: user?.email || '',
    verified: Boolean(user?.email_verified)
  });
  const [emailInput, setEmailInput] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState(null);

  const handleSaveEmail = async (e) => {
    e.preventDefault();
    setEmailFeedback(null);

    const value = emailInput.trim();
    if (!isValidEmail(value)) {
      setEmailFeedback({ type: 'error', text: t('err_email_invalid') });
      return;
    }

    setIsSavingEmail(true);
    try {
      const res = await api.setEmail(value);
      setEmailInfo({ email: res.email, verified: Boolean(res.email_verified) });
      setEmailInput('');
      setEmailFeedback({ type: 'success', text: res.message || t('profile_email_sent') });
      if (onRefreshUser) await onRefreshUser();
    } catch (err) {
      setEmailFeedback({ type: 'error', text: err.message || t('err_save_email') });
    } finally {
      setIsSavingEmail(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div className="cardhead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Mail size={17} style={{ color: 'var(--g)' }} />
          <h3>{t('profile_email_title')}</h3>
        </div>
        <span className={`tag ${emailInfo.verified ? 'green' : 'amber'}`} style={{ fontSize: '9px' }}>
          {emailInfo.verified ? t('profile_verified') : t('profile_unverified')}
        </span>
      </div>

      <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
        {t('profile_email_desc')}
      </p>

      <div className="row" style={{ marginBottom: '14px' }}>
        <div className="grow">
          <div className="rowtitle">{emailInfo.email || t('profile_no_email')}</div>
          <div className="rowsub">
            {emailInfo.verified ? t('profile_email_confirmed') : t('profile_email_send_hint')}
          </div>
        </div>
      </div>

      <Feedback feedback={emailFeedback} />

      <form onSubmit={handleSaveEmail} id="profile-email-form" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          id="profile-email-input"
          name="email"
          type="email"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder={emailInfo.email || t('profile_email_ph')}
          aria-label={t('profile_email_ph')}
          disabled={isSavingEmail}
          style={{
            flex: 1,
            minWidth: '200px',
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid var(--line)',
            background: '#091318',
            color: 'var(--text)',
            fontSize: '11.5px',
            outline: 'none'
          }}
          autoComplete="email"
          required
        />
        <button
          type="submit"
          className="btn alt"
          disabled={isSavingEmail}
          style={{ fontSize: '11.5px', padding: '8px 16px' }}
          id="profile-email-submit-btn"
        >
          <Mail size={13} />
          <span>{isSavingEmail ? t('profile_sending') : t('profile_save_verify')}</span>
        </button>
      </form>
    </div>
  );
}
