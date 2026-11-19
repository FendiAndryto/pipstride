import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rawRequest } from '../src/lib/http.js';

test('cancelling a page request also cancels its transport', async (context) => {
  const request = new AbortController();
  let transportSignal;
  context.mock.method(globalThis, 'fetch', (_url, { signal }) => {
    transportSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });

  const pending = rawRequest('/audit', { signal: request.signal });
  request.abort();

  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(transportSignal.aborted, true);
});
