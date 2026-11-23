import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from '../store/apple/app-store-surface-command.ts';
function describeRenderAction() {
  function marksAChangeWithASkipWith() {
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
  }

  it('marks a change with +, a skip with -', marksAChangeWithASkipWith);
  function rendersAFailedActionWithXAndAppleSErrorDetail() {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'create experiment "Icon Test" (50% traffic)',
      destructive: false,
      status: 'failed',
      error: 'name already in use',
    });
    expect(storeSurfaceAction).toBe(
      'x create experiment "Icon Test" (50% traffic) - name already in use',
    );
  }

  it(
    "renders a failed action with x and Apple's error detail",
    rendersAFailedActionWithXAndAppleSErrorDetail,
  );
}

describe('renderAction', describeRenderAction);
