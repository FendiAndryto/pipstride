// Shared connection-manager state for the profile section and the MT5 modal
// (ticket 006-03, SRP-4). One implementation of create/rotate/revoke, token
// reveal, preset download and in-UI confirmation — no window.confirm.
//
// Callers render `pendingConfirm` as a non-blocking inline prompt and call
// `confirmPending()` / `cancelPending()`.

import { useState } from 'react';
import { api } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

export function useConnectionManager({ onChanged, onSelect, onError } = {}) {
  const { t } = useLanguage();
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [revealedToken, setRevealedToken] = useState('');
  const [presetFile, setPresetFile] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null);

  const runAction = async (action, successText) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const result = await action();
      if (onChanged) await onChanged();
      if (successText) setFeedback({ type: 'success', text: successText });
      return result;
    } catch (err) {
      const message = err.message || t('profile_conn_failed');
      setFeedback({ type: 'error', text: message });
      if (onError) onError(message);
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const reveal = (payload) => {
    setRevealedToken(payload.token);
    setPresetFile(payload.preset || null);
  };

  const create = async (label) => {
    const created = await runAction(
      () => api.createConnection(label || t('profile_default_account_label', { n: 1 })),
      t('profile_conn_created')
    );
    if (created?.token) {
      reveal(created);
      if (onSelect) onSelect(created.id);
    }
    return created;
  };

  /** Queue a destructive action; the caller renders the inline prompt. */
  const requestRotate = (connection) => setPendingConfirm({ action: 'rotate', connection });
  const requestRevoke = (connection) => setPendingConfirm({ action: 'revoke', connection });
  const cancelPending = () => setPendingConfirm(null);

  const confirmPending = () => {
    const pending = pendingConfirm;
    if (!pending) return null;
    setPendingConfirm(null);
    if (pending.action === 'rotate') {
      return runAction(async () => {
        const rotated = await api.rotateConnectionToken(pending.connection.id);
        reveal(rotated);
        return rotated;
      }, t('profile_conn_rotated'));
    }
    return runAction(() => api.revokeConnection(pending.connection.id), t('profile_conn_deleted'));
  };

  const copyToken = () => {
    if (!revealedToken) return;
    navigator.clipboard.writeText(revealedToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const reset = () => {
    setRevealedToken('');
    setPresetFile(null);
    setFeedback(null);
    setCopiedToken(false);
    setPendingConfirm(null);
  };

  return {
    isBusy,
    feedback,
    revealedToken,
    presetFile,
    copiedToken,
    pendingConfirm,
    runAction,
    create,
    requestRotate,
    requestRevoke,
    cancelPending,
    confirmPending,
    copyToken,
    reset
  };
}
