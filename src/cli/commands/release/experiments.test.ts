import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from '@core/store/appStoreSurfaceCommand.js';
describe('renderAction', () => {
  it('marks a change with +, a skip with -', () => {
    expect(
      renderStoreSurfaceAction({
        description: 'create experiment "Icon Test" (50% traffic)',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ create experiment "Icon Test" (50% traffic)');
    expect(
      renderStoreSurfaceAction({
        description: 'create treatment "Variant B" on experiment "Icon Test"',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('- create treatment "Variant B" on experiment "Icon Test"');
  });
  it("renders a failed action with x and Apple's error detail", () => {
    expect(
      renderStoreSurfaceAction({
        description: 'create experiment "Icon Test" (50% traffic)',
        destructive: false,
        status: 'failed',
        error: 'name already in use',
      }),
    ).toBe('x create experiment "Icon Test" (50% traffic) - name already in use');
  });
});
