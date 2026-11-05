// Blob download helpers (moved out of api.js). Pure DOM concern: nothing here
// knows about transport or auth.

/**
 * Saves the MT5 preset (.set) produced by connection create/rotate.
 * The file carries the raw connection token, so it is only downloadable in the
 * same session where the token was revealed.
 */
export const downloadPreset = (preset) => {
  if (!preset?.content || typeof document === 'undefined') return false;
  const blob = new Blob([preset.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = preset.filename || 'PipstrideMonitor.set';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
};
