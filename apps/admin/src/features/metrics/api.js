import { apiFetch } from '../../lib/api';

export async function fetchMetrics() {
  return apiFetch('/api/v1/admin/metrics', {
    method: 'GET',
  }, { authed: true });
}
