import { apiFetch } from '../../lib/api';

export async function fetchAuditLogs({
  user_id = '',
  target_user_id = '',
  action = '',
  limit = 100,
  offset = 0,
} = {}) {
  const params = new URLSearchParams();
  if (user_id) params.set('user_id', user_id);
  if (target_user_id) params.set('target_user_id', target_user_id);
  if (action) params.set('action', action);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  return apiFetch(`/api/v1/admin/audit?${params.toString()}`, {
    method: 'GET',
  }, { authed: true });
}
