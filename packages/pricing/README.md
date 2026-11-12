# Pricing Catalog (`packages/pricing`)

Single source of truth for Pipstride subscription plans and pricing.

- Consumed by `services/api` at startup to seed/validate the `plans` database table.
- Consumed by `apps/marketing` at build time to render the static pricing and specification matrix.
- Mirrored by `apps/admin`, which lists the plan codes when an operator changes an entitlement. The
  admin bundle may not import this file (ADR 0009 app boundary), so `services/api` validates every
  submitted `plan_code` against the seeded `plans` table and rejects unknown codes with HTTP 400.

To update or add a plan, modify `catalog.json` in this directory. Defining prices in more than one place is strictly prohibited (see ADR 0007).
