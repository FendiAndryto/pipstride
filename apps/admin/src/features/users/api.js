import { apiFetch } from '../../lib/api';

export async function fetchUsers({ search = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  return apiFetch(`/api/v1/admin/users?${params.toString()}`, {
    method: 'GET',
  }, { authed: true });
}

export async function fetchUser(id) {
  return apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'GET',
  }, { authed: true });
}

export async function updateEntitlement(id, { plan_code, max_connections }) {
  return apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}/entitlement`, {
    method: 'PATCH',
    body: JSON.stringify({
      plan_code,
      max_connections: max_connections ? Number(max_connections) : undefined,
    }),
  }, { authed: true });
}

export async function deactivateUser(id) {
  return apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}/deactivate`, {
    method: 'POST',
  }, { authed: true });
}

export async function activateUser(id) {
  return apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}/activate`, {
    method: 'POST',
  }, { authed: true });
}

export async function revokeConnection(connectionId) {
  return apiFetch(`/api/v1/admin/connections/${encodeURIComponent(connectionId)}/revoke`, {
    method: 'POST',
  }, { authed: true });
}
