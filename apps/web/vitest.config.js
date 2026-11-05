import { defineConfig } from 'vitest/config';

// Ticket 008-01: the web app had no test runner, so the Fase 006 gate ("one
// formula per metric") was only enforced by human review — and dayBuckets
// drifted (see tickets/006-web-feature-split/04-split-journal-tab.md).
//
// Vitest is used instead of node:test because it reuses the app's own Vite
// resolver: 95 of 96 relative imports in src/ are extensionless, and plain
// node:test fails with ERR_MODULE_NOT_FOUND on anything outside domain/.
export default defineConfig({
  test: {
    // Pure modules only for now — no jsdom, no component tests (ticket 008-01 scope).
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true
  }
});
