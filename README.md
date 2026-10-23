# Pipstride — Pure Read-Only MT5 Telemetry & Journal Platform

Pipstride is a high-performance algorithmic trading journal and real-time account telemetry dashboard bridging MetaTrader 5 (MT5) with FastAPI backend and modern web architecture.

The platform operates under a **100% Pure Read-Only SaaS architecture** (no remote order execution, no manual order close, no manual SL/TP modification, and no broker transactions).

---

## 📁 Repository Structure

```text
pipstride/
├── apps/
│   └── web/                   # Web Dashboard (React + Vite, journal analytics)
├── services/
│   └── api/                   # FastAPI Backend (telemetry, journal, auth, watchdog)
│       ├── app/
│       │   ├── api/v1/        # REST API endpoints (auth, bridge, risk, telegram)
│       │   ├── core/          # Security, JWT, config
│       │   ├── db/            # Database initialization and models
│       │   ├── models/        # Pydantic schemas
│       │   └── services/      # Telemetry aggregation, journal analysis
│       ├── tests/             # Pytest automated test suite
│       └── requirements.txt
├── mt5-ea/
│   └── PipstrideMonitor.mq5   # 100% Read-Only MQL5 telemetry sensor
├── docs/
│   ├── adr/                   # Architecture Decision Records
│   └── GLOSSARY.md            # Domain vocabulary and boundary standards
├── infra/
│   └── docker-compose.yml     # Local orchestration
├── .env.example               # Environment variables template
└── .gitignore
```

---

## 🚀 Quickstart

### 1. Backend Setup

```bash
cd services/api
pip install -r requirements.txt
uvicorn app.main:app --port 8089 --reload
```

Backend API will be running at `http://localhost:8089` (Docs: `http://localhost:8089/api/v1/docs`).

### 2. Frontend Web Setup

```bash
cd apps/web
npm install
npm run dev
```

Dashboard will be accessible at `http://localhost:3000` (or `http://localhost:5173`).

### 3. MT5 Monitor Setup

1. Copy `mt5-ea/PipstrideMonitor.mq5` into your MetaTrader 5 `MQL5/Experts/` directory.
2. In MT5: **Tools > Options > Expert Advisors** -> Check **Allow WebRequest for listed URL** and add `http://localhost:8089`.
3. Drag `PipstrideMonitor` onto any active chart, enter your `InpBridgeToken` from the Pipstride web profile, and ensure **Allow Algo Trading** is checked.
