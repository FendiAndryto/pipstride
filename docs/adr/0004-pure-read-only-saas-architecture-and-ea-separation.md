# ADR 0004: Pure Read-Only SaaS Telemetry Architecture and EA Separation

## Status
Accepted

## Context
TradeGear is evolving into a commercial SaaS platform targeting retail traders and institutional/prop-firm traders (e.g., FTMO, FundedNext). The initial architecture coupled real-time account telemetry with live trade execution capabilities (order placement, SL/TP enforcement, breakeven protection, trailing stops, and an emergency kill switch that liquidates open positions).

However, retaining trade execution and liquidation capabilities in a third-party SaaS platform introduces critical operational liabilities:
1. **Financial & Legal Liability**: Internet latency, broker slippage, or automated liquidation during standard market pullbacks exposes the platform operator to customer disputes and liability for trading losses.
2. **Trader Trust & Compliance Friction**: Professional traders and prop firm participants are unwilling to install third-party EAs with trade execution permissions on high-value accounts ($50k-$200k).
3. **Monolithic Inflexibility**: Traders who already possess proprietary EAs cannot utilize TradeGear solely for journaling, risk watchdog, and analytics without architectural friction.

## Decision
1. **100% Pure Read-Only Bridge (`TradeGearMonitor.mq5`)**:
   - Strip all order execution, modification, SL/TP adjustment, and liquidation routines from the bridge client.
   - The EA operates strictly as an unobtrusive, lightweight telemetry sensor transmitting balances, equity, margin, active positions, deal history, and market quotes via HTTP WebRequest.
   - It requires zero live trading permissions on the user's MT5 terminal.
2. **Decoupled Robot EAs**:
   - Strategy algorithms are packaged as standalone, optional trading EAs (`TradeGearRobot.mq5`), enabling future marketplace distribution.
   - Users can run their own custom EAs or manual trades independently on separate charts while `TradeGearMonitor` observes the overall account.
3. **Passive Risk Watchdog**:
   - The Drawdown Guard and Risk Hub transition from active order liquidation/lockout to passive threshold alerting via Telegram notifications and dashboard warnings. All trade execution decisions remain solely with the trader.
4. **Backend API Execution Route Retirement**:
   - Deprecate and remove order queueing and execution endpoints (`/api/v1/bridge/order`, `/api/v1/risk/kill-switch`, `/api/v1/risk/unlock`).

## Consequences
- **Positive**:
  - Zero financial or legal liability for trading outcomes or broker execution slippage.
  - 10x higher trust from prospective SaaS subscribers, including prop firm traders.
  - Substantially reduced CPU/RAM footprint on trader terminals and VPSs.
  - Clean modular architecture supporting future EA marketplace and monetization tiers.
- **Negative / Trade-offs**:
  - The web application cannot directly execute or close trades remotely on behalf of the user; all actions must be performed by the trader on MT5.
