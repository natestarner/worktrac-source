import { useQuery } from '@tanstack/react-query';
import { getStoreProducts } from '../api/billing';
import { queryKeys } from '../api/queryKeys';
import { getProducts, storeSource } from '../lib/native';

// What the app's store sells in this environment, with the STORE'S OWN price strings: our backend
// names the products (GET /api/billing/store/{store}/products), the store prices them. The app never
// holds a product id or a price of its own, so Apple's price points and Huddle Lower's separate
// products never touch this code. docs/in-app-purchase-plan.md.
//
// [{ plan, band, interval, productId, displayPrice }] -- only products the store actually returned.
// A product missing from App Store Connect is simply not offered.
//
// FAILS CLOSED: until this answers, and if it never does, BillingTab offers nothing to buy (the
// fail-closed posture the 'none' channel has always had). Persisted with the rest of the cache, so
// a device that has seen the prices shows them offline, behind the same OfflineDisabledWrap every
// purchase button has.
export function useStoreCatalog(enabled) {
  const store = storeSource();
  return useQuery({
    queryKey: queryKeys.storeCatalog(store),
    enabled: Boolean(enabled && store),
    // Prices change rarely, and only when App Store Connect is edited.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const offered = await getStoreProducts(store);
      const priced = await getProducts(offered.map((product) => product.productId));
      const byId = new Map(priced.map((product) => [product.id, product]));
      return offered
        .filter((product) => byId.has(product.productId))
        .map((product) => ({ ...product, displayPrice: byId.get(product.productId).displayPrice }));
    },
  });
}

/** The catalog entry for a plan/band/interval, or null when the store doesn't offer it. */
export function findStoreProduct(catalog, { plan, band = null, interval }) {
  return (
    (catalog ?? []).find(
      (product) => product.plan === plan && (product.band ?? null) === (band ?? null) && product.interval === interval,
    ) ?? null
  );
}
