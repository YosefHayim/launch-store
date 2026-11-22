import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from '../store/apple/app-store-surface-command.ts';
describe('renderAction', () => {
  it('marks a change with +, a skip with -', () => {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'create experiment "Icon Test" (50% traffic)',
      destructive: false,
      status: 'planned',
    });
    expect(storeSurfaceAction).toBe('+ create experiment "Icon Test" (50% traffic)');
    expect(
      renderStoreSurfaceAction({
        description: 'create treatment "Variant B" on experiment "Icon Test"',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('- create treatment "Variant B" on experiment "Icon Test"');
  });
  it("renders a failed action with x and Apple's error detail", () => {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'create experiment "Icon Test" (50% traffic)',
      destructive: false,
      status: 'failed',
      error: 'name already in use',
    });
    expect(storeSurfaceAction).toBe(
      'x create experiment "Icon Test" (50% traffic) - name already in use',
    );
  });
});
