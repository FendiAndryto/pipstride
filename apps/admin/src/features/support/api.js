import { apiFetch } from '../../lib/api';

export async function fetchSupportSessions({ mine = true, active_only = false } = {}) {
  const params = new URLSearchParams();
  params.set('mine', String(mine));
  params.set('active_only', String(active_only));

  return apiFetch(`/api/v1/admin/support/sessions?${params.toString()}`, {
    method: 'GET',
  }, { authed: true });
}

export async function createSupportSession({ target_user_id, reason }) {
  return apiFetch('/api/v1/admin/support/sessions', {
    method: 'POST',
    body: JSON.stringify({ target_user_id, reason }),
  }, { authed: true });
}

export async function revokeSupportSession(id) {
  return apiFetch(`/api/v1/admin/support/sessions/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  }, { authed: true });
}

export async function fetchElevatedDetail(userId) {
  return apiFetch(`/api/v1/admin/support/users/${encodeURIComponent(userId)}/detail`, {
    method: 'GET',
  }, { authed: true });
}
