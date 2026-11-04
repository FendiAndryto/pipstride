// Single-source pricing (ADR 0007): built from packages/pricing/catalog.json.
// `price_cents` holds IDR minor units, i.e. 5,900,000 -> IDR 59,000.
import catalog from '../../../../packages/pricing/catalog.json';

const numberFormat = new Intl.NumberFormat('en-US');

export const publicPlans = catalog.plans.filter((plan) => plan.price_cents > 0);

export function formatPrice(priceCents) {
  return `IDR ${numberFormat.format(priceCents / 100)}`;
}

export function formatTerminals(maxConnections) {
  return `${maxConnections} MT5 Terminal${maxConnections === 1 ? '' : 's'}`;
}

// Billing does not exist yet, so every advertised price is a pre-order target.
export const priceRange = {
  low: Math.min(...publicPlans.map((plan) => plan.price_cents)) / 100,
  high: Math.max(...publicPlans.map((plan) => plan.price_cents)) / 100,
  count: publicPlans.length,
};
