import { apiFetch } from '../../lib/api';

export async function fetchAuditLogs({
  user_id = '',
  target_user_id = '',
  action = '',
  start,
  end,
  limit = 100,
  offset = 0,
  signal,
} = {}) {
  const params = new URLSearchParams();
  if (user_id) params.set('user_id', user_id);
  if (target_user_id) params.set('target_user_id', target_user_id);
  if (action) params.set('action', action);
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  return apiFetch(`/api/v1/admin/audit?${params.toString()}`, {
    method: 'GET',
    signal,
  }, { authed: true });
}
