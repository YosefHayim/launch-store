import { describe, expect, it } from 'vitest';
import { renderAction } from './experiments.js';

describe('renderAction', () => {
  it('marks a change with +, a skip with •', () => {
    expect(
      renderAction({
        description: 'create experiment "Icon Test" (50% traffic)',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ create experiment "Icon Test" (50% traffic)');
    expect(
      renderAction({
        description: 'create treatment "Variant B" on experiment "Icon Test"',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('• create treatment "Variant B" on experiment "Icon Test"');
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: 'create experiment "Icon Test" (50% traffic)',
        destructive: false,
        status: 'failed',
        error: 'name already in use',
      }),
    ).toBe('✗ create experiment "Icon Test" (50% traffic) — name already in use');
  });
});
