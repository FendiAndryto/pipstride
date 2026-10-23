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

**Connection Token**:
A cryptographically secure, high-entropy API authentication token assigned to identify and bind incoming MT5 telemetry to an isolated user connection session.
_Avoid_: MT5 password, broker pin, user secret

**PipstrideMonitor**:
The ultra-lightweight, 100% pure read-only MetaTrader 5 Expert Advisor that transmits real-time account telemetry (balances, equity, margin, positions, history, quotes) to Pipstride without trade execution capabilities.
_Avoid_: Bridge robot, execution EA, trader bot
