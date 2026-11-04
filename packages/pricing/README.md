# Pricing Catalog (`packages/pricing`)

Single source of truth for Pipstride subscription plans and pricing.

- Consumed by `services/api` at startup to seed/validate the `plans` database table.
- Consumed by `apps/marketing` at build time to render the static pricing and specification matrix.
- Consumed by `apps/admin` for subscription plan management.

To update or add a plan, modify `catalog.json` in this directory. Defining prices in more than one place is strictly prohibited (see ADR 0007).
