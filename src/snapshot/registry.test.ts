import { describe, expect, it } from 'vitest';
import { listSnapshotSources, registerBuiltinSources } from './registry.ts';
describe('snapshot source registry', () => {
  it('registers the six built-in sources', () => {
    registerBuiltinSources();
    const ids = listSnapshotSources()
      .map((source) => source.id)
      .sort();
    expect(ids).toEqual([
      'apple-capabilities',
      'apple-listing',
      'apple-products',
      'apple-subscriptions',
      'play-products',
      'play-subscriptions',
    ]);
  });
  function isIdempotentReRegisteringKeyedByIdDoesNotDuplicate() {
    registerBuiltinSources();
    registerBuiltinSources();
    const snapshotSources = listSnapshotSources();
    expect(snapshotSources).toHaveLength(6);
  }

  it(
    'is idempotent - re-registering keyed by id does not duplicate',
    isIdempotentReRegisteringKeyedByIdDoesNotDuplicate,
  );
});
