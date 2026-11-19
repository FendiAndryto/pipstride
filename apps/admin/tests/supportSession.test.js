import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRemainingSeconds,
  findTargetSupportSession,
  indexActiveSupportSessions,
  isSessionActive,
  matchesElevatedSupportSession,
} from '../src/domain/supportSession.js';

const deadline = Date.parse('2026-01-02T00:00:00Z');
const session = {
  id: 'session-a',
  target_user_id: 'user-a',
  active: true,
  expires_at: new Date(deadline).toISOString(),
};

test('a grant stays active until its exact expiration deadline', () => {
  assert.equal(calculateRemainingSeconds(session.expires_at, deadline - 1), 1);
  assert.equal(isSessionActive(session, deadline - 1), true);
  assert.equal(isSessionActive(session, deadline), false);
});

test('active grants keep separate IDs and target selection ignores expired and revoked grants', () => {
  const other = { ...session, id: 'session-b', target_user_id: 'user-b' };
  const revoked = { ...other, id: 'revoked', revoked_at: session.expires_at };
  const expired = { ...other, id: 'expired', expires_at: new Date(deadline - 1000).toISOString() };
  const sessions = indexActiveSupportSessions([session, revoked, expired, other], deadline - 1);

  assert.deepEqual([...sessions.keys()], ['session-a', 'session-b']);
  assert.equal(findTargetSupportSession([...sessions.values()], 'user-b'), other);
  sessions.delete('session-b');
  assert.equal(findTargetSupportSession([...sessions.values()], 'user-a'), session);
  assert.equal(findTargetSupportSession([...sessions.values()], 'user-b'), null);
});

test('an elevated reply must match the current user and active grant', () => {
  const detail = { user_id: 'user-a', support_session: session };
  assert.equal(matchesElevatedSupportSession(detail, 'user-a', session, deadline - 1), true);
  assert.equal(matchesElevatedSupportSession(detail, 'user-a', session, deadline), false);
  assert.equal(matchesElevatedSupportSession(detail, 'user-b', session, deadline - 1), false);
  assert.equal(
    matchesElevatedSupportSession(detail, 'user-a', { ...session, id: 'replacement' }, deadline - 1),
    false,
  );
});
