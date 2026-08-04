import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { InAppProductResource } from '../types/googlePlay.js';
import type { InAppPurchaseConfig } from '../types/catalog.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import {
  type PlayProductsApi,
  productInSync,
  reconcilePlayProducts,
  summarizePlayProducts,
  toPlayProduct,
} from './playProducts.js';
/** Records every write the reconciler makes, so a test can assert exactly what was sent to Play. */
type Calls = {
  inserts: InAppProductResource[];
  updates: InAppProductResource[];
};
/** A hand-rolled {@link PlayProductsApi} - no network - serving `existing` and recording the writes. */
const makeApi = (
  existing: InAppProductResource[],
  options: {
    reachable?: boolean;
    failSku?: string;
  } = {},
): {
  api: PlayProductsApi;
  calls: Calls;
} => {
  const calls: Calls = { inserts: [], updates: [] };
  const api: PlayProductsApi = {
    assertAppExists: () => {
      if (options.reachable === false) return Effect.fail(new Error('No reachable Play app'));
      return Effect.void;
    },
    listInAppProducts: () => Effect.succeed(existing),
    insertInAppProduct: (_pkg, product) => {
      if (product.sku === options.failSku)
        return Effect.fail(new Error('price not on a valid tier'));
      calls.inserts.push(product);
      return Effect.void;
    },
    updateInAppProduct: (_pkg, product) => {
      calls.updates.push(product);
      return Effect.void;
    },
  };
  return { api, calls };
};
/** A minimal shared in-app-purchase config with a Play override. */
const product = (overrides: Partial<InAppPurchaseConfig> = {}): InAppPurchaseConfig => {
  return {
    productId: 'com.acme.coins.100',
    referenceName: '100 Coins',
    type: 'CONSUMABLE',
    localizations: [{ locale: 'en-US', name: '100 Coins', description: 'A pile of coins' }],
    play: { defaultPrice: { priceMicros: '1990000', currency: 'USD' } },
    ...overrides,
  };
};
/** Execute the product mapper at the test boundary. */
const runProduct = (productConfig: InAppPurchaseConfig): InAppProductResource =>
  Effect.runSync(toPlayProduct(productConfig));
/** Execute the products reconciler at the test boundary. */
const runReconcile = (api: PlayProductsApi, input: Parameters<typeof reconcilePlayProducts>[1]) =>
  Effect.runPromise(reconcilePlayProducts(api, input));
