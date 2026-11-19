import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditDateBounds } from '../src/features/audit/auditDates.js';

test('a single leap day covers the full day UTC', () => {
  assert.deepEqual(auditDateBounds('2028-02-29', '2028-02-29'), {
    start: '2028-02-29T00:00:00.000Z',
    end: '2028-03-01T00:00:00.000Z'
  });
});

test('either audit date can be omitted', () => {
  assert.deepEqual(auditDateBounds('', '2026-12-31'), {
    start: undefined,
    end: '2027-01-01T00:00:00.000Z'
  });
  assert.deepEqual(auditDateBounds('2026-12-31', ''), {
    start: '2026-12-31T00:00:00.000Z',
    end: undefined
  });
});

test('invalid and reversed audit dates are rejected', () => {
  assert.throws(() => auditDateBounds('2026-02-30', ''), /valid calendar date/);
  assert.throws(() => auditDateBounds('2026-11-20', '2026-11-19'), /start date/);
});
