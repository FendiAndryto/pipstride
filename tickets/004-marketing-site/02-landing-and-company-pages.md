# Ticket 02: Landing + Feature & Architecture Pages (English + Technical Vectors)

## Goal
Build the public landing, features, and company pages in **English** using bespoke **vector schematics** (zero generic icons) and lightweight CSS motion, highlighting Pipstride's strictly read-only guarantee.

---

## Scope

### 1. English Copywriting & Anti-Slop Messaging
- Tone: Precision engineering, institutional transparency, developer/quant aesthetic.
- Key Value Proposition:
  - **Headline**: "The Zero-Execution MT5 Telemetry Engine."
  - **Subtitle**: "Stream real-time MetaTrader 5 account telemetry and automate your trade journaling with complete peace of mind. Purely passive by design — physically incapable of executing, modifying, or closing trades."
  - **CTA**: Direct link to `https://app-pipstride.homever.my.id` (`Launch Web Console [↗]`).
  - **Status Ribbon**: `[ ⚡ <10ms Heartbeat ]`, `[ 🔒 Air-Gapped Telemetry ]`, `[ 🛡️ Zero Execution Risk ]`, `[ 📱 PWA Mobile Cockpit ]`.

### 2. Bespoke Technical Vector Schematics (`src/components/vectors/`)
*Strict Rule: No generic feather/lucide icons. Use technical SVG vector illustrations.*

1. **`VectorPipeline.astro` (The Unidirectional Pipeline)**:
   - Visualizes the one-way telemetry stream:
     - Left: MetaTrader 5 Terminal node (`EURUSD`, `XAUUSD` active).
     - Center: The Outbound Conduit line with a lightweight animated pulsing data packet (`@keyframes flow-packet`).
     - Barrier: A stylized "One-Way Diode / Firewall Gate" clearly stamped `STRICTLY EGRESS ONLY • 0 INBOUND EXECUTION PATHS`.
     - Right: Pipstride Engine node displaying real-time Balance, Equity, and Floating PnL.
2. **`VectorCodeAudit.astro` (Binary Security Proof)**:
   - Side-by-side terminal comparison proving the read-only claim:
     - Left: `Conventional Trading EA` (highlighting risks: `OrderSend()`, `PositionClose()`, `BrokerPasswordRequired`).
     - Right: `PipstrideMonitor.mq5 Sensor` (audit verified: `OrderSend() == 0`, `PositionClose() == 0`, `AccountPassword == None`, `WebRequest(HTTPS) == Outbound Only`).
3. **`VectorJournalLedger.astro` (The Automated Trading Ledger)**:
   - Precision vector wireframe of the live journal:
     - Vector equity curve watermark with gradient fill.
     - Specimen trade log table: `Ticket #`, `Symbol`, `Type (BUY/SELL)`, `Open/Close Time`, `Duration`, `Net PnL`.
     - Risk gauge indicating current equity drawdown against deposit baseline.

### 3. Four Core Technical Pillars (Hairline Grid Cards)
1. **High-Frequency Telemetry**: 5-second lightweight heartbeats over secure HTTPS WebRequest. Zero CPU drag on VPS or desktop terminals.
2. **Drawdown Watchdog**: Passive equity-to-deposit tracking with real-time watermark calculation to alert on risk breaches.
3. **Automated Trade Ledger**: Every closed trade automatically synchronized, cataloged, and indexed with profit factor, win rate, and duration analysis.
4. **PWA Mobile Cockpit**: Standalone mobile experience on iOS and Android with persistent session state and zero app store friction.

### 4. Pages to Build
1. **`src/pages/index.astro`**:
   - Hero section with `VectorPipeline.astro`.
   - Security guarantee section with `VectorCodeAudit.astro`.
   - Core pillars grid.
   - Interactive preview section with `VectorJournalLedger.astro`.
   - How it works (3-step technical onboarding: Download EA → Attach to Chart → Monitor via Web).
   - Link to Pricing (Ticket 03).
2. **`src/pages/features.astro`**:
   - Deep dive into telemetry packet structure, candle buffering, and calculation algorithms.
3. **`src/pages/about.astro`**:
   - The Pipstride mission: Why separation of telemetry from execution is essential for serious traders.

---

## Files to Touch
- `apps/marketing/src/components/vectors/VectorPipeline.astro` — new.
- `apps/marketing/src/components/vectors/VectorCodeAudit.astro` — new.
- `apps/marketing/src/components/vectors/VectorJournalLedger.astro` — new.
- `apps/marketing/src/pages/index.astro` — new.
- `apps/marketing/src/pages/features.astro` — new.
- `apps/marketing/src/pages/about.astro` — new.

---

## Verification
```powershell
npm --prefix apps/marketing run build
```
- Expected:
  1. Build succeeds with exit code 0.
  2. `dist/index.html`, `dist/features/index.html`, and `dist/about/index.html` generated.
  3. Search check:
     ```powershell
     Select-String -Path apps/marketing/dist/index.html -Pattern "Zero-Execution|Telemetry|Air-Gapped"
     ```
     Matches found.
  4. Negative check: Zero occurrences of "Telegram", "Auto Trading", or "Checkout".

---

## Depends on
- `01-scaffold-astro-app.md`

## Unblocks
- `03-pricing-page-from-catalog.md`
- `04-seo-and-structured-data.md`

## Status
done
