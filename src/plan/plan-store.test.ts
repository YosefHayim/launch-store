import { describe, expect, it } from 'vitest';

import { describeChanges, planStore } from './plan-store.js';

describe('planStore', () => {
  it('lists a name and a version that differ', () => {
    const changes = planStore(
      { name: 'My App', version: '1.0.1' },
      { name: 'Old', version: '1.0.0' },
    );

    expect(changes).toEqual([
      { field: 'name', from: 'Old', to: 'My App' },
      { field: 'version', from: '1.0.0', to: '1.0.1' },
    ]);
  });

  it('is empty when the store already matches', () => {
    const changes = planStore(
      { name: 'My App', version: '1.0.0' },
      { name: 'My App', version: '1.0.0' },
    );

    expect(describeChanges('ios', changes)).toEqual(['ios: no changes']);
  });
});