describe('toPlayProduct', () => {
  it('maps shared fields + the play override into an active managed product', () => {
    expect(runProduct(product())).toEqual({
      sku: 'com.acme.coins.100',
      status: 'active',
      purchaseType: 'managedUser',
      defaultLanguage: 'en-US',
      defaultPrice: { priceMicros: '1990000', currency: 'USD' },
      listings: { 'en-US': { title: '100 Coins', description: 'A pile of coins' } },
    });
  });
  it('prefers play.sku over the shared productId and carries per-region prices', () => {
    const mapped = runProduct(
      product({
        play: {
          sku: 'coins_100',
          defaultPrice: { priceMicros: '1990000', currency: 'USD' },
          prices: { GB: { priceMicros: '1790000', currency: 'GBP' } },
        },
      }),
    );
    expect(mapped.sku).toBe('coins_100');
    expect(mapped.prices).toEqual({ GB: { priceMicros: '1790000', currency: 'GBP' } });
  });
  it('throws when the product has no localization to derive a default language from', () => {
    const failure = Effect.runSync(Effect.flip(toPlayProduct(product({ localizations: [] }))));
    expect(failure.message).toMatch(/at least one localization/);
  });
});
describe('productInSync', () => {
  const desired = runProduct(product());
  it("ignores Play's auto-fanned regional prices not named in config", () => {
    const live: InAppProductResource = {
      ...desired,
      prices: {
        US: { priceMicros: '1990000', currency: 'USD' },
        JP: { priceMicros: '300000000', currency: 'JPY' },
      },
    };
    expect(productInSync(live, desired)).toBe(true);
  });
  it('detects a drifted listing title and a changed default price', () => {
    expect(
      productInSync({ ...desired, listings: { 'en-US': { title: 'Old name' } } }, desired),
    ).toBe(false);
    expect(
      productInSync(
        { ...desired, defaultPrice: { priceMicros: '2990000', currency: 'USD' } },
        desired,
      ),
    ).toBe(false);
  });
});
describe('reconcilePlayProducts', () => {
  it('throws when the Play app record is unreachable', async () => {
    const { api } = makeApi([], { reachable: false });
    await expect(
      runReconcile(api, {
        packageName: 'com.acme.app',
        products: [product()],
        dryRun: true,
      }),
    ).rejects.toThrow(/No reachable Play app/);
  });
  it("creates a product Play doesn't have yet", async () => {
    const { api, calls } = makeApi([]);
    const productsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      products: [product()],
      dryRun: false,
    });
    expect(
      productsOutcome.actions.map((action) => `${action.status} ${action.description}`),
    ).toEqual(['applied create Play product com.acme.coins.100']);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]?.defaultPrice).toEqual({ priceMicros: '1990000', currency: 'USD' });
  });
  it("emits no action when the live product already matches (subset diff vs Play's extra regions)", async () => {
    const live: InAppProductResource = {
      ...runProduct(product()),
      prices: {
        US: { priceMicros: '1990000', currency: 'USD' },
        FR: { priceMicros: '1990000', currency: 'EUR' },
      },
    };
    const { api, calls } = makeApi([live]);
    const productsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      products: [product()],
      dryRun: false,
    });
    expect(productsOutcome.actions).toEqual([]);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });
  it("updates a drifted product, merging managed fields onto the live one so Play's regions survive", async () => {
    const live: InAppProductResource = {
      sku: 'com.acme.coins.100',
      status: 'active',
      purchaseType: 'managedUser',
      defaultLanguage: 'en-US',
      defaultPrice: { priceMicros: '990000', currency: 'USD' },
      prices: { JP: { priceMicros: '150000000', currency: 'JPY' } },
      listings: { 'en-US': { title: 'Old name' } },
    };
    const { api, calls } = makeApi([live]);
    const productsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      products: [product()],
      dryRun: false,
    });
    expect(
      productsOutcome.actions.map((action) => `${action.status} ${action.description}`),
    ).toEqual(['applied update Play product com.acme.coins.100']);
    const sent = expectArrayElement(calls.updates, 0, 'calls.updates');
    expect(sent.defaultPrice).toEqual({ priceMicros: '1990000', currency: 'USD' });
    expect(sent.listings?.['en-US']?.title).toBe('100 Coins');
    expect(sent.prices?.['JP']).toEqual({ priceMicros: '150000000', currency: 'JPY' });
  });
  it("leaves a Play product whose SKU isn't in config untouched (additive)", async () => {
    const orphan: InAppProductResource = {
      sku: 'com.acme.legacy',
      status: 'active',
      purchaseType: 'managedUser',
    };
    const { api, calls } = makeApi([orphan]);
    const productsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      products: [product()],
      dryRun: false,
    });
    expect(productsOutcome.actions).toHaveLength(1);
    expect(productsOutcome.actions[0]?.description).toBe('create Play product com.acme.coins.100');
    expect(calls.updates).toHaveLength(0);
  });
  it('plans without writing on a dry run', async () => {
    const { api, calls } = makeApi([]);
    const productsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      products: [product()],
      dryRun: true,
    });
    expect(productsOutcome.actions[0]?.status).toBe('planned');
    expect(calls.inserts).toHaveLength(0);
  });
  it('isolates a per-product failure so the rest of the run continues', async () => {
    const { api, calls } = makeApi([], { failSku: 'com.acme.coins.100' });
    const productsOutcome = await runReconcile(api, {
      packageName: 'com.acme.app',
      products: [
        product(),
        product({
          productId: 'com.acme.coins.500',
          play: { defaultPrice: { priceMicros: '4990000', currency: 'USD' } },
        }),
      ],
      dryRun: false,
    });
    const productsSummary = summarizePlayProducts(productsOutcome.actions);
    expect(productsSummary).toEqual({ applied: 1, failed: 1, skipped: 0 });
    expect(productsOutcome.actions.find((action) => action.status === 'failed')?.error).toMatch(
      /valid tier/,
    );
    expect(calls.inserts.map((insertedProduct) => insertedProduct.sku)).toEqual([
      'com.acme.coins.500',
    ]);
  });
});
