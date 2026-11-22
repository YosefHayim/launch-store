import { describe, expect, test } from 'vitest';
import { planStore } from './plan-store.ts';

const PRODUCT_ID = 'monthly';

describe('planStore', function () {
  test('returns no changes when nothing is desired', function () {
    const desired = { products: [] };
    const live = { products: [] };

    const changes = planStore(desired, live);

    expect(changes).toEqual([]);
  });

  test('returns a create when the product is not live', function () {
    const desired = { products: [{ productId: PRODUCT_ID }] };
    const live = { products: [] };

    const changes = planStore(desired, live);

    expect(changes).toEqual([{ topic: 'product', action: 'create', detail: PRODUCT_ID }]);
  });

  test('returns no changes when the product is already live', function () {
    const desired = { products: [{ productId: PRODUCT_ID }] };
    const live = { products: [{ productId: PRODUCT_ID }] };

    const changes = planStore(desired, live);

    expect(changes).toEqual([]);
  });
});
