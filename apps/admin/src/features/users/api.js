import { apiFetch } from '../../lib/api';

export async function fetchUsers({ search = '', status = '', limit = 50, offset = 0, signal } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  return apiFetch(`/api/v1/admin/users?${params.toString()}`, {
    method: 'GET',
    signal,
  }, { authed: true });
}

export async function fetchUser(id, { signal } = {}) {
  return apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'GET',
    signal,
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

export async function createUser(payload) {
  return apiFetch('/api/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, { authed: true });
}

export async function extendUserExpiry(id, payload) {
  return apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}/extend-expiry`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, { authed: true });
}

export async function revokeConnection(connectionId) {
  return apiFetch(`/api/v1/admin/connections/${encodeURIComponent(connectionId)}/revoke`, {
    method: 'POST',
  }, { authed: true });
}
