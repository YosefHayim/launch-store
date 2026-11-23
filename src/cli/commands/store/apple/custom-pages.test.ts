import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from './app-store-surface-command.ts';
function describeRenderAction() {
  function marksAChangeWithASkipWith() {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'create custom product page "Spring Sale"',
      destructive: false,
      status: 'planned',
    });

    expect(storeSurfaceAction).toBe('+ create custom product page "Spring Sale"');
    expect(
      renderStoreSurfaceAction({
        description: 'promotional text on "Spring Sale": skipped - no editable version',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('- promotional text on "Spring Sale": skipped - no editable version');
  }

  it('marks a change with +, a skip with -', marksAChangeWithASkipWith);

  function rendersAFailedActionWithXAndAppleSErrorDetail() {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'create custom product page "Spring Sale"',
      destructive: false,
      status: 'failed',
      error: 'page name taken',
    });

    expect(storeSurfaceAction).toBe('x create custom product page "Spring Sale" - page name taken');
  }

  it(
    "renders a failed action with x and Apple's error detail",
    rendersAFailedActionWithXAndAppleSErrorDetail,
  );
}

describe('renderAction', describeRenderAction);
