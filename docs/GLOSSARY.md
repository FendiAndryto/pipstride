# Pipstride Domain Glossary

A real-time trading journal and telemetry SaaS platform bridging MetaTrader 5 (MT5) with FastAPI backend, telemetry monitoring, risk watchdog, and journal analytics. The system operates strictly as a **Pure Read-Only SaaS Telemetry & Journal Platform** (no order execution, no order close, no manual SL/TP modification, and no broker deposit/withdrawal transactions).

## Core Vocabulary

**Pipstride**:
The unified web and mobile application brand for monitoring accounts, tracking trading performance, analyzing journals, and viewing MT5 bridge telemetry.
_Avoid_: Robot Trading Dashboard, MT5 Connection Dashboard, Broker Portal

**Pure Read-Only SaaS Telemetry**:
The architectural guarantee that Pipstride operates strictly as an analytical observer and journal, possessing zero technical capability to open, modify, or liquidate trades on user accounts.
_Avoid_: Remote execution desk, web trading engine, trade bridge

**Bridge Status**:
The live telemetry health state between the FastAPI backend and the MT5 Expert Advisor sensor.
_Avoid_: Ping status, EA connection state

**Risk Watchdog**:
The passive account risk monitor that evaluates equity drawdown and margin utilization against user-defined safety thresholds, dispatching high-priority alerts without touching active orders.
_Avoid_: Emergency kill switch, order liquidator, automated slasher

**Initial Balance Benchmark**:
The baseline capital benchmark used solely for analytical evaluation of account growth, all-time P/L, and ROI trajectory. This is an analytical parameter, not a deposit transaction.
_Avoid_: Setoran dana, deposit transfer, opening cash

**Account Performance Curve**:
The chronological trajectory of account equity and balance growth reconstructed from initial balance benchmark and historical closed trades.
_Avoid_: Grafik saldo, profit line, chart trade

**Pipstride User**:
An authenticated account holder registered in Pipstride with private resources.
_Avoid_: Client, member, trader account

**MT5 Connection**:
One binding between a Pipstride user and a single MT5 account, identified by its own connection token. A user may own several connections and switch the active one in the dashboard.
_Avoid_: Bridge session, account slot, terminal

**Connection Token**:
A cryptographically secure, high-entropy API token assigned to exactly one MT5 connection. Pipstride stores only its SHA-256 digest and a short display prefix; the raw value is shown once at creation or rotation.
_Avoid_: MT5 password, broker pin, user secret

**Binding Lock**:
The rule that a connection token is permanently tied to the `account_number` of the first MT5 account that reports through it. Heartbeats from any other account are rejected with `409`.
_Avoid_: Account pairing, token whitelist

**Active Connection**:
The connection a dashboard request operates on, selected through the `X-Connection-Id` header. When the header is absent the oldest active connection is used.
_Avoid_: Current session, selected broker

**Live Telemetry State**:
The most recent heartbeat payload for a connection, cached in Redis with a short TTL. Durable history lives in PostgreSQL as snapshots and trades.
_Avoid_: Cache table, session payload

**Plan / Entitlement**:
A plan is a product tier (free, core, plus, pro) defining `max_connections`. An entitlement is a user's current assignment to a plan. Billing is not implemented yet; the schema is ready for it.
_Avoid_: Subscription record, licence key

**PipstrideMonitor**:
The ultra-lightweight, 100% pure read-only MetaTrader 5 Expert Advisor that transmits real-time account telemetry (balances, equity, margin, positions, history, quotes) to Pipstride without trade execution capabilities.
_Avoid_: Bridge robot, execution EA, trader bot
