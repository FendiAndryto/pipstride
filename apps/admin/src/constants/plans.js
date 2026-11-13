// Mirror of packages/pricing/catalog.json (ADR 0007).
// apps/admin cannot import the catalog directly (no-cross-app-imports rule).
export const PLAN_OPTIONS = [
  { code: 'free', label: 'FREE — 1 Connection default', defaultConnections: 1 },
  { code: 'core', label: 'CORE — 1 Connection default', defaultConnections: 1 },
  { code: 'plus', label: 'PLUS — 3 Connections default', defaultConnections: 3 },
  { code: 'pro',  label: 'PRO — 5 Connections default',  defaultConnections: 5 },
];
