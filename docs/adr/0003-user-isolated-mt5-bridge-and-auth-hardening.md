# 0003. User-Isolated MT5 Bridge Architecture and Authentication Security Hardening

## Context
Previously, MT5 bridge telemetry, AutoPilot execution, Drawdown Guard, and emergency controls were shared globally in memory. Any MT5 terminal sending telemetry via unauthenticated HTTP POST `/api/v1/bridge/heartbeat` overwrote the global state, causing all logged-in TradeGear Users to view the same MT5 account. Furthermore, JWT authentication lacked token revocation on logout, allowed short 4-character passwords, had no brute-force rate limiting, and stored user data in an unindexed JSON file without concurrency safety.

## Decision
1. **User-Isolated Bridge Sessions**:
   - Issue each TradeGear User a unique, high-entropy `Bridge Token` (prefixed with `tg_live_`).
   - Require `BridgeEA.mq5` to transmit this token via `InpBridgeToken` input parameter (supported in both `X-Bridge-Token` HTTP header and JSON heartbeat payload).
   - Backend routes incoming telemetry, positions, deal histories, Drawdown Guard, AutoPilot, and Kill Switch exclusively to the authenticated user's isolated session.
   - Restrict all bridge status and control endpoints (`/bridge/*`, `/autopilot/*`, `/risk/*`) to authenticated users, returning only their respective MT5 data.

2. **Authentication Security Hardening**:
   - Implement instantaneous token revocation using user `token_version` tracking in the database, invalidating active JWTs immediately upon logout or password reset.
   - Enforce strong password requirements (minimum 8 characters, requiring alphanumeric characters).
   - Implement IP- and username-aware brute-force rate limiting on `/login` and `/register` endpoints (HTTP 429 Too Many Requests).
   - Disallow default insecure secret keys in production environments.

3. **Database Migration to SQLite**:
   - Transition persistence from flat JSON files (`users.json`, `account_settings.json`) to SQLite (`data/tradegear.db`) using Python's standard library `sqlite3` with WAL mode.
   - Automatically migrate existing users from `users.json` on first boot, maintaining backward compatibility.
   - Keep real-time MT5 telemetry cached in memory per user for sub-millisecond polling performance.
