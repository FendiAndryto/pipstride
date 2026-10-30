# ADR 0008: Admin Console Surface & Privilege Boundary

## Status

Accepted

## Context

Pipstride needs an internal surface to manage users: view accounts, adjust entitlements, deactivate or revoke, and inspect the audit trail. Today there is no admin UI and no admin API. Relevant facts from the current codebase:

1. **A role column already exists.** `User.role` (`app/db/models.py:42`) defaults to `"trader"`; self-registration never sets anything else. `AuditLog` (`app/db/models.py:179-188`) already exists but is barely written.
2. **JWTs live 24 hours** (`ACCESS_TOKEN_EXPIRE_MINUTES=1440` by default). Any authorization derived *only* from a token claim stays valid for a day after the role changes.
3. **Data sensitivity is high.** `trades` and `account_settings` contain private financial records. `connection.token_hash` is hash-only by design — a property that must not be weakened for admin convenience.
4. **The product sells privacy and read-only operation as its core value.** An admin surface that casually exposes user trades would contradict the product's own promise.

## Decision

1. **One backend service. Add a router, not a service.** Admin endpoints live under `services/api/app/api/v1/admin/` (`users`, `connections`, `audit`, `metrics`). Admin reads across users (joins across `users`, `entitlements`, `mt5_connections`, `audit_logs`) on the same database; a second service would either share the DB (anti-pattern) or replicate data (overkill at this scale).

2. **No separate `admins` table.** Authorization uses `User.role` with new values `admin` and `support`. A `require_role("admin")` dependency is mounted **per router**. Because mounting it per router is a convention, not an enforcement, an architecture test asserts that every module under `api/v1/admin/` attaches the dependency — a bare `APIRouter` fails CI.

3. **Role is read from the database on every request, not from the JWT claim.** The guard re-checks `User.role`, `is_active`, and `token_version`. A demoted or deactivated admin loses access immediately; it does not wait out the 24-hour token.

4. **Every admin mutation writes `audit_logs`** with the acting admin's `user_id`, `action`, `detail`, and `ip_address`. No mutation endpoint ships without this.

5. **TOTP two-factor authentication is mandatory for admin/support accounts.** A single leaked password must not grant access to all user data. This requires a migration adding `users.totp_secret` (encrypted at rest) and `users.totp_enrolled_at`. Until TOTP ships, the admin origin is restricted (IP allowlist or Cloudflare Access) and no admin account is created outside that restriction.

6. **Privacy boundary — metadata by default.**
   - Admin sees account metadata: user, plan/entitlement, connection status, `last_seen_at`, trade *counts* and last activity.
   - Admin does **not** see the contents of `trades` or `account_settings` by default.
   - **Support mode** — a time-boxed (30-minute), reason-required elevation — is the only path to a specific user's detail. Its state lives in a dedicated `support_sessions` table (`id, admin_id, target_user_id, reason, granted_at, expires_at, revoked_at`); every grant and revoke is also mirrored to `audit_logs`. It is shown as a banner in the admin UI and is **visible to the affected user** through an access-log view in `apps/web`. That user-visible access log is a prerequisite: until it ships, support mode stays disabled.
   - Admin may **never** read a raw connection token. `token_hash` stays hash-only; no admin endpoint returns a plaintext token.

7. **A separate frontend app, `apps/admin`, with its own origin and bundle.** Admin is not a route inside `apps/web`:
   - an in-app `/admin` route would ship all admin JavaScript to every visitor (route guards are cosmetic — the code is still delivered);
   - CSP, frame policy, and rate limits must be tunable independently of the product;
   - an admin frontend bug cannot degrade the trader UI.

   This does **not** isolate the backend: admin and product endpoints share one FastAPI process, so an admin-router crash or resource spike affects both. That shared blast radius is accepted at this scale; splitting into a second service is deferred until an external-access requirement makes it necessary (see ADR 0009 §Boundaries).

8. **Sequencing.**
   - (a) `require_role` + read-only admin endpoints, reachable **only** behind the IP allowlist;
   - (b) TOTP migration and enrollment;
   - (c) mutations, with mandatory audit;
   - (d) support mode, plus the user-visible access log it depends on.

   Read-only first: an admin that can see but not change cannot corrupt data, and it forces the privacy boundary to be designed before any write path exists.

## Consequences

- Positive: least-privilege default; immediate revocation; every privileged action is attributable; the product's privacy promise is structurally enforced rather than advertised.
- Positive: no new service, no separate identity system — operational surface area grows by one router and one container.
- Negative / trade-offs: TOTP, `support_sessions`, and the user-visible access log are real work that must land before admin is fully usable; support mode adds a state machine (grant, expire, revoke, display) that a naive "admin sees everything" design would avoid. This cost is accepted deliberately.
- Shared-backend blast radius is a known limitation, not a claim of isolation.

## References

- ADR 0003 — user-isolated bridge and auth hardening (role/token_version model).
- ADR 0004 — pure read-only architecture (must remain true on the admin surface).
- ADR 0009 — layered architecture and dependency rule.
- `docs/GLOSSARY.md` — Plan / Entitlement.
